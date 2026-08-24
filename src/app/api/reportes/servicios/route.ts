import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import {
  listCatalogoServicios,
  listRentabilidadServicios,
} from "@/lib/reportes/server/servicios-lubricentro-pg";

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const num = (v: unknown) => (v == null ? 0 : Number(v) || 0);
const numN = (v: unknown) => (v == null ? null : Number.isFinite(Number(v)) ? Number(v) : null);

/**
 * GET /api/reportes/servicios?desde&hasta
 *
 * Devuelve el catalogo completo de servicios (con su costo teorico segun receta,
 * exista o no venta) y la rentabilidad de los que si se vendieron en el rango.
 * El catalogo es util antes de tener ventas: permite revisar precios.
 */
export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const schema = await fetchDataSchemaForEmpresaId(ctx.auth.empresa_id);
    const empresaId = ctx.auth.empresa_id;

    const sp = request.nextUrl.searchParams;
    const hoy = new Date();
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    const desde = YMD.test(sp.get("desde") ?? "")
      ? sp.get("desde")!
      : iso(new Date(hoy.getFullYear(), hoy.getMonth(), 1));
    const hasta = YMD.test(sp.get("hasta") ?? "") ? sp.get("hasta")! : iso(hoy);
    if (desde > hasta) {
      return NextResponse.json(errorResponse("El rango de fechas es inválido."), { status: 400 });
    }

    // Serializado: el pool del pooler es chico, no conviene paralelizar.
    const catalogo = await listCatalogoServicios(schema, empresaId);
    const rentabilidad = await listRentabilidadServicios(schema, empresaId, desde, hasta);

    const rentPorId = new Map(rentabilidad.map((r) => [r.producto_id, r]));

    const items = catalogo.map((c) => {
      const r = rentPorId.get(c.producto_id);
      const costoTeorico = numN(c.costo_receta_unitario);
      const precio = num(c.precio_venta);
      return {
        producto_id: c.producto_id,
        nombre: c.nombre,
        sku: c.sku,
        precio_venta: precio,
        costo_teorico: costoTeorico,
        margen_teorico: costoTeorico != null ? precio - costoTeorico : null,
        margen_teorico_pct: costoTeorico != null && precio > 0 ? ((precio - costoTeorico) / precio) * 100 : null,
        tiene_receta: Boolean(c.tiene_receta),
        insumos: Number(c.insumos) || 0,
        intervalo_km: numN(c.intervalo_km),
        intervalo_meses: c.intervalo_meses != null ? Number(c.intervalo_meses) : null,
        // Realizado en el rango (0 si no se vendió).
        veces: r ? Number(r.veces) || 0 : 0,
        unidades: r ? num(r.unidades) : 0,
        facturado: r ? num(r.facturado) : 0,
        costo: r ? num(r.costo) : 0,
        margen: r ? num(r.margen) : 0,
        margen_pct: r ? numN(r.margen_pct) : null,
        ultima_vez: r?.ultima_vez ?? null,
      };
    });

    // Servicios vendidos que ya no están activos en el catálogo: no se pierden.
    for (const r of rentabilidad) {
      if (items.some((i) => i.producto_id === r.producto_id)) continue;
      items.push({
        producto_id: r.producto_id,
        nombre: r.nombre,
        sku: r.sku,
        precio_venta: 0,
        costo_teorico: numN(r.costo_receta_unitario),
        margen_teorico: null,
        margen_teorico_pct: null,
        tiene_receta: Boolean(r.tiene_receta),
        insumos: 0,
        intervalo_km: numN(r.intervalo_km),
        intervalo_meses: r.intervalo_meses != null ? Number(r.intervalo_meses) : null,
        veces: Number(r.veces) || 0,
        unidades: num(r.unidades),
        facturado: num(r.facturado),
        costo: num(r.costo),
        margen: num(r.margen),
        margen_pct: numN(r.margen_pct),
        ultima_vez: r.ultima_vez,
      });
    }

    items.sort((a, b) => b.facturado - a.facturado || a.nombre.localeCompare(b.nombre));

    return NextResponse.json(
      successResponse({
        desde,
        hasta,
        items,
        totales: {
          servicios: items.length,
          sin_receta: items.filter((i) => !i.tiene_receta).length,
          realizados: items.reduce((s, i) => s + i.veces, 0),
          facturado: items.reduce((s, i) => s + i.facturado, 0),
          costo: items.reduce((s, i) => s + i.costo, 0),
          margen: items.reduce((s, i) => s + i.margen, 0),
        },
      })
    );
  } catch (err) {
    console.error("[/api/reportes/servicios]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo cargar el reporte de servicios."), { status: 500 });
  }
}
