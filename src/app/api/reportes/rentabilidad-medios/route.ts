import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { listRentabilidadPorMedio } from "@/lib/reportes/server/rentabilidad-medios-pg";

const YMD = /^\d{4}-\d{2}-\d{2}$/;

/** GET /api/reportes/rentabilidad-medios?desde=YYYY-MM-DD&hasta=YYYY-MM-DD */
export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const schema = await fetchDataSchemaForEmpresaId(ctx.auth.empresa_id);

    const sp = request.nextUrl.searchParams;
    const hoy = new Date();
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    const primeroMes = new Date(hoy.getFullYear(), hoy.getMonth(), 1);

    const desde = YMD.test(sp.get("desde") ?? "") ? sp.get("desde")! : iso(primeroMes);
    const hasta = YMD.test(sp.get("hasta") ?? "") ? sp.get("hasta")! : iso(hoy);
    if (desde > hasta) {
      return NextResponse.json(errorResponse("El rango de fechas es inválido."), { status: 400 });
    }

    const rows = await listRentabilidadPorMedio(schema, ctx.auth.empresa_id, desde, hasta);
    const num = (v: unknown) => (v == null ? 0 : Number(v) || 0);

    const items = rows.map((r) => ({
      metodo_pago: r.metodo_pago,
      entidad_nombre: r.entidad_nombre,
      comision_porcentaje: r.comision_porcentaje != null ? Number(r.comision_porcentaje) : null,
      operaciones: Number(r.operaciones) || 0,
      bruto: num(r.bruto),
      comision: num(r.comision),
      neto: num(r.neto),
      costo: num(r.costo),
      margen: num(r.margen),
    }));

    const suma = (k: "bruto" | "comision" | "neto" | "costo" | "margen") =>
      items.reduce((s, i) => s + i[k], 0);

    return NextResponse.json(
      successResponse({
        desde,
        hasta,
        items,
        totales: {
          bruto: suma("bruto"),
          comision: suma("comision"),
          neto: suma("neto"),
          costo: suma("costo"),
          margen: suma("margen"),
        },
      })
    );
  } catch (err) {
    console.error("[/api/reportes/rentabilidad-medios]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo calcular la rentabilidad."), { status: 500 });
  }
}
