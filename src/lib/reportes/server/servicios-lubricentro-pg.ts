/**
 * Reportes especificos del lubricentro.
 *
 * 1) Ranking y rentabilidad por servicio.
 * 2) Historial por cliente (que vehiculos tiene, cuando vino, cuanto gasto).
 *
 * Costo de un servicio: se toma, en este orden,
 *   a) `ventas_items.costo_unitario` si la linea lo trae (historico: la carga
 *      manual de costo por linea ya no existe, pero la columna se conserva);
 *   b) el `costo_unitario` que devuelve `fn_receta_costeo()` para su receta;
 *   c) `productos.costo_promedio`.
 *
 * La receta es la fuente real para un servicio: un cambio de aceite no tiene
 * costo_promedio propio (no se compra), su costo son los insumos que consume.
 *
 * NO se reimplementa el costeo: `fn_receta_costeo()` ya resuelve la conversion
 * de unidades entre el item y el insumo (4 L de un insumo cargado en ml), la
 * merma (que es una FRACCION 0..1, no un porcentaje) y el rendimiento. Copiar
 * esa formula a mano es como se introducen diferencias de costo silenciosas.
 *
 * Ventas anuladas excluidas. Solo lectura.
 */
import { getChatPostgresPool, quoteSchemaTable } from "@/lib/supabase/chat-pg-pool";
import { assertAllowedChatDataSchema } from "@/lib/supabase/chat-data-schema";
import type { Pool } from "pg";

function pool(): Pool {
  const p = getChatPostgresPool();
  if (!p) throw new Error("Pool de Postgres no disponible.");
  return p;
}

export interface ServicioRentabilidadRow {
  producto_id: string;
  nombre: string;
  sku: string | null;
  veces: number;
  unidades: string | number;
  facturado: string | number;
  costo: string | number;
  margen: string | number;
  margen_pct: string | number | null;
  costo_receta_unitario: string | number | null;
  tiene_receta: boolean;
  intervalo_km: string | number | null;
  intervalo_meses: number | null;
  ultima_vez: string | null;
}

/**
 * Costo unitario por producto, delegado en `fn_receta_costeo()`.
 * CTE reutilizable por los reportes de este modulo.
 */
function cteCostoReceta(schema: string, tR: string): string {
  return `
    costo_receta AS (
      SELECT r.producto_id,
             ("${schema}".fn_receta_costeo(r.id) ->> 'costo_unitario')::numeric AS costo_unitario
        FROM ${tR} r
       WHERE r.empresa_id = $1::uuid AND COALESCE(r.activa, true) = true
    )`;
}

export async function listRentabilidadServicios(
  schemaRaw: string,
  empresaId: string,
  desde: string,
  hasta: string
): Promise<ServicioRentabilidadRow[]> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const tV = quoteSchemaTable(schema, "ventas");
  const tI = quoteSchemaTable(schema, "ventas_items");
  const tP = quoteSchemaTable(schema, "productos");
  const tR = quoteSchemaTable(schema, "recetas");

  const { rows } = await pool().query<ServicioRentabilidadRow>(
    `
    WITH ${cteCostoReceta(schema, tR)},
    lineas AS (
      SELECT i.producto_id, i.cantidad, i.total_linea, i.costo_unitario, v.fecha
        FROM ${tI} i
        JOIN ${tV} v ON v.id = i.venta_id AND v.empresa_id = i.empresa_id
       WHERE i.empresa_id = $1::uuid
         AND v.estado <> 'anulada'
         AND v.fecha >= $2::date
         AND v.fecha < ($3::date + 1)
         AND i.producto_id IS NOT NULL
    )
    SELECT
      p.id::text                        AS producto_id,
      p.nombre,
      p.sku,
      COUNT(*)::int                     AS veces,
      COALESCE(SUM(l.cantidad), 0)      AS unidades,
      COALESCE(SUM(l.total_linea), 0)   AS facturado,
      COALESCE(SUM(
        l.cantidad * COALESCE(l.costo_unitario, cr.costo_unitario, p.costo_promedio, 0)
      ), 0)                             AS costo,
      COALESCE(SUM(l.total_linea), 0) - COALESCE(SUM(
        l.cantidad * COALESCE(l.costo_unitario, cr.costo_unitario, p.costo_promedio, 0)
      ), 0)                             AS margen,
      CASE WHEN COALESCE(SUM(l.total_linea), 0) > 0
           THEN ((COALESCE(SUM(l.total_linea), 0) - COALESCE(SUM(
                  l.cantidad * COALESCE(l.costo_unitario, cr.costo_unitario, p.costo_promedio, 0)
                ), 0)) / SUM(l.total_linea)) * 100
      END                               AS margen_pct,
      cr.costo_unitario                 AS costo_receta_unitario,
      (cr.producto_id IS NOT NULL)      AS tiene_receta,
      p.servicio_intervalo_km           AS intervalo_km,
      p.servicio_intervalo_meses        AS intervalo_meses,
      MAX(l.fecha)::text                AS ultima_vez
      FROM lineas l
      JOIN ${tP} p ON p.id = l.producto_id AND p.empresa_id = $1::uuid
      LEFT JOIN costo_receta cr ON cr.producto_id = p.id
     WHERE p.servicio_intervalo_km IS NOT NULL OR p.servicio_intervalo_meses IS NOT NULL
     GROUP BY p.id, p.nombre, p.sku, cr.costo_unitario, cr.producto_id,
              p.servicio_intervalo_km, p.servicio_intervalo_meses, p.costo_promedio
     ORDER BY SUM(l.total_linea) DESC
     LIMIT 500
    `,
    [empresaId, desde, hasta]
  );
  return rows;
}

export interface ServicioCatalogoRow {
  producto_id: string;
  nombre: string;
  sku: string | null;
  precio_venta: string | number;
  costo_receta_unitario: string | number | null;
  tiene_receta: boolean;
  insumos: number;
  intervalo_km: string | number | null;
  intervalo_meses: number | null;
}

/**
 * Catalogo de servicios con su costo teorico segun receta, INDEPENDIENTE de que
 * se hayan vendido. Sirve para revisar precios antes de tener ventas.
 */
export async function listCatalogoServicios(
  schemaRaw: string,
  empresaId: string
): Promise<ServicioCatalogoRow[]> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const tP = quoteSchemaTable(schema, "productos");
  const tR = quoteSchemaTable(schema, "recetas");
  const tRI = quoteSchemaTable(schema, "receta_items");

  const { rows } = await pool().query<ServicioCatalogoRow>(
    `
    WITH ${cteCostoReceta(schema, tR)},
    insumos AS (
      SELECT r.producto_id, COUNT(ri.id)::int AS n
        FROM ${tR} r
        LEFT JOIN ${tRI} ri ON ri.receta_id = r.id AND ri.empresa_id = r.empresa_id
       WHERE r.empresa_id = $1::uuid AND COALESCE(r.activa, true) = true
       GROUP BY r.producto_id
    )
    SELECT p.id::text AS producto_id, p.nombre, p.sku, p.precio_venta,
           cr.costo_unitario AS costo_receta_unitario,
           (cr.producto_id IS NOT NULL) AS tiene_receta,
           COALESCE(i.n, 0) AS insumos,
           p.servicio_intervalo_km AS intervalo_km,
           p.servicio_intervalo_meses AS intervalo_meses
      FROM ${tP} p
      LEFT JOIN costo_receta cr ON cr.producto_id = p.id
      LEFT JOIN insumos i ON i.producto_id = p.id
     WHERE p.empresa_id = $1::uuid
       AND (p.servicio_intervalo_km IS NOT NULL OR p.servicio_intervalo_meses IS NOT NULL)
       AND COALESCE(p.activo, true) = true
     ORDER BY p.nombre
     LIMIT 500
    `,
    [empresaId]
  );
  return rows;
}

export interface HistorialClienteRow {
  cliente_id: string | null;
  cliente_nombre: string | null;
  cliente_telefono: string | null;
  vehiculos: number;
  patentes: string[] | null;
  visitas: number;
  facturado: string | number;
  ultima_visita: string | null;
  dias_sin_venir: number | null;
}

/** Historial por cliente: cuantos autos, cuantas visitas, cuanto gasto y hace cuanto no viene. */
export async function listHistorialClientes(
  schemaRaw: string,
  empresaId: string
): Promise<HistorialClienteRow[]> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const tV = quoteSchemaTable(schema, "ventas");
  const tC = quoteSchemaTable(schema, "clientes");
  const tVeh = quoteSchemaTable(schema, "vehiculos");

  const { rows } = await pool().query<HistorialClienteRow>(
    `
    WITH visitas AS (
      SELECT v.cliente_id, COUNT(*)::int AS visitas, SUM(v.total) AS facturado, MAX(v.fecha) AS ultima
        FROM ${tV} v
       WHERE v.empresa_id = $1::uuid AND v.estado <> 'anulada' AND v.cliente_id IS NOT NULL
       GROUP BY v.cliente_id
    ),
    autos AS (
      SELECT ve.cliente_id, COUNT(*)::int AS n, ARRAY_AGG(ve.patente ORDER BY ve.patente) AS patentes
        FROM ${tVeh} ve
       WHERE ve.empresa_id = $1::uuid AND COALESCE(ve.activo, true) = true AND ve.cliente_id IS NOT NULL
       GROUP BY ve.cliente_id
    )
    SELECT c.id::text AS cliente_id,
           COALESCE(
             CASE WHEN c.tipo_cliente = 'empresa' THEN NULLIF(btrim(c.empresa), '') END,
             NULLIF(btrim(c.nombre_contacto), ''),
             NULLIF(btrim(c.nombre), '')
           )                          AS cliente_nombre,
           c.telefono                 AS cliente_telefono,
           COALESCE(a.n, 0)           AS vehiculos,
           a.patentes,
           COALESCE(v.visitas, 0)     AS visitas,
           COALESCE(v.facturado, 0)   AS facturado,
           v.ultima::text             AS ultima_visita,
           CASE WHEN v.ultima IS NOT NULL
                THEN EXTRACT(DAY FROM now() - v.ultima)::int END AS dias_sin_venir
      FROM ${tC} c
      LEFT JOIN visitas v ON v.cliente_id = c.id
      LEFT JOIN autos a ON a.cliente_id = c.id
     WHERE c.empresa_id = $1::uuid
       AND (a.n IS NOT NULL OR v.visitas IS NOT NULL)
     ORDER BY v.ultima DESC NULLS LAST
     LIMIT 1000
    `,
    [empresaId]
  );
  return rows;
}
