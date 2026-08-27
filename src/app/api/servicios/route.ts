import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { crearServicio, listServicios, type ServicioInput } from "@/lib/servicios/servicios-pg";

/**
 * Servicios del lubricentro. Crear un servicio es UNA operacion que arma el
 * producto, su receta y sus insumos: si la UI tuviera que encadenar tres
 * llamadas, un fallo en la segunda dejaria un servicio que no descuenta nada.
 */

/** Numero del body, o null. Devuelve `undefined` si el valor es invalido. */
function num(v: unknown): number | null | undefined {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

export function parseServicio(body: Record<string, unknown>): ServicioInput | string {
  const nombre = String(body.nombre ?? "").trim();
  if (!nombre) return "El nombre del servicio es obligatorio.";

  const precio = num(body.precio_venta) ?? 0;
  if (precio === undefined || precio < 0) return "Precio inválido.";

  const manoObra = num(body.mano_obra) ?? 0;
  if (manoObra === undefined || manoObra < 0) return "Mano de obra inválida.";

  const margen = num(body.margen_pct);
  if (margen === undefined) return "Margen inválido.";
  if (margen != null && (margen < 0 || margen > 1000)) return "Margen inválido.";

  const km = num(body.intervalo_km);
  if (km === undefined || (km != null && km <= 0)) return "Intervalo de km inválido.";

  const meses = num(body.intervalo_meses);
  if (meses === undefined || (meses != null && (meses <= 0 || meses > 120))) {
    return "Intervalo de meses inválido.";
  }

  const raw = Array.isArray(body.insumos) ? body.insumos : [];
  const insumos: ServicioInput["insumos"] = [];
  for (const x of raw) {
    if (!x || typeof x !== "object") return "Insumos inválidos.";
    const i = x as Record<string, unknown>;
    const pid = String(i.insumo_producto_id ?? "");
    if (!pid) return "Falta el producto de un insumo.";
    const cant = num(i.cantidad);
    if (cant === undefined || cant == null || cant <= 0) {
      return "La cantidad de cada insumo tiene que ser mayor a cero.";
    }
    // En la UI la merma se escribe como porcentaje; en la base es una FRACCION
    // (0.05 = 5%), que es lo que exige el CHECK de la tabla.
    const merma = num(i.merma_pct) ?? 0;
    if (merma === undefined || merma < 0 || merma >= 100) return "Merma inválida.";
    if (insumos.some((y) => y.insumo_producto_id === pid)) {
      return "Un mismo producto no puede estar dos veces como insumo.";
    }
    insumos.push({
      insumo_producto_id: pid,
      cantidad: cant,
      unidad_medida: typeof i.unidad_medida === "string" && i.unidad_medida ? i.unidad_medida : null,
      merma_pct: merma / 100,
    });
  }

  return {
    nombre,
    sku: typeof body.sku === "string" ? body.sku : null,
    precio_venta: precio,
    mano_obra: manoObra,
    margen_pct: margen,
    intervalo_km: km,
    intervalo_meses: meses,
    activo: body.activo !== false,
    insumos,
  };
}

export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const servicios = await listServicios(ctx.supabase, ctx.auth.empresa_id);
    return NextResponse.json(successResponse({ servicios }));
  } catch (err) {
    console.error("[/api/servicios GET]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudieron cargar los servicios."), { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const input = parseServicio(body);
    if (typeof input === "string") {
      return NextResponse.json(errorResponse(input), { status: 400 });
    }
    const servicio = await crearServicio(ctx.supabase, ctx.auth.empresa_id, input);
    return NextResponse.json(successResponse({ servicio }), { status: 201 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/duplicate key|sku/i.test(msg)) {
      return NextResponse.json(errorResponse("Ya existe un producto con ese SKU."), { status: 409 });
    }
    console.error("[/api/servicios POST]", msg);
    return NextResponse.json(errorResponse("No se pudo crear el servicio."), { status: 500 });
  }
}
