import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import {
  listVehiculos,
  insertVehiculo,
  findVehiculoByPatente,
  type VehiculoRow,
} from "@/lib/vehiculos/server/vehiculos-pg";
import { COMBUSTIBLES, type Combustible, type Vehiculo } from "@/lib/vehiculos/types";

export function mapVehiculoRow(r: VehiculoRow): Vehiculo {
  const comb = COMBUSTIBLES.includes(r.combustible as Combustible)
    ? (r.combustible as Combustible)
    : null;
  return {
    id: r.id,
    empresa_id: r.empresa_id,
    cliente_id: r.cliente_id,
    cliente_nombre: r.cliente_nombre,
    patente: r.patente,
    marca: r.marca,
    modelo: r.modelo,
    anio: r.anio != null ? Number(r.anio) : null,
    motor: r.motor,
    combustible: comb,
    vin: r.vin,
    color: r.color,
    km_actual: r.km_actual != null ? Number(r.km_actual) : null,
    km_actualizado_at: r.km_actualizado_at,
    aceite_tipo: r.aceite_tipo,
    aceite_litros: r.aceite_litros != null ? Number(r.aceite_litros) : null,
    observaciones: r.observaciones,
    activo: Boolean(r.activo),
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

/** Texto normalizado o null si viene vacio. */
function txt(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

/** GET /api/vehiculos — lista. `?cliente_id=` y `?activos=1` filtran. */
export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const schema = await fetchDataSchemaForEmpresaId(ctx.auth.empresa_id);

    const sp = request.nextUrl.searchParams;
    const rows = await listVehiculos(schema, ctx.auth.empresa_id, {
      soloActivos: sp.get("activos") === "1",
      clienteId: sp.get("cliente_id"),
    });
    return NextResponse.json(successResponse({ vehiculos: rows.map(mapVehiculoRow) }));
  } catch (err) {
    console.error("[/api/vehiculos GET]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudieron cargar los vehículos."), { status: 500 });
  }
}

/** POST /api/vehiculos — alta. La patente es obligatoria y única por empresa. */
export async function POST(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const schema = await fetchDataSchemaForEmpresaId(ctx.auth.empresa_id);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(errorResponse("JSON inválido."), { status: 400 });
    }
    const o = (body ?? {}) as Record<string, unknown>;

    const patente = txt(o.patente);
    if (!patente) {
      return NextResponse.json(errorResponse("La patente es obligatoria."), { status: 400 });
    }

    // Se avisa antes de intentar el INSERT para dar un error legible en vez del
    // 23505 del índice único.
    const existente = await findVehiculoByPatente(schema, ctx.auth.empresa_id, patente);
    if (existente) {
      return NextResponse.json(
        errorResponse(`Ya existe un vehículo con la patente ${existente.patente}.`),
        { status: 409 }
      );
    }

    const anioRaw = o.anio;
    const anio = anioRaw == null || anioRaw === "" ? null : Number(anioRaw);
    if (anio != null && (!Number.isInteger(anio) || anio < 1900 || anio > 2200)) {
      return NextResponse.json(errorResponse("Año inválido."), { status: 400 });
    }

    const kmRaw = o.km_actual;
    const km = kmRaw == null || kmRaw === "" ? null : Number(kmRaw);
    if (km != null && (!Number.isFinite(km) || km < 0)) {
      return NextResponse.json(errorResponse("Kilometraje inválido."), { status: 400 });
    }

    // Litros del cambio completo. El tope de 100 corta un cero de mas al tipear
    // y coincide con el CHECK de la tabla, para fallar aca con un mensaje claro
    // en vez de con el error de Postgres.
    const litrosRaw = o.aceite_litros;
    const litros = litrosRaw == null || litrosRaw === "" ? null : Number(litrosRaw);
    if (litros != null && (!Number.isFinite(litros) || litros <= 0 || litros > 100)) {
      return NextResponse.json(errorResponse("Litros de aceite inválidos."), { status: 400 });
    }

    const combustible = txt(o.combustible);
    if (combustible && !COMBUSTIBLES.includes(combustible as Combustible)) {
      return NextResponse.json(errorResponse("Combustible inválido."), { status: 400 });
    }

    const creado = await insertVehiculo(
      schema,
      ctx.auth.empresa_id,
      {
        cliente_id: txt(o.cliente_id),
        patente,
        marca: txt(o.marca),
        modelo: txt(o.modelo),
        anio,
        motor: txt(o.motor),
        combustible,
        vin: txt(o.vin),
        color: txt(o.color),
        km_actual: km,
        aceite_tipo: txt(o.aceite_tipo),
        aceite_litros: litros,
        observaciones: txt(o.observaciones),
        activo: o.activo === undefined ? true : Boolean(o.activo),
      },
      ctx.auth.usuarioCatalogId ?? null
    );

    return NextResponse.json(successResponse({ vehiculo: mapVehiculoRow(creado) }), { status: 201 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (/ux_vehiculos_empresa_patente|duplicate key/i.test(msg)) {
      return NextResponse.json(errorResponse("Ya existe un vehículo con esa patente."), { status: 409 });
    }
    console.error("[/api/vehiculos POST]", msg || err);
    return NextResponse.json(errorResponse("No se pudo crear el vehículo."), { status: 500 });
  }
}
