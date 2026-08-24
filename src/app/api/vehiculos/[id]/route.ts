import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import {
  getVehiculo,
  updateVehiculo,
  desactivarVehiculo,
  findVehiculoByPatente,
  listServiciosDeVehiculo,
} from "@/lib/vehiculos/server/vehiculos-pg";
import { mapVehiculoRow } from "../route";
import { COMBUSTIBLES, type Combustible, type ServicioVehiculo } from "@/lib/vehiculos/types";

function txt(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

/** GET /api/vehiculos/[id] — ficha + historial de servicios del vehículo. */
export async function GET(request: NextRequest, ctxParams: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const schema = await fetchDataSchemaForEmpresaId(ctx.auth.empresa_id);
    const { id } = await ctxParams.params;

    const row = await getVehiculo(schema, ctx.auth.empresa_id, id);
    if (!row) return NextResponse.json(errorResponse("Vehículo no encontrado."), { status: 404 });

    const servRows = await listServiciosDeVehiculo(schema, ctx.auth.empresa_id, id);
    const servicios: ServicioVehiculo[] = servRows.map((s) => ({
      venta_id: s.venta_id,
      numero_control: s.numero_control,
      fecha: s.fecha,
      estado: s.estado,
      total: Number(s.total ?? 0),
      km_registrado: s.km_registrado != null ? Number(s.km_registrado) : null,
      detalle: s.detalle ?? [],
    }));

    return NextResponse.json(
      successResponse({ vehiculo: mapVehiculoRow(row), servicios })
    );
  } catch (err) {
    console.error("[/api/vehiculos/[id] GET]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo cargar el vehículo."), { status: 500 });
  }
}

/** PATCH /api/vehiculos/[id] — edición parcial. */
export async function PATCH(request: NextRequest, ctxParams: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const schema = await fetchDataSchemaForEmpresaId(ctx.auth.empresa_id);
    const { id } = await ctxParams.params;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(errorResponse("JSON inválido."), { status: 400 });
    }
    const o = (body ?? {}) as Record<string, unknown>;

    const actual = await getVehiculo(schema, ctx.auth.empresa_id, id);
    if (!actual) return NextResponse.json(errorResponse("Vehículo no encontrado."), { status: 404 });

    const patch: Parameters<typeof updateVehiculo>[3] = {};

    if (o.patente !== undefined) {
      const p = txt(o.patente);
      if (!p) return NextResponse.json(errorResponse("La patente no puede quedar vacía."), { status: 400 });
      const otro = await findVehiculoByPatente(schema, ctx.auth.empresa_id, p);
      if (otro && otro.id !== id) {
        return NextResponse.json(
          errorResponse(`Ya existe otro vehículo con la patente ${otro.patente}.`),
          { status: 409 }
        );
      }
      patch.patente = p;
    }
    if (o.cliente_id !== undefined) patch.cliente_id = txt(o.cliente_id);
    if (o.marca !== undefined) patch.marca = txt(o.marca);
    if (o.modelo !== undefined) patch.modelo = txt(o.modelo);
    if (o.motor !== undefined) patch.motor = txt(o.motor);
    if (o.vin !== undefined) patch.vin = txt(o.vin);
    if (o.color !== undefined) patch.color = txt(o.color);
    if (o.observaciones !== undefined) patch.observaciones = txt(o.observaciones);
    if (o.activo !== undefined) patch.activo = Boolean(o.activo);

    if (o.anio !== undefined) {
      const a = o.anio == null || o.anio === "" ? null : Number(o.anio);
      if (a != null && (!Number.isInteger(a) || a < 1900 || a > 2200)) {
        return NextResponse.json(errorResponse("Año inválido."), { status: 400 });
      }
      patch.anio = a;
    }
    if (o.km_actual !== undefined) {
      const k = o.km_actual == null || o.km_actual === "" ? null : Number(o.km_actual);
      if (k != null && (!Number.isFinite(k) || k < 0)) {
        return NextResponse.json(errorResponse("Kilometraje inválido."), { status: 400 });
      }
      // El odómetro no retrocede: se avisa en vez de pisar el dato en silencio.
      if (k != null && actual.km_actual != null && k < Number(actual.km_actual)) {
        return NextResponse.json(
          errorResponse(
            `El kilometraje nuevo (${k.toLocaleString("es-PY")}) es menor que el registrado (${Number(actual.km_actual).toLocaleString("es-PY")}).`
          ),
          { status: 400 }
        );
      }
      patch.km_actual = k;
    }
    if (o.combustible !== undefined) {
      const cb = txt(o.combustible);
      if (cb && !COMBUSTIBLES.includes(cb as Combustible)) {
        return NextResponse.json(errorResponse("Combustible inválido."), { status: 400 });
      }
      patch.combustible = cb;
    }

    const actualizado = await updateVehiculo(schema, ctx.auth.empresa_id, id, patch);
    if (!actualizado) return NextResponse.json(errorResponse("Vehículo no encontrado."), { status: 404 });
    return NextResponse.json(successResponse({ vehiculo: mapVehiculoRow(actualizado) }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (/ux_vehiculos_empresa_patente|duplicate key/i.test(msg)) {
      return NextResponse.json(errorResponse("Ya existe un vehículo con esa patente."), { status: 409 });
    }
    console.error("[/api/vehiculos/[id] PATCH]", msg || err);
    return NextResponse.json(errorResponse("No se pudo actualizar el vehículo."), { status: 500 });
  }
}

/**
 * DELETE /api/vehiculos/[id] — baja lógica (activo = false).
 * No se borra físicamente: las ventas históricas lo referencian y perder la
 * patente arruina el historial de servicios.
 */
export async function DELETE(request: NextRequest, ctxParams: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const schema = await fetchDataSchemaForEmpresaId(ctx.auth.empresa_id);
    const { id } = await ctxParams.params;

    const ok = await desactivarVehiculo(schema, ctx.auth.empresa_id, id);
    if (!ok) return NextResponse.json(errorResponse("Vehículo no encontrado."), { status: 404 });
    return NextResponse.json(successResponse({ desactivado: true }));
  } catch (err) {
    console.error("[/api/vehiculos/[id] DELETE]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo dar de baja el vehículo."), { status: 500 });
  }
}
