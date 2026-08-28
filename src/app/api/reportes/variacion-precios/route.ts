import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { getChatPostgresPool, quoteSchemaTable } from "@/lib/supabase/chat-pg-pool";
import { assertAllowedChatDataSchema } from "@/lib/supabase/chat-data-schema";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";

const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;
const PY = "AT TIME ZONE INTERVAL '-3 hours'"; // Paraguay UTC-3 fijo.
const n = (v: unknown): number => { const x = typeof v === "number" ? v : Number(v ?? 0); return Number.isFinite(x) ? x : 0; };

/**
 * GET /api/reportes/variacion-precios — productos con variación de costo y/o
 * precio de venta entre recepciones de compra consecutivas (LAG sobre `compras`).
 * Filtros: desde, hasta (hora Asunción), proveedor (opcional). Muestra quién recibió.
 */
export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const empresaId = ctx.auth.empresa_id;
    const schema = assertAllowedChatDataSchema(await fetchDataSchemaForEmpresaId(empresaId));
    const pool = getChatPostgresPool();
    if (!pool) throw new Error("Pool no disponible.");
    const tC = quoteSchemaTable(schema, "compras");

    const sp = request.nextUrl.searchParams;
    const hoy = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Asuncion" }).format(new Date());
    const desde = RE_FECHA.test(sp.get("desde") ?? "") ? String(sp.get("desde")) : `${hoy.slice(0, 7)}-01`;
    const hasta = RE_FECHA.test(sp.get("hasta") ?? "") ? String(sp.get("hasta")) : hoy;
    const proveedor = (sp.get("proveedor") ?? "").trim();

    const args: unknown[] = [empresaId, desde, hasta];
    let provCond = "";
    if (proveedor) { args.push(`%${proveedor}%`); provCond = `AND s.proveedor_nombre ILIKE $${args.length}`; }

    // LAG sobre TODO el historial del producto; luego se filtra el rango pedido.
    const { rows } = await pool.query(
      `WITH s AS (
         SELECT producto_id, producto_nombre, fecha, numero_control, proveedor_nombre, usuario_nombre,
                costo_unitario AS costo_act,
                LAG(costo_unitario) OVER (PARTITION BY producto_id ORDER BY fecha, id) AS costo_ant,
                precio_venta AS precio_act,
                LAG(precio_venta) OVER (PARTITION BY producto_id ORDER BY fecha, id) AS precio_ant
           FROM ${tC}
          WHERE empresa_id = $1::uuid
       )
       SELECT * FROM s
        WHERE costo_ant IS NOT NULL
          AND (s.fecha ${PY})::date BETWEEN $2::date AND $3::date
          AND (costo_act <> costo_ant OR COALESCE(precio_act,0) <> COALESCE(precio_ant,0))
          ${provCond}
        ORDER BY s.fecha DESC`,
      args
    );

    // Precio y costo que el producto tiene HOY. El reporte muestra los de cada
    // compra, que son historicos: para sugerir un precio hay que mirar el
    // vigente, no el de la compra de hace tres meses.
    const idsProd = [...new Set(rows.map((r: Record<string, unknown>) => String(r.producto_id)))];
    const vigente = new Map<string, { precio: number; costo: number }>();
    if (idsProd.length) {
      const tP = quoteSchemaTable(schema, "productos");
      const pv = await pool.query(
        `SELECT id::text AS id, COALESCE(precio_venta,0)::float8 AS precio,
                COALESCE(costo_promedio,0)::float8 AS costo
           FROM ${tP} WHERE empresa_id = $1::uuid AND id = ANY($2::uuid[])`,
        [empresaId, idsProd]
      );
      for (const p of pv.rows as Record<string, unknown>[]) {
        vigente.set(String(p.id), { precio: n(p.precio), costo: n(p.costo) });
      }
    }

    /** Precio que mantiene el margen `margenPct` con el costo dado. */
    function precioParaMargen(costo: number, margenPct: number): number | null {
      if (!(costo > 0)) return null;
      const m = margenPct / 100;
      // Un margen de 100% o mas sobre el precio es imposible de sostener: el
      // precio tenderia a infinito.
      if (!(m < 0.99)) return null;
      const exacto = costo / (1 - m);
      // Para arriba, a los 500: redondear para abajo dejaria el margen por
      // debajo del que se quiso mantener.
      return Math.ceil(exacto / 500) * 500;
    }

    const items = rows.map((r: Record<string, unknown>) => {
      const costoAnt = n(r.costo_ant), costoAct = n(r.costo_act);
      const precioAnt = n(r.precio_ant), precioAct = n(r.precio_act);
      const hoyProd = vigente.get(String(r.producto_id)) ?? null;
      // Margen sobre el PRECIO (no sobre el costo): es como se lee "gano 30%".
      const margenAnt = precioAnt > 0 ? ((precioAnt - costoAnt) / precioAnt) * 100 : null;
      const margenHoy =
        hoyProd && hoyProd.precio > 0
          ? ((hoyProd.precio - hoyProd.costo) / hoyProd.precio) * 100
          : null;
      return {
        producto_id: String(r.producto_id ?? ""),
        producto_nombre: String(r.producto_nombre ?? ""),
        fecha: String(r.fecha ?? ""),
        numero_control: String(r.numero_control ?? ""),
        proveedor_nombre: (r.proveedor_nombre as string | null) ?? "—",
        usuario_nombre: (r.usuario_nombre as string | null) ?? null,
        costo_ant: costoAnt, costo_act: costoAct,
        costo_var_monto: costoAct - costoAnt,
        costo_var_pct: costoAnt > 0 ? ((costoAct - costoAnt) / costoAnt) * 100 : null,
        precio_ant: precioAnt, precio_act: precioAct,
        precio_var_monto: precioAct - precioAnt,
        precio_var_pct: precioAnt > 0 ? ((precioAct - precioAnt) / precioAnt) * 100 : null,
        // ── Margen y sugerencia ──────────────────────────────────────────
        margen_ant_pct: margenAnt,
        margen_hoy_pct: margenHoy,
        precio_hoy: hoyProd?.precio ?? null,
        costo_hoy: hoyProd?.costo ?? null,
        // Solo se sugiere si el margen efectivamente se achico: subir el
        // precio de algo que no perdio margen no es "mantener el margen".
        precio_sugerido:
          margenAnt != null && margenHoy != null && margenHoy < margenAnt - 0.5 && hoyProd
            ? precioParaMargen(hoyProd.costo, margenAnt)
            : null,
      };
    });

    return NextResponse.json(successResponse({ desde, hasta, items }));
  } catch (err) {
    console.error("[/api/reportes/variacion-precios]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo generar el reporte de variación de precios."), { status: 500 });
  }
}
