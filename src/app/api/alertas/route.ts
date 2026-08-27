import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";

/**
 * GET /api/alertas — lo que necesita atencion ahora.
 * POST /api/alertas — marca una alerta como leida.
 * DELETE /api/alertas — la desmarca.
 *
 * Hoy trae reposicion de stock. La respuesta es una lista de alertas con un
 * `tipo`, para que sumar otra clase (mantenimientos vencidos, por ejemplo) no
 * obligue a cambiar ni la campanita ni este contrato.
 *
 * Cuenta y detalle salen del MISMO pedido: la campanita muestra el numero y el
 * panel muestra las filas, y si fueran dos consultas podrian discrepar.
 *
 * LEIDAS
 * Marcar una alerta guarda la foto de la situacion (stock y minimo de ese
 * momento). Sigue leida solo mientras esos numeros no se muevan: si entra
 * mercaderia o se vende otra unidad, vuelve a aparecer. Un "leido" para siempre
 * apagaria la alerta justo cuando vuelve a importar.
 */

export interface AlertaStock {
  tipo: "stock";
  /** Critico = sin stock; el resto es reposicion normal. */
  nivel: "critico" | "aviso";
  producto_id: string;
  titulo: string;
  detalle: string;
  href: string;
  /** El usuario ya la vio, con el stock que tiene ahora. */
  leida: boolean;
}

/** Cuantas filas se devuelven. Arriba de esto, el panel invita al reporte. */
const LIMITE = 30;

export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const empresaId = ctx.auth.empresa_id;
    const usuarioId = ctx.auth.user.id;

    // Solo productos que controlan stock: un servicio o algo sin control no
    // tiene "faltante" que reponer.
    const { data, error } = await ctx.supabase
      .from("productos")
      .select("id, nombre, sku, stock_actual, stock_minimo, unidad_medida")
      .eq("empresa_id", empresaId)
      .eq("activo", true)
      .eq("controla_stock", true)
      .gt("stock_minimo", 0)
      .order("nombre");
    if (error) throw new Error(error.message);

    const filas = (data ?? []) as unknown as Record<string, unknown>[];

    const bajos = filas
      .map((p) => {
        const stock = Number(p.stock_actual) || 0;
        const minimo = Number(p.stock_minimo) || 0;
        return { p, stock, minimo, falta: minimo - stock };
      })
      // El filtro se hace acá y no en la consulta porque PostgREST no compara
      // dos columnas entre si.
      .filter((x) => x.falta > 0)
      // Primero lo que esta en cero, y dentro de eso lo que mas falta.
      .sort((a, b) => Number(a.stock > 0) - Number(b.stock > 0) || b.falta - a.falta);

    // Lo que este usuario ya marco. Se piden solo los productos en alerta.
    const leidasQ = await ctx.supabase
      .from("alertas_stock_leidas")
      .select("producto_id, stock_visto, minimo_visto")
      .eq("empresa_id", empresaId)
      .eq("usuario_id", usuarioId);
    // Si la tabla no existe todavia (schema sin migrar) no se rompe la
    // campanita: se muestran todas como no leidas, que es lo de antes.
    const leidas = new Map<string, { stock: number; minimo: number }>();
    for (const r of (leidasQ.data ?? []) as unknown as Record<string, unknown>[]) {
      leidas.set(String(r.producto_id), {
        stock: Number(r.stock_visto),
        minimo: Number(r.minimo_visto),
      });
    }

    const estaLeida = (id: string, stock: number, minimo: number) => {
      const m = leidas.get(id);
      return m != null && m.stock === stock && m.minimo === minimo;
    };

    const sinLeer = bajos.filter((x) => !estaLeida(String(x.p.id), x.stock, x.minimo));

    // Se muestran primero las no leidas: las vistas bajan, no desaparecen, para
    // poder desmarcar una que se marco por error.
    const ordenadas = [
      ...sinLeer,
      ...bajos.filter((x) => estaLeida(String(x.p.id), x.stock, x.minimo)),
    ];

    const alertas: AlertaStock[] = ordenadas.slice(0, LIMITE).map(({ p, stock, minimo, falta }) => {
      const unidad = String(p.unidad_medida ?? "").toUpperCase();
      const u = !unidad || unidad === "UNIDAD" ? "" : ` ${unidad === "LITRO" ? "L" : unidad}`;
      return {
        tipo: "stock",
        nivel: stock <= 0 ? "critico" : "aviso",
        producto_id: String(p.id),
        titulo: String(p.nombre ?? ""),
        detalle:
          stock <= 0
            ? `Sin stock · mínimo ${minimo}${u}`
            : `Quedan ${stock}${u} de ${minimo}${u} · faltan ${falta}${u}`,
        href: `/inventario/${String(p.id)}/editar`,
        leida: estaLeida(String(p.id), stock, minimo),
      };
    });

    return NextResponse.json(
      successResponse({
        // El numero de la campanita cuenta lo que falta ver, no el total: si
        // contara todo, marcar como leido no serviria de nada.
        total: sinLeer.length,
        totalBajos: bajos.length,
        criticos: sinLeer.filter((x) => x.stock <= 0).length,
        alertas,
      })
    );
  } catch (err) {
    console.error("[/api/alertas GET]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudieron cargar las alertas."), { status: 500 });
  }
}

/** El producto que viene en el cuerpo, o null si no vino uno usable. */
async function productoDelCuerpo(request: NextRequest): Promise<string | null> {
  try {
    const body = (await request.json()) as { producto_id?: unknown };
    const id = String(body?.producto_id ?? "").trim();
    return id || null;
  } catch {
    return null;
  }
}

/** POST /api/alertas — marca como leida, con la foto del stock de ahora. */
export async function POST(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const productoId = await productoDelCuerpo(request);
    if (!productoId) {
      return NextResponse.json(errorResponse("Falta el producto."), { status: 400 });
    }
    const empresaId = ctx.auth.empresa_id;

    // El stock se lee del servidor, no se acepta del cliente: la foto tiene que
    // ser la situacion real en el momento de marcar.
    const prodQ = await ctx.supabase
      .from("productos")
      .select("id, stock_actual, stock_minimo")
      .eq("empresa_id", empresaId)
      .eq("id", productoId)
      .maybeSingle();
    if (prodQ.error) throw new Error(prodQ.error.message);
    if (!prodQ.data) {
      return NextResponse.json(errorResponse("Producto no encontrado."), { status: 404 });
    }
    const p = prodQ.data as unknown as Record<string, unknown>;

    const up = await ctx.supabase.from("alertas_stock_leidas").upsert(
      {
        empresa_id: empresaId,
        usuario_id: ctx.auth.user.id,
        producto_id: productoId,
        stock_visto: Number(p.stock_actual) || 0,
        minimo_visto: Number(p.stock_minimo) || 0,
        leido_at: new Date().toISOString(),
      },
      { onConflict: "empresa_id,usuario_id,producto_id" }
    );
    if (up.error) throw new Error(up.error.message);

    return NextResponse.json(successResponse({ producto_id: productoId, leida: true }));
  } catch (err) {
    console.error("[/api/alertas POST]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo marcar la alerta."), { status: 500 });
  }
}

/** DELETE /api/alertas — la vuelve a dejar sin leer. */
export async function DELETE(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const productoId = await productoDelCuerpo(request);
    if (!productoId) {
      return NextResponse.json(errorResponse("Falta el producto."), { status: 400 });
    }

    const del = await ctx.supabase
      .from("alertas_stock_leidas")
      .delete()
      .eq("empresa_id", ctx.auth.empresa_id)
      .eq("usuario_id", ctx.auth.user.id)
      .eq("producto_id", productoId);
    if (del.error) throw new Error(del.error.message);

    return NextResponse.json(successResponse({ producto_id: productoId, leida: false }));
  } catch (err) {
    console.error("[/api/alertas DELETE]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo desmarcar la alerta."), { status: 500 });
  }
}
