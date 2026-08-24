import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { listProximosServicios } from "@/lib/vehiculos/server/proximos-servicios-pg";
import type { ProximoServicio } from "@/lib/vehiculos/types";

/**
 * GET /api/vehiculos/proximos-servicios
 *   ?dias=30        ventana de aviso (default 30)
 *   ?vencidos=1     solo lo ya vencido
 */
export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const schema = await fetchDataSchemaForEmpresaId(ctx.auth.empresa_id);

    const sp = request.nextUrl.searchParams;
    const diasRaw = Number(sp.get("dias"));
    const dias = Number.isFinite(diasRaw) && diasRaw >= 0 && diasRaw <= 365 ? Math.floor(diasRaw) : 30;

    const rows = await listProximosServicios(schema, ctx.auth.empresa_id, {
      diasAnticipacion: dias,
      soloVencidos: sp.get("vencidos") === "1",
    });

    const num = (v: unknown): number | null =>
      v == null ? null : Number.isFinite(Number(v)) ? Number(v) : null;

    const items: ProximoServicio[] = rows.map((r) => ({
      vehiculo_id: r.vehiculo_id,
      patente: r.patente,
      marca: r.marca,
      modelo: r.modelo,
      cliente_id: r.cliente_id,
      cliente_nombre: r.cliente_nombre,
      cliente_telefono: r.cliente_telefono,
      km_actual: num(r.km_actual),
      producto_id: r.producto_id,
      servicio_nombre: r.servicio_nombre,
      intervalo_km: num(r.intervalo_km),
      intervalo_meses: r.intervalo_meses != null ? Number(r.intervalo_meses) : null,
      ultima_fecha: r.ultima_fecha,
      ultimo_km: num(r.ultimo_km),
      proximo_km: num(r.proximo_km),
      proxima_fecha: r.proxima_fecha,
      km_restantes: num(r.km_restantes),
      dias_restantes: r.dias_restantes != null ? Number(r.dias_restantes) : null,
      vencido: Boolean(r.vencido),
    }));

    return NextResponse.json(
      successResponse({
        items,
        vencidos: items.filter((i) => i.vencido).length,
        por_vencer: items.filter((i) => !i.vencido).length,
      })
    );
  } catch (err) {
    console.error("[/api/vehiculos/proximos-servicios]", err instanceof Error ? err.message : err);
    return NextResponse.json(
      errorResponse("No se pudieron calcular los próximos servicios."),
      { status: 500 }
    );
  }
}
