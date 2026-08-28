/**
 * Proximos servicios del lubricentro.
 *
 * Para cada par (vehiculo, servicio con intervalo configurado) busca la ULTIMA
 * vez que ese servicio se le hizo a ese vehiculo, y calcula cuando toca el
 * siguiente por kilometraje y/o por tiempo. Vence por lo que ocurra primero.
 *
 * Se apoya en:
 *   - productos.servicio_intervalo_km / servicio_intervalo_meses (el intervalo
 *     por defecto del servicio)
 *   - vehiculos.intervalo_km / intervalo_meses (la excepcion de ESE auto, que
 *     pisa la del servicio cuando esta cargada)
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
 *
 * EL INTERVALO SALE DEL AUTO SI LO TIENE. El servicio trae el valor por
 * defecto ("cambio de aceite: cada 5.000 km") y el vehiculo lo pisa cuando
 * corresponde: la misma camioneta haciendo taxi va cada 5.000 y la de uso
 * particular aguanta 10.000. Definido una vez y usado en las cinco reglas,
 * para que no exista una que se olvide de mirar el auto.
 */
const KM = `COALESCE(veh.intervalo_km, s.servicio_intervalo_km)`;
const MESES = `COALESCE(veh.intervalo_meses, s.servicio_intervalo_meses)`;

const SQL_PROXIMO_KM = `CASE WHEN ${KM} IS NOT NULL AND u.ultimo_km IS NOT NULL
           THEN u.ultimo_km + ${KM} END`;

const SQL_PROXIMA_FECHA = `CASE WHEN ${MESES} IS NOT NULL
           THEN u.ultima_fecha + (${MESES} || ' months')::interval END`;

const SQL_KM_RESTANTES = `CASE WHEN ${KM} IS NOT NULL AND u.ultimo_km IS NOT NULL AND veh.km_actual IS NOT NULL
           THEN (u.ultimo_km + ${KM}) - veh.km_actual END`;

const SQL_DIAS_RESTANTES = `CASE WHEN ${MESES} IS NOT NULL
           THEN EXTRACT(DAY FROM (u.ultima_fecha + (${MESES} || ' months')::interval) - now())::int END`;

/** Vencido por km, o por tiempo. Vence por lo que ocurra primero. */
const SQL_VENCIDO = `(
        (${KM} IS NOT NULL AND u.ultimo_km IS NOT NULL AND veh.km_actual IS NOT NULL
         AND veh.km_actual >= u.ultimo_km + ${KM})
        OR
        (${MESES} IS NOT NULL
         AND now() >= u.ultima_fecha + (${MESES} || ' months')::interval)
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
  tVV: string,
  filtroVehiculo: string
): string {
  return `
    WITH servicios AS (
      -- Todo producto con intervalo configurado, sea del tipo que sea. En un
      -- lubricentro que vende productos, el mantenimiento lo marca el ACEITE
      -- que se le puso al auto, no una linea de mano de obra aparte.
      SELECT p.id, p.nombre, p.servicio_intervalo_km, p.servicio_intervalo_meses
        FROM ${tP} p
       WHERE p.empresa_id = $1::uuid
         AND COALESCE(p.activo, true) = true
         AND (p.servicio_intervalo_km IS NOT NULL OR p.servicio_intervalo_meses IS NOT NULL)
    ),
    ultimo AS (
      -- Ultima vez que cada producto de mantenimiento se le puso a cada vehiculo.
      --
      -- Solo cuentan las ventas con kilometraje cargado, igual que el historial
      -- de la ficha. Ademas de ser la misma regla, evita un problema real: una
      -- venta posterior SIN km pisaba a la anterior CON km (el DISTINCT ON se
      -- queda con la mas reciente), ultimo_km salia NULL y el aviso por
      -- kilometraje se apagaba sin que nadie se enterara.
      SELECT DISTINCT ON (vv.vehiculo_id, i.producto_id)
             vv.vehiculo_id, i.producto_id, v.fecha AS ultima_fecha, vv.km_registrado AS ultimo_km
        FROM ${tVV} vv
        JOIN ${tVen} v ON v.id = vv.venta_id AND v.empresa_id = vv.empresa_id
        -- La linea tiene que ser de ESE auto: en una venta con flota, el aceite
        -- de una camioneta no marca el mantenimiento de la otra.
        JOIN ${tIt} i ON i.venta_id = v.id AND i.empresa_id = v.empresa_id
                     AND i.vehiculo_id = vv.vehiculo_id
       WHERE vv.empresa_id = $1::uuid
         AND vv.km_registrado IS NOT NULL
         AND v.estado <> 'anulada'
         AND i.producto_id IN (SELECT id FROM servicios)
         ${filtroVehiculo}
       ORDER BY vv.vehiculo_id, i.producto_id, v.fecha DESC
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
  const tVV = quoteSchemaTable(schema, "ventas_vehiculos");
  const tC = quoteSchemaTable(schema, "clientes");

  const dias = opts.diasAnticipacion ?? 30;

  const { rows } = await pool().query<ProximoServicioRow>(
    `
    ${cteServiciosYUltimo(tP, tVen, tIt, tVV, "")}
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
      -- El intervalo que se muestra es el que se APLICO, no el del catalogo.
      COALESCE(veh.intervalo_km, s.servicio_intervalo_km)       AS intervalo_km,
      COALESCE(veh.intervalo_meses, s.servicio_intervalo_meses) AS intervalo_meses,
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
             (${MESES} IS NOT NULL
              AND u.ultima_fecha + (${MESES} || ' months')::interval <= now() + ($2 || ' days')::interval)
             OR
             -- Anticipacion por km: 10% del intervalo.
             (${KM} IS NOT NULL AND u.ultimo_km IS NOT NULL AND veh.km_actual IS NOT NULL
              AND veh.km_actual >= u.ultimo_km + ${KM} * 0.9)
           )
         )
       )
     ORDER BY vencido DESC, dias_restantes NULLS LAST, km_restantes NULLS LAST
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
  const tVV = quoteSchemaTable(schema, "ventas_vehiculos");

  const { rows } = await pool().query<EstadoServicioVehiculoRow>(
    `
    ${cteServiciosYUltimo(tP, tVen, tIt, tVV, "AND vv.vehiculo_id = $2::uuid")}
    SELECT
      s.id::text                 AS producto_id,
      s.nombre                   AS servicio_nombre,
      COALESCE(veh.intervalo_km, s.servicio_intervalo_km)       AS intervalo_km,
      COALESCE(veh.intervalo_meses, s.servicio_intervalo_meses) AS intervalo_meses,
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
