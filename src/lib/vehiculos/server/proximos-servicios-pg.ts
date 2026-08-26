/**
 * Proximos servicios del lubricentro.
 *
 * Para cada par (vehiculo, servicio con intervalo configurado) busca la ULTIMA
 * vez que ese servicio se le hizo a ese vehiculo, y calcula cuando toca el
 * siguiente por kilometraje y/o por tiempo. Vence por lo que ocurra primero.
 *
 * Se apoya en:
 *   - productos.servicio_intervalo_km / servicio_intervalo_meses (el intervalo)
 *   - ventas.vehiculo_id + ventas.km_registrado (cuando y con cuantos km se hizo)
 *   - vehiculos.km_actual (cuanto tiene hoy)
 *
 * Las ventas anuladas se ignoran: un servicio anulado no cuenta como hecho.
 */
import { getChatPostgresPool, quoteSchemaTable } from "@/lib/supabase/chat-pg-pool";
import { assertAllowedChatDataSchema } from "@/lib/supabase/chat-data-schema";
import type { Pool } from "pg";

function pool(): Pool {
  const p = getChatPostgresPool();
  if (!p) throw new Error("Pool de Postgres no disponible.");
  return p;
}

export interface ProximoServicioRow {
  vehiculo_id: string;
  patente: string;
  marca: string | null;
  modelo: string | null;
  cliente_id: string | null;
  cliente_nombre: string | null;
  cliente_telefono: string | null;
  km_actual: string | number | null;
  producto_id: string;
  servicio_nombre: string;
  intervalo_km: string | number | null;
  intervalo_meses: number | null;
  ultima_fecha: string;
  ultimo_km: string | number | null;
  /** Km del odometro en que toca el proximo. NULL si el servicio no controla km. */
  proximo_km: string | number | null;
  /** Fecha en que toca el proximo. NULL si el servicio no controla tiempo. */
  proxima_fecha: string | null;
  /** Km que faltan (negativo = pasado). NULL si no controla km o falta km_actual. */
  km_restantes: string | number | null;
  /** Dias que faltan (negativo = pasado). NULL si no controla tiempo. */
  dias_restantes: number | null;
  /** true si ya vencio por km o por tiempo. */
  vencido: boolean;
}

/**
 * Reglas de vencimiento en un solo lugar: las usan el listado global de avisos
 * y la ficha del vehiculo. Si cada pantalla calculara por su cuenta, podrian
 * contestar distinto a "cuanto me falta" para el mismo auto.
 *
 * Referencian los alias s (servicio), u (ultima vez que se hizo) y veh.
 */
const SQL_PROXIMO_KM = `CASE WHEN s.servicio_intervalo_km IS NOT NULL AND u.ultimo_km IS NOT NULL
           THEN u.ultimo_km + s.servicio_intervalo_km END`;

const SQL_PROXIMA_FECHA = `CASE WHEN s.servicio_intervalo_meses IS NOT NULL
           THEN u.ultima_fecha + (s.servicio_intervalo_meses || ' months')::interval END`;

const SQL_KM_RESTANTES = `CASE WHEN s.servicio_intervalo_km IS NOT NULL AND u.ultimo_km IS NOT NULL AND veh.km_actual IS NOT NULL
           THEN (u.ultimo_km + s.servicio_intervalo_km) - veh.km_actual END`;

const SQL_DIAS_RESTANTES = `CASE WHEN s.servicio_intervalo_meses IS NOT NULL
           THEN EXTRACT(DAY FROM (u.ultima_fecha + (s.servicio_intervalo_meses || ' months')::interval) - now())::int END`;

/** Vencido por km, o por tiempo. Vence por lo que ocurra primero. */
const SQL_VENCIDO = `(
        (s.servicio_intervalo_km IS NOT NULL AND u.ultimo_km IS NOT NULL AND veh.km_actual IS NOT NULL
         AND veh.km_actual >= u.ultimo_km + s.servicio_intervalo_km)
        OR
        (s.servicio_intervalo_meses IS NOT NULL
         AND now() >= u.ultima_fecha + (s.servicio_intervalo_meses || ' months')::interval)
      )`;

/**
 * CTEs comunes: los servicios que tienen intervalo configurado, y la ultima vez
 * que cada uno se le hizo a cada vehiculo.
 *
 * @param filtroVehiculo predicado SQL extra sobre `ultimo` (la ficha mira un
 *   solo vehiculo; el listado global, todos).
 */
function cteServiciosYUltimo(
  tP: string,
  tVen: string,
  tIt: string,
  filtroVehiculo: string
): string {
  return `
    WITH servicios AS (
      -- Servicios con algun intervalo configurado.
      SELECT p.id, p.nombre, p.servicio_intervalo_km, p.servicio_intervalo_meses
        FROM ${tP} p
       WHERE p.empresa_id = $1::uuid
         AND p.tipo_producto = 'servicio'
         AND COALESCE(p.activo, true) = true
         AND (p.servicio_intervalo_km IS NOT NULL OR p.servicio_intervalo_meses IS NOT NULL)
    ),
    ultimo AS (
      -- Ultima vez que cada servicio se hizo sobre cada vehiculo.
      SELECT DISTINCT ON (v.vehiculo_id, i.producto_id)
             v.vehiculo_id, i.producto_id, v.fecha AS ultima_fecha, v.km_registrado AS ultimo_km
        FROM ${tVen} v
        JOIN ${tIt} i ON i.venta_id = v.id AND i.empresa_id = v.empresa_id
       WHERE v.empresa_id = $1::uuid
         AND v.vehiculo_id IS NOT NULL
         AND v.estado <> 'anulada'
         AND i.producto_id IN (SELECT id FROM servicios)
         ${filtroVehiculo}
       ORDER BY v.vehiculo_id, i.producto_id, v.fecha DESC
    )`;
}

/**
 * @param diasAnticipacion Ventana de aviso: incluye lo vencido y lo que vence
 *   dentro de estos dias. Por km usa una anticipacion proporcional (10% del
 *   intervalo) para avisar antes de que se pase.
 */
export async function listProximosServicios(
  schemaRaw: string,
  empresaId: string,
  opts: { diasAnticipacion?: number; soloVencidos?: boolean } = {}
): Promise<ProximoServicioRow[]> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const tVeh = quoteSchemaTable(schema, "vehiculos");
  const tVen = quoteSchemaTable(schema, "ventas");
  const tIt = quoteSchemaTable(schema, "ventas_items");
  const tP = quoteSchemaTable(schema, "productos");
  const tC = quoteSchemaTable(schema, "clientes");

  const dias = opts.diasAnticipacion ?? 30;

  const { rows } = await pool().query<ProximoServicioRow>(
    `
    ${cteServiciosYUltimo(tP, tVen, tIt, "")}
    SELECT
      veh.id::text                AS vehiculo_id,
      veh.patente,
      veh.marca,
      veh.modelo,
      veh.cliente_id::text        AS cliente_id,
      COALESCE(
        CASE WHEN c.tipo_cliente = 'empresa' THEN NULLIF(btrim(c.empresa), '') END,
        NULLIF(btrim(c.nombre_contacto), ''),
        NULLIF(btrim(c.nombre), '')
      )                           AS cliente_nombre,
      c.telefono                  AS cliente_telefono,
      veh.km_actual,
      s.id::text                  AS producto_id,
      s.nombre                    AS servicio_nombre,
      s.servicio_intervalo_km     AS intervalo_km,
      s.servicio_intervalo_meses  AS intervalo_meses,
      u.ultima_fecha,
      u.ultimo_km,
      ${SQL_PROXIMO_KM}    AS proximo_km,
      ${SQL_PROXIMA_FECHA} AS proxima_fecha,
      ${SQL_KM_RESTANTES}  AS km_restantes,
      ${SQL_DIAS_RESTANTES} AS dias_restantes,
      ${SQL_VENCIDO}       AS vencido
      FROM ultimo u
      JOIN servicios s ON s.id = u.producto_id
      JOIN ${tVeh} veh ON veh.id = u.vehiculo_id AND veh.empresa_id = $1::uuid
      LEFT JOIN ${tC} c ON c.id = veh.cliente_id AND c.empresa_id = veh.empresa_id
     WHERE COALESCE(veh.activo, true) = true
       AND (
         -- Vencido por km o por tiempo...
         ${SQL_VENCIDO}
         OR (
           -- ...o por vencer dentro de la ventana de aviso.
           $3::boolean = false
           AND (
             (s.servicio_intervalo_meses IS NOT NULL
              AND u.ultima_fecha + (s.servicio_intervalo_meses || ' months')::interval <= now() + ($2 || ' days')::interval)
             OR
             -- Anticipacion por km: 10% del intervalo.
             (s.servicio_intervalo_km IS NOT NULL AND u.ultimo_km IS NOT NULL AND veh.km_actual IS NOT NULL
              AND veh.km_actual >= u.ultimo_km + s.servicio_intervalo_km * 0.9)
           )
         )
       )
     ORDER BY vencido DESC, dias_restantes NULLS LAST, km_restantes NULLS LAST
     LIMIT 2000
    `,
    [empresaId, String(dias), opts.soloVencidos === true]
  );
  return rows;
}


/** Estado de un servicio para UN vehiculo, este vencido o no. */
export interface EstadoServicioVehiculoRow {
  producto_id: string;
  servicio_nombre: string;
  intervalo_km: string | number | null;
  intervalo_meses: number | null;
  ultima_fecha: string;
  ultimo_km: string | number | null;
  proximo_km: string | number | null;
  proxima_fecha: string | null;
  km_restantes: string | number | null;
  dias_restantes: number | null;
  vencido: boolean;
}

/**
 * Contesta "cuanto me falta para el mantenimiento" de un vehiculo puntual.
 *
 * A diferencia de listProximosServicios, que es la lista de avisos y por eso
 * solo trae lo vencido o por vencer, aca vienen TODOS los servicios que alguna
 * vez se le hicieron al auto, falten 200 km o 4.000. Si el cliente llama, el
 * dato tiene que estar igual.
 *
 * Ordenado por urgencia: primero lo vencido, despues lo que esta mas cerca.
 */
export async function listEstadoServiciosDeVehiculo(
  schemaRaw: string,
  empresaId: string,
  vehiculoId: string
): Promise<EstadoServicioVehiculoRow[]> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const tVeh = quoteSchemaTable(schema, "vehiculos");
  const tVen = quoteSchemaTable(schema, "ventas");
  const tIt = quoteSchemaTable(schema, "ventas_items");
  const tP = quoteSchemaTable(schema, "productos");

  const { rows } = await pool().query<EstadoServicioVehiculoRow>(
    `
    ${cteServiciosYUltimo(tP, tVen, tIt, "AND v.vehiculo_id = $2::uuid")}
    SELECT
      s.id::text                 AS producto_id,
      s.nombre                   AS servicio_nombre,
      s.servicio_intervalo_km    AS intervalo_km,
      s.servicio_intervalo_meses AS intervalo_meses,
      u.ultima_fecha,
      u.ultimo_km,
      ${SQL_PROXIMO_KM}     AS proximo_km,
      ${SQL_PROXIMA_FECHA}  AS proxima_fecha,
      ${SQL_KM_RESTANTES}   AS km_restantes,
      ${SQL_DIAS_RESTANTES} AS dias_restantes,
      ${SQL_VENCIDO}        AS vencido
      FROM ultimo u
      JOIN servicios s ON s.id = u.producto_id
      JOIN ${tVeh} veh ON veh.id = u.vehiculo_id AND veh.empresa_id = $1::uuid
     ORDER BY vencido DESC, dias_restantes NULLS LAST, km_restantes NULLS LAST
    `,
    [empresaId, vehiculoId]
  );
  return rows;
}
