import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import type { AppSupabaseClient } from "@/lib/supabase/schema";

/**
 * GET /api/alertas — lo que necesita atencion ahora.
 * POST /api/alertas — marca una alerta como leida.
 * DELETE /api/alertas — la desmarca.
 *
 * Trae dos clases de alerta, cada una con su `tipo`:
 *   - "stock":    productos por debajo de su minimo.
 *   - "inactivo": autos que pasaron su plazo sin volver al taller.
 *
 * El `tipo` existe justamente para poder sumar clases sin cambiar ni la
 * campanita ni este contrato.
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

/** Un auto que hace rato no aparece por el taller. */
export interface AlertaInactivo {
  tipo: "inactivo";
  nivel: "critico" | "aviso";
  vehiculo_id: string;
  titulo: string;
  detalle: string;
  href: string;
  leida: boolean;
}

export type Alerta = AlertaStock | AlertaInactivo;

/** Cuantas filas se devuelven. Arriba de esto, el panel invita al reporte. */
const LIMITE = 30;

/** Dias sin venir por defecto, cuando el vehiculo no define los suyos. */
const DIAS_INACTIVO_DEFECTO = 90;

/**
 * Autos que pasaron su plazo sin venir.
 *
 * El plazo lo define cada vehiculo; sin valor, 90 dias. En 0 no avisa nunca:
 * hay autos que vienen una vez al año y tenerlos siempre en rojo hace que se
 * deje de mirar la campanita.
 *
 * Un auto que NUNCA vino no entra: no es un cliente que se perdio, es uno que
 * todavia no atendimos, y eso no se arregla llamandolo.
 */
async function alertasInactivos(
  supabase: AppSupabaseClient,
  empresaId: string
): Promise<{ vehiculo_id: string; patente: string; nombre: string; dias: number; plazo: number }[]> {
  const vehQ = await supabase
    .from("vehiculos")
    .select("id, patente, marca, modelo, avisar_inactivo_dias, cliente_id, activo")
    .eq("empresa_id", empresaId)
    .eq("activo", true);
  if (vehQ.error) throw new Error(vehQ.error.message);
  const vehiculos = (vehQ.data ?? []) as unknown as Record<string, unknown>[];
  if (!vehiculos.length) return [];

  // Ultima visita de cada auto: la venta mas reciente que lo incluyo.
  const vvQ = await supabase
    .from("ventas_vehiculos")
    .select("vehiculo_id, venta_id")
    .eq("empresa_id", empresaId);
  if (vvQ.error) throw new Error(vvQ.error.message);
  const vvRows = (vvQ.data ?? []) as unknown as Record<string, unknown>[];

  const ventaIds = [...new Set(vvRows.map((r) => String(r.venta_id)))];
  const fechaVenta = new Map<string, string>();
  if (ventaIds.length) {
    const venQ = await supabase
      .from("ventas")
      .select("id, fecha, estado")
      .eq("empresa_id", empresaId)
      .in("id", ventaIds);
    if (venQ.error) throw new Error(venQ.error.message);
    for (const v of (venQ.data ?? []) as unknown as Record<string, unknown>[]) {
      // Una venta anulada no es una visita.
      if (v.estado === "anulada") continue;
      fechaVenta.set(String(v.id), String(v.fecha));
    }
  }

  const ultima = new Map<string, string>();
  for (const r of vvRows) {
    const f = fechaVenta.get(String(r.venta_id));
    if (!f) continue;
    const id = String(r.vehiculo_id);
    const prev = ultima.get(id);
    if (!prev || f > prev) ultima.set(id, f);
  }

  const nombreCli = new Map<string, string>();
  const idsCli = [...new Set(vehiculos.map((v) => v.cliente_id).filter(Boolean))].map(String);
  if (idsCli.length) {
    const cliQ = await supabase
      .from("clientes")
      .select("id, nombre, nombre_contacto, empresa, tipo_cliente")
      .eq("empresa_id", empresaId)
      .in("id", idsCli);
    for (const c of (cliQ.data ?? []) as unknown as Record<string, unknown>[]) {
      const empresaNom = String(c.empresa ?? "").trim();
      const contacto = String(c.nombre_contacto ?? "").trim();
      const nombre = String(c.nombre ?? "").trim();
      const elegido = (c.tipo_cliente === "empresa" && empresaNom) || contacto || nombre || "";
      if (elegido) nombreCli.set(String(c.id), elegido);
    }
  }

  const ahora = Date.now();
  const salida: { vehiculo_id: string; patente: string; nombre: string; dias: number; plazo: number }[] = [];
  for (const v of vehiculos) {
    const id = String(v.id);
    const plazo = v.avisar_inactivo_dias == null ? DIAS_INACTIVO_DEFECTO : Number(v.avisar_inactivo_dias);
    if (!(plazo > 0)) continue;
    const f = ultima.get(id);
    if (!f) continue;
    const dias = Math.floor((ahora - new Date(f).getTime()) / 86400000);
    if (dias < plazo) continue;
    const desc = [v.marca, v.modelo].filter(Boolean).join(" ").trim();
    salida.push({
      vehiculo_id: id,
      patente: String(v.patente ?? ""),
      nombre: nombreCli.get(String(v.cliente_id)) || desc || "Sin cliente",
      dias,
      plazo,
    });
  }
  // Primero el que hace mas que no viene.
  return salida.sort((a, b) => b.dias - a.dias);
}

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

    const alertasStock: AlertaStock[] = ordenadas.slice(0, LIMITE).map(({ p, stock, minimo, falta }) => {
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

    // Autos que no vuelven. Si esto falla, la campanita sigue mostrando el
    // stock: media alerta es mejor que ninguna.
    let inactivos: Awaited<ReturnType<typeof alertasInactivos>> = [];
    try {
      inactivos = await alertasInactivos(ctx.supabase, empresaId);
    } catch (e) {
      console.warn("[/api/alertas] inactivos:", e instanceof Error ? e.message : e);
    }

    const alertasInactivas: AlertaInactivo[] = inactivos.slice(0, LIMITE).map((v) => ({
      tipo: "inactivo",
      // Al doble del plazo ya no es "se esta demorando": se perdio.
      nivel: v.dias >= v.plazo * 2 ? "critico" : "aviso",
      vehiculo_id: v.vehiculo_id,
      titulo: `${v.patente} · ${v.nombre}`,
      detalle: `Hace ${v.dias} días que no viene · avisar a los ${v.plazo}`,
      href: `/vehiculos/${v.vehiculo_id}`,
      // Marcar como leido hoy es solo para stock; un auto que no vuelve deja de
      // avisar solo cuando vuelve.
      leida: false,
    }));

    return NextResponse.json(
      successResponse({
        // El numero de la campanita cuenta lo que falta ver, no el total: si
        // contara todo, marcar como leido no serviria de nada.
        total: sinLeer.length + alertasInactivas.length,
        totalBajos: bajos.length + alertasInactivas.length,
        criticos:
          sinLeer.filter((x) => x.stock <= 0).length +
          alertasInactivas.filter((a) => a.nivel === "critico").length,
        // Primero los autos: un cliente que se va no vuelve solo, y un producto
        // que falta se repone cuando llega el pedido.
        alertas: [...alertasInactivas, ...alertasStock],
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
