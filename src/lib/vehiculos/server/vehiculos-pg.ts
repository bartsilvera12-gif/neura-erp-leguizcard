/**
 * PG directo para Vehiculos. Mismo patron que proveedores-pg.ts:
 *   - getChatPostgresPool() + quoteSchemaTable()
 *   - schema validado por assertAllowedChatDataSchema()
 *   - valores siempre via placeholders $N
 */
import { getChatPostgresPool, quoteSchemaTable } from "@/lib/supabase/chat-pg-pool";
import { assertAllowedChatDataSchema } from "@/lib/supabase/chat-data-schema";
import type { Pool } from "pg";

function pool(): Pool {
  const p = getChatPostgresPool();
  if (!p) throw new Error("Pool de Postgres no disponible.");
  return p;
}

export interface VehiculoRow {
  id: string;
  empresa_id: string;
  cliente_id: string | null;
  cliente_nombre: string | null;
  patente: string;
  marca: string | null;
  modelo: string | null;
  anio: number | null;
  motor: string | null;
  combustible: string | null;
  vin: string | null;
  color: string | null;
  km_actual: string | number | null;
  km_actualizado_at: string | null;
  observaciones: string | null;
  activo: boolean;
  created_at: string;
  updated_at: string;
}

const COLS = `v.id::text AS id, v.empresa_id::text AS empresa_id, v.cliente_id::text AS cliente_id,
              -- Mismo criterio que clienteNombre(): razon social si es empresa,
              -- si no el contacto. La columna nombre queda de ultimo recurso.
              COALESCE(
                CASE WHEN c.tipo_cliente = 'empresa' THEN NULLIF(btrim(c.empresa), '') END,
                NULLIF(btrim(c.nombre_contacto), ''),
                NULLIF(btrim(c.nombre), '')
              ) AS cliente_nombre,
              v.patente, v.marca, v.modelo, v.anio, v.motor, v.combustible, v.vin, v.color,
              v.km_actual, v.km_actualizado_at, v.observaciones, v.activo, v.created_at, v.updated_at`;

function from(schema: string): string {
  return `${quoteSchemaTable(schema, "vehiculos")} v
          LEFT JOIN ${quoteSchemaTable(schema, "clientes")} c
                 ON c.id = v.cliente_id AND c.empresa_id = v.empresa_id`;
}

export async function listVehiculos(
  schemaRaw: string,
  empresaId: string,
  opts: { soloActivos?: boolean; clienteId?: string | null } = {}
): Promise<VehiculoRow[]> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const where = ["v.empresa_id = $1::uuid"];
  const args: unknown[] = [empresaId];
  if (opts.soloActivos) where.push("v.activo = true");
  if (opts.clienteId) {
    args.push(opts.clienteId);
    where.push(`v.cliente_id = $${args.length}::uuid`);
  }
  const { rows } = await pool().query<VehiculoRow>(
    `SELECT ${COLS} FROM ${from(schema)}
      WHERE ${where.join(" AND ")}
      ORDER BY v.activo DESC, v.patente ASC
      LIMIT 5000`,
    args
  );
  return rows;
}

export async function getVehiculo(
  schemaRaw: string,
  empresaId: string,
  id: string
): Promise<VehiculoRow | null> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const { rows } = await pool().query<VehiculoRow>(
    `SELECT ${COLS} FROM ${from(schema)}
      WHERE v.empresa_id = $1::uuid AND v.id = $2::uuid LIMIT 1`,
    [empresaId, id]
  );
  return rows[0] ?? null;
}

/** Busca por patente normalizada (misma expresion que el indice unico). */
export async function findVehiculoByPatente(
  schemaRaw: string,
  empresaId: string,
  patente: string
): Promise<VehiculoRow | null> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const { rows } = await pool().query<VehiculoRow>(
    `SELECT ${COLS} FROM ${from(schema)}
      WHERE v.empresa_id = $1::uuid
        AND upper(regexp_replace(v.patente, '[^A-Za-z0-9]', '', 'g')) = upper(regexp_replace($2, '[^A-Za-z0-9]', '', 'g'))
      LIMIT 1`,
    [empresaId, patente]
  );
  return rows[0] ?? null;
}

export interface VehiculoInput {
  cliente_id?: string | null;
  patente: string;
  marca?: string | null;
  modelo?: string | null;
  anio?: number | null;
  motor?: string | null;
  combustible?: string | null;
  vin?: string | null;
  color?: string | null;
  km_actual?: number | null;
  observaciones?: string | null;
  activo?: boolean;
}

export async function insertVehiculo(
  schemaRaw: string,
  empresaId: string,
  d: VehiculoInput,
  createdBy: string | null
): Promise<VehiculoRow> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const t = quoteSchemaTable(schema, "vehiculos");
  const { rows } = await pool().query<{ id: string }>(
    `INSERT INTO ${t}
       (empresa_id, cliente_id, patente, marca, modelo, anio, motor, combustible,
        vin, color, km_actual, km_actualizado_at, observaciones, activo, created_by)
     VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8, $9, $10, $11,
             CASE WHEN $11::numeric IS NULL THEN NULL ELSE now() END, $12, $13, $14::uuid)
     RETURNING id::text AS id`,
    [
      empresaId,
      d.cliente_id ?? null,
      d.patente.trim(),
      d.marca ?? null,
      d.modelo ?? null,
      d.anio ?? null,
      d.motor ?? null,
      d.combustible ?? null,
      d.vin ?? null,
      d.color ?? null,
      d.km_actual ?? null,
      d.observaciones ?? null,
      d.activo ?? true,
      createdBy,
    ]
  );
  const creado = await getVehiculo(schema, empresaId, rows[0].id);
  if (!creado) throw new Error("No se pudo leer el vehículo recién creado.");
  return creado;
}

export async function updateVehiculo(
  schemaRaw: string,
  empresaId: string,
  id: string,
  d: Partial<VehiculoInput>
): Promise<VehiculoRow | null> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const t = quoteSchemaTable(schema, "vehiculos");

  const sets: string[] = [];
  const args: unknown[] = [];
  const push = (col: string, val: unknown, cast = "") => {
    args.push(val);
    sets.push(`${col} = $${args.length}${cast}`);
  };

  if (d.cliente_id !== undefined) push("cliente_id", d.cliente_id, "::uuid");
  if (d.patente !== undefined) push("patente", d.patente.trim());
  if (d.marca !== undefined) push("marca", d.marca);
  if (d.modelo !== undefined) push("modelo", d.modelo);
  if (d.anio !== undefined) push("anio", d.anio);
  if (d.motor !== undefined) push("motor", d.motor);
  if (d.combustible !== undefined) push("combustible", d.combustible);
  if (d.vin !== undefined) push("vin", d.vin);
  if (d.color !== undefined) push("color", d.color);
  if (d.observaciones !== undefined) push("observaciones", d.observaciones);
  if (d.activo !== undefined) push("activo", d.activo);
  if (d.km_actual !== undefined) {
    push("km_actual", d.km_actual);
    sets.push("km_actualizado_at = now()");
  }

  if (sets.length === 0) return getVehiculo(schema, empresaId, id);

  args.push(empresaId, id);
  await pool().query(
    `UPDATE ${t} SET ${sets.join(", ")}
      WHERE empresa_id = $${args.length - 1}::uuid AND id = $${args.length}::uuid`,
    args
  );
  return getVehiculo(schema, empresaId, id);
}

/**
 * Baja logica. No se borra fisicamente: las ventas historicas referencian el
 * vehiculo y perder la patente arruina el historial.
 */
export async function desactivarVehiculo(
  schemaRaw: string,
  empresaId: string,
  id: string
): Promise<boolean> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const t = quoteSchemaTable(schema, "vehiculos");
  const r = await pool().query(
    `UPDATE ${t} SET activo = false WHERE empresa_id = $1::uuid AND id = $2::uuid`,
    [empresaId, id]
  );
  return (r.rowCount ?? 0) > 0;
}

export interface ServicioVehiculoRow {
  venta_id: string;
  numero_control: string;
  fecha: string;
  estado: string;
  total: string | number;
  km_registrado: string | number | null;
  detalle: string[] | null;
}

/** Historial de atenciones del vehiculo, de la mas reciente a la mas vieja. */
export async function listServiciosDeVehiculo(
  schemaRaw: string,
  empresaId: string,
  vehiculoId: string
): Promise<ServicioVehiculoRow[]> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const tV = quoteSchemaTable(schema, "ventas");
  const tI = quoteSchemaTable(schema, "ventas_items");
  const { rows } = await pool().query<ServicioVehiculoRow>(
    `SELECT v.id::text AS venta_id, v.numero_control, v.fecha, v.estado,
            v.total, v.km_registrado,
            ARRAY(
              SELECT i.producto_nombre FROM ${tI} i
               WHERE i.venta_id = v.id AND i.empresa_id = v.empresa_id
               ORDER BY i.id
            ) AS detalle
       FROM ${tV} v
      WHERE v.empresa_id = $1::uuid AND v.vehiculo_id = $2::uuid
      ORDER BY v.fecha DESC, v.numero_control DESC
      LIMIT 500`,
    [empresaId, vehiculoId]
  );
  return rows;
}
