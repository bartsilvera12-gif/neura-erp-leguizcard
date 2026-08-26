import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import {
  getVehiculo,
  updateVehiculo,
  contarVentasDeVehiculo,
  desactivarVehiculo,
  eliminarVehiculo,
  findVehiculoByPatente,
  listServiciosDeVehiculo,
} from "@/lib/vehiculos/server/vehiculos-pg";
import { listEstadoServiciosDeVehiculo } from "@/lib/vehiculos/server/proximos-servicios-pg";
import { mapVehiculoRow } from "../route";
import { signVehiculoImagen } from "@/lib/vehiculos/imagen-storage";
import {
  COMBUSTIBLES,
  type Combustible,
  type ServicioVehiculo,
  type EstadoServicioVehiculo,
} from "@/lib/vehiculos/types";

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
    const imagenUrl = await signVehiculoImagen(ctx.supabase, row.imagen_path);

    const [servRows, estadoRows, ventasAsociadas] = await Promise.all([
      listServiciosDeVehiculo(schema, ctx.auth.empresa_id, id),
      listEstadoServiciosDeVehiculo(schema, ctx.auth.empresa_id, id),
      contarVentasDeVehiculo(schema, ctx.auth.empresa_id, id),
    ]);

    const servicios: ServicioVehiculo[] = servRows.map((s) => ({
      venta_id: s.venta_id,
      numero_control: s.numero_control,
      fecha: s.fecha,
      estado: s.estado,
      total: Number(s.total ?? 0),
      km_registrado: s.km_registrado != null ? Number(s.km_registrado) : null,
      km_recorridos: s.km_recorridos != null ? Number(s.km_recorridos) : null,
      observaciones: s.observaciones,
      items: (s.items ?? []).map((i) => ({
        producto_id: i.producto_id,
        producto_nombre: i.producto_nombre,
        sku: i.sku,
        marca: i.marca,
        cantidad: Number(i.cantidad ?? 0),
        unidad_medida: i.unidad_medida,
        presentacion_nombre: i.presentacion_nombre,
        total_linea: Number(i.total_linea ?? 0),
        es_servicio: i.es_servicio === true,
      })),
    }));

    const proximos: EstadoServicioVehiculo[] = estadoRows.map((e) => ({
      producto_id: e.producto_id,
      servicio_nombre: e.servicio_nombre,
      intervalo_km: e.intervalo_km != null ? Number(e.intervalo_km) : null,
      intervalo_meses: e.intervalo_meses,
      ultima_fecha: e.ultima_fecha,
      ultimo_km: e.ultimo_km != null ? Number(e.ultimo_km) : null,
      proximo_km: e.proximo_km != null ? Number(e.proximo_km) : null,
      proxima_fecha: e.proxima_fecha,
      km_restantes: e.km_restantes != null ? Number(e.km_restantes) : null,
      dias_restantes: e.dias_restantes,
      vencido: e.vencido === true,
    }));

    return NextResponse.json(
      successResponse({
        vehiculo: { ...mapVehiculoRow(row), imagen_url: imagenUrl },
        servicios,
        proximos,
        ventasAsociadas,
      })
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
    if (o.aceite_tipo !== undefined) patch.aceite_tipo = txt(o.aceite_tipo);
    if (o.observaciones !== undefined) patch.observaciones = txt(o.observaciones);
    if (o.activo !== undefined) patch.activo = Boolean(o.activo);

    if (o.aceite_litros !== undefined) {
      const l = o.aceite_litros == null || o.aceite_litros === "" ? null : Number(o.aceite_litros);
      if (l != null && (!Number.isFinite(l) || l <= 0 || l > 100)) {
        return NextResponse.json(errorResponse("Litros de aceite inválidos."), { status: 400 });
      }
      patch.aceite_litros = l;
    }

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
/**
 * DELETE /api/vehiculos/[id]
 *   - por defecto: baja logica (activo = false). El auto sale de los listados
 *     pero conserva su historial.
 *   - ?definitivo=1: lo borra de verdad, y SOLO si no tiene ninguna venta.
 *
 * El borrado real esta acotado a proposito. La FK ventas.vehiculo_id es
 * ON DELETE SET NULL: borrar un auto con historial no da error, deja las ventas
 * huerfanas y el historial se pierde para siempre sin que nadie se entere. Con
 * ventas asociadas la unica opcion valida es la baja logica.
 */
export async function DELETE(request: NextRequest, ctxParams: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const schema = await fetchDataSchemaForEmpresaId(ctx.auth.empresa_id);
    const { id } = await ctxParams.params;
    const definitivo = request.nextUrl.searchParams.get("definitivo") === "1";

    if (definitivo) {
      const ventas = await contarVentasDeVehiculo(schema, ctx.auth.empresa_id, id);
      if (ventas > 0) {
        return NextResponse.json(
          errorResponse(
            `No se puede eliminar: el vehículo tiene ${ventas} ${ventas === 1 ? "venta asociada" : "ventas asociadas"}. ` +
              "Borrarlo dejaría esas ventas sin vehículo y se perdería su historial. Dalo de baja en su lugar."
          ),
          { status: 409 }
        );
      }
      const borrado = await eliminarVehiculo(schema, ctx.auth.empresa_id, id);
      if (!borrado) return NextResponse.json(errorResponse("Vehículo no encontrado."), { status: 404 });
      return NextResponse.json(successResponse({ eliminado: true }));
    }

    const ok = await desactivarVehiculo(schema, ctx.auth.empresa_id, id);
    if (!ok) return NextResponse.json(errorResponse("Vehículo no encontrado."), { status: 404 });
    return NextResponse.json(successResponse({ desactivado: true }));
  } catch (err) {
    console.error("[/api/vehiculos/[id] DELETE]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo eliminar el vehículo."), { status: 500 });
  }
}
