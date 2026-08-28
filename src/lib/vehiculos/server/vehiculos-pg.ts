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
  aceite_tipo: string | null;
  aceite_litros: string | number | null;
  intervalo_km: string | number | null;
  intervalo_meses: number | null;
  avisar_inactivo_dias: number | null;
  imagen_path: string | null;
  ultima_visita: string | null;
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
              v.km_actual, v.km_actualizado_at, v.aceite_tipo, v.aceite_litros,
              v.intervalo_km, v.intervalo_meses, v.avisar_inactivo_dias,
              v.imagen_path, v.observaciones, v.activo, v.created_at, v.updated_at`;

/**
 * Ultima vez que el auto paso por el taller. Va como subconsulta y no como JOIN
 * para no multiplicar filas ni obligar a un GROUP BY de todas las columnas.
 */
function colUltimaVisita(schema: string): string {
  const tVV = quoteSchemaTable(schema, "ventas_vehiculos");
  const tVen = quoteSchemaTable(schema, "ventas");
  return `, (SELECT MAX(ven.fecha)::text
               FROM ${tVV} vv
               JOIN ${tVen} ven ON ven.id = vv.venta_id AND ven.empresa_id = vv.empresa_id
              WHERE vv.vehiculo_id = v.id AND vv.empresa_id = v.empresa_id
                AND ven.estado <> 'anulada') AS ultima_visita`;
}

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
    `SELECT ${COLS}${colUltimaVisita(schema)} FROM ${from(schema)}
      WHERE ${where.join(" AND ")}
      ORDER BY v.activo DESC, v.patente ASC`,
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
    `SELECT ${COLS}${colUltimaVisita(schema)} FROM ${from(schema)}
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
    `SELECT ${COLS}${colUltimaVisita(schema)} FROM ${from(schema)}
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
  aceite_tipo?: string | null;
  aceite_litros?: number | null;
  intervalo_km?: number | null;
  intervalo_meses?: number | null;
  avisar_inactivo_dias?: number | null;
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
        vin, color, km_actual, km_actualizado_at, aceite_tipo, aceite_litros,
        intervalo_km, intervalo_meses, avisar_inactivo_dias,
        observaciones, activo, created_by)
     VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8, $9, $10, $11,
             CASE WHEN $11::numeric IS NULL THEN NULL ELSE now() END, $12, $13,
             $14::numeric, $15::int, $16::int, $17, $18, $19::uuid)
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
      d.aceite_tipo ?? null,
      d.aceite_litros ?? null,
      d.intervalo_km ?? null,
      d.intervalo_meses ?? null,
      d.avisar_inactivo_dias ?? null,
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
  if (d.aceite_tipo !== undefined) push("aceite_tipo", d.aceite_tipo);
  if (d.aceite_litros !== undefined) push("aceite_litros", d.aceite_litros);
  if (d.intervalo_km !== undefined) push("intervalo_km", d.intervalo_km);
  if (d.intervalo_meses !== undefined) push("intervalo_meses", d.intervalo_meses);
  if (d.avisar_inactivo_dias !== undefined) push("avisar_inactivo_dias", d.avisar_inactivo_dias);
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

/** Una linea de la atencion: que se le hizo o que se le puso al vehiculo. */
export interface ItemServicioVehiculo {
  producto_id: string | null;
  producto_nombre: string;
  sku: string | null;
  marca: string | null;
  cantidad: string | number;
  /** Unidad del producto (L, UNIDAD...). Sale del catalogo, no de la linea. */
  unidad_medida: string | null;
  presentacion_nombre: string | null;
  total_linea: string | number;
  /** true si el producto define un mantenimiento (tiene intervalo cargado). */
  es_servicio: boolean;
}

export interface ServicioVehiculoRow {
  venta_id: string;
  numero_control: string;
  fecha: string;
  estado: string;
  total: string | number;
  km_registrado: string | number | null;
  /**
   * Km recorridos desde la visita anterior. NULL si a alguna de las dos le
   * falta la lectura del odometro. Contesta "cuanto usa el auto por mes",
   * que es lo que permite estimar cuando toca el proximo servicio.
   */
  km_recorridos: string | number | null;
  /** Lo que anoto el taller en la venta (ej. "pierde aceite por el reten"). */
  observaciones: string | null;
  items: ItemServicioVehiculo[];
}

/**
 * Historial de atenciones del vehiculo, de la mas reciente a la mas vieja,
 * con el detalle de cada una: que se le hizo, que se le puso y en que
 * cantidad. Es lo que se mira cuando el cliente pregunta que le pusieron la
 * vez pasada.
 *
 * Solo entran las ventas donde el cajero cargo el kilometraje. Esa lectura es
 * la que marca que el auto realmente paso por el taller: sin ella no se puede
 * calcular cuando toca el proximo mantenimiento, y la venta seria una linea
 * muerta en la ficha. Una venta de mostrador con el auto elegido pero sin
 * odometro queda fuera, que es lo correcto.
 */
export async function listServiciosDeVehiculo(
  schemaRaw: string,
  empresaId: string,
  vehiculoId: string
): Promise<ServicioVehiculoRow[]> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const tV = quoteSchemaTable(schema, "ventas");
  const tI = quoteSchemaTable(schema, "ventas_items");
  const tP = quoteSchemaTable(schema, "productos");
  const tVV = quoteSchemaTable(schema, "ventas_vehiculos");
  const { rows } = await pool().query<ServicioVehiculoRow>(
    `SELECT v.id::text AS venta_id, v.numero_control, v.fecha, v.estado,
            -- El total de la venta puede cubrir varios autos; lo que le toco a
            -- ESTE es la suma de sus propias lineas.
            COALESCE((
              SELECT SUM(i.total_linea) FROM ${tI} i
               WHERE i.venta_id = v.id AND i.empresa_id = v.empresa_id
                 AND i.vehiculo_id = $2::uuid
            ), 0) AS total,
            vv.km_registrado, v.observaciones,
            -- Diferencia contra la lectura de la visita anterior. Las anuladas
            -- se excluyen del calculo particionando por ese mismo criterio.
            CASE WHEN v.estado <> 'anulada'
                 THEN vv.km_registrado - LAG(vv.km_registrado) OVER (
                        PARTITION BY (v.estado = 'anulada') ORDER BY v.fecha
                      )
            END AS km_recorridos,
            COALESCE((
              SELECT json_agg(
                       json_build_object(
                         'producto_id', i.producto_id::text,
                         'producto_nombre', i.producto_nombre,
                         'sku', i.sku,
                         'marca', p.marca,
                         'cantidad', i.cantidad,
                         'unidad_medida', p.unidad_medida,
                         'presentacion_nombre', i.presentacion_nombre,
                         'total_linea', i.total_linea,
                         'es_servicio', (p.servicio_intervalo_km IS NOT NULL
                                         OR p.servicio_intervalo_meses IS NOT NULL)
                       )
                       -- Primero lo que marca el mantenimiento (el aceite),
                       -- despues el resto de lo que se le puso.
                       ORDER BY (p.servicio_intervalo_km IS NOT NULL
                                 OR p.servicio_intervalo_meses IS NOT NULL) DESC, i.id
                     )
                FROM ${tI} i
                LEFT JOIN ${tP} p ON p.id = i.producto_id AND p.empresa_id = i.empresa_id
               WHERE i.venta_id = v.id AND i.empresa_id = v.empresa_id
                 -- Solo lo que se le puso a ESTE auto: una venta con flota
                 -- tiene lineas de varios.
                 AND i.vehiculo_id = $2::uuid
            ), '[]'::json) AS items
       FROM ${tVV} vv
       JOIN ${tV} v ON v.id = vv.venta_id AND v.empresa_id = vv.empresa_id
      WHERE vv.empresa_id = $1::uuid AND vv.vehiculo_id = $2::uuid
        AND vv.km_registrado IS NOT NULL
      ORDER BY v.fecha DESC, v.numero_control DESC`,
    [empresaId, vehiculoId]
  );
  return rows;
}

/**
 * Avanza el odometro del vehiculo si la lectura nueva es mayor que la guardada.
 * Si es menor o igual, no toca nada: el odometro no retrocede y una venta vieja
 * cargada tarde no debe pisar la lectura actual.
 */
export async function actualizarKmSiAvanza(
  schemaRaw: string,
  empresaId: string,
  vehiculoId: string,
  km: number
): Promise<boolean> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const t = quoteSchemaTable(schema, "vehiculos");
  const r = await pool().query(
    `UPDATE ${t}
        SET km_actual = $3::numeric, km_actualizado_at = now()
      WHERE empresa_id = $1::uuid AND id = $2::uuid
        AND (km_actual IS NULL OR km_actual < $3::numeric)`,
    [empresaId, vehiculoId, km]
  );
  return (r.rowCount ?? 0) > 0;
}


/** Cuantas ventas quedarian huerfanas si se borrara este vehiculo. */
export async function contarVentasDeVehiculo(
  schemaRaw: string,
  empresaId: string,
  id: string
): Promise<number> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const t = quoteSchemaTable(schema, "ventas_vehiculos");
  const { rows } = await pool().query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM ${t}
      WHERE empresa_id = $1::uuid AND vehiculo_id = $2::uuid`,
    [empresaId, id]
  );
  return Number(rows[0]?.n ?? 0);
}

/**
 * Borra el vehiculo de verdad. Solo debe llamarse cuando no tiene ninguna venta
 * asociada: la FK ventas.vehiculo_id es ON DELETE SET NULL, asi que un borrado
 * con historial no falla — deja las ventas huerfanas y pierde el historial del
 * auto sin avisar. Quien llama tiene que verificarlo antes.
 */
export async function eliminarVehiculo(
  schemaRaw: string,
  empresaId: string,
  id: string
): Promise<boolean> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const t = quoteSchemaTable(schema, "vehiculos");
  const r = await pool().query(
    `DELETE FROM ${t} WHERE empresa_id = $1::uuid AND id = $2::uuid`,
    [empresaId, id]
  );
  return (r.rowCount ?? 0) > 0;
}
