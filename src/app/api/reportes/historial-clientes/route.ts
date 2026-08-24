import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { listHistorialClientes } from "@/lib/reportes/server/servicios-lubricentro-pg";

/** GET /api/reportes/historial-clientes — clientes con sus autos, visitas y gasto. */
export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const schema = await fetchDataSchemaForEmpresaId(ctx.auth.empresa_id);

    const rows = await listHistorialClientes(schema, ctx.auth.empresa_id);
    const items = rows.map((r) => {
      const visitas = Number(r.visitas) || 0;
      const facturado = Number(r.facturado) || 0;
      return {
        cliente_id: r.cliente_id,
        cliente_nombre: r.cliente_nombre,
        cliente_telefono: r.cliente_telefono,
        vehiculos: Number(r.vehiculos) || 0,
        patentes: r.patentes ?? [],
        visitas,
        facturado,
        ultima_visita: r.ultima_visita,
        dias_sin_venir: r.dias_sin_venir != null ? Number(r.dias_sin_venir) : null,
        ticket_promedio: visitas > 0 ? facturado / visitas : 0,
      };
    });

    return NextResponse.json(
      successResponse({
        items,
        totales: {
          clientes: items.length,
          con_vehiculo: items.filter((i) => i.vehiculos > 0).length,
          facturado: items.reduce((s, i) => s + i.facturado, 0),
          // Sin venir hace más de 6 meses: candidatos a recontactar.
          inactivos: items.filter((i) => i.visitas > 0 && (i.dias_sin_venir ?? 0) > 180).length,
        },
      })
    );
  } catch (err) {
    console.error("[/api/reportes/historial-clientes]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo cargar el historial de clientes."), {
      status: 500,
    });
  }
}
