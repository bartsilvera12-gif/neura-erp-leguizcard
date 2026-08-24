/**
 * Rentabilidad por metodo de pago.
 *
 * Responde: de lo que cobramos, cuanto entra realmente y cuanto queda de margen.
 *
 *   bruto    = lo facturado por ese medio
 *   comision = lo que retiene el POS / la billetera (entidades_bancarias.comision_porcentaje)
 *   neto     = bruto - comision  (lo que efectivamente entra)
 *   costo    = costo de la mercaderia/insumos vendidos, prorrateado por medio
 *   margen   = neto - costo
 *
 * El costo se prorratea: una venta cobrada 60% tarjeta y 40% efectivo imputa su
 * costo en esa misma proporcion. Sin prorrateo, una venta mixta cargaria todo el
 * costo al primer medio y el margen por medio quedaria sin sentido.
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

export interface RentabilidadMedioRow {
  metodo_pago: string;
  entidad_nombre: string | null;
  comision_porcentaje: string | number | null;
  operaciones: number;
  bruto: string | number;
  comision: string | number;
  neto: string | number;
  costo: string | number;
  margen: string | number;
}

export async function listRentabilidadPorMedio(
  schemaRaw: string,
  empresaId: string,
  desde: string,
  hasta: string
): Promise<RentabilidadMedioRow[]> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const tV = quoteSchemaTable(schema, "ventas");
  const tPd = quoteSchemaTable(schema, "ventas_pagos_detalle");
  const tI = quoteSchemaTable(schema, "ventas_items");
  const tP = quoteSchemaTable(schema, "productos");
  const tE = quoteSchemaTable(schema, "entidades_bancarias");

  const { rows } = await pool().query<RentabilidadMedioRow>(
    `
    WITH ventas_rango AS (
      SELECT v.id, v.total
        FROM ${tV} v
       WHERE v.empresa_id = $1::uuid
         AND v.estado <> 'anulada'
         AND v.fecha >= $2::date
         AND v.fecha < ($3::date + 1)
    ),
    costo_venta AS (
      -- Costo de cada venta: el costo unitario de la linea si vino declarado
      -- (item manual), si no el costo promedio del producto.
      SELECT i.venta_id,
             SUM(i.cantidad * COALESCE(i.costo_unitario, p.costo_promedio, 0)) AS costo
        FROM ${tI} i
        LEFT JOIN ${tP} p ON p.id = i.producto_id AND p.empresa_id = i.empresa_id
       WHERE i.empresa_id = $1::uuid
         AND i.venta_id IN (SELECT id FROM ventas_rango)
       GROUP BY i.venta_id
    ),
    pagos AS (
      -- Un renglon por linea de pago. Las ventas sin detalle de pago se toman
      -- como una sola linea por el total, con el metodo de la cabecera.
      SELECT pd.venta_id, pd.metodo_pago, pd.entidad_bancaria_id, pd.monto
        FROM ${tPd} pd
       WHERE pd.empresa_id = $1::uuid AND pd.venta_id IN (SELECT id FROM ventas_rango)
      UNION ALL
      SELECT v.id, COALESCE(vv.metodo_pago, 'efectivo'), NULL::uuid, vr.total
        FROM ventas_rango vr
        JOIN ventas_rango v ON v.id = vr.id
        JOIN ${tV} vv ON vv.id = vr.id
       WHERE NOT EXISTS (
         SELECT 1 FROM ${tPd} x WHERE x.venta_id = vr.id AND x.empresa_id = $1::uuid
       )
    ),
    total_por_venta AS (
      SELECT venta_id, NULLIF(SUM(monto), 0) AS total_pagado FROM pagos GROUP BY venta_id
    )
    SELECT
      pg.metodo_pago,
      e.nombre                                    AS entidad_nombre,
      e.comision_porcentaje,
      COUNT(*)::int                               AS operaciones,
      SUM(pg.monto)                               AS bruto,
      SUM(pg.monto * COALESCE(e.comision_porcentaje, 0) / 100.0)          AS comision,
      SUM(pg.monto * (1 - COALESCE(e.comision_porcentaje, 0) / 100.0))    AS neto,
      -- Costo prorrateado segun la participacion de esta linea en la venta.
      SUM(COALESCE(cv.costo, 0) * pg.monto / COALESCE(tv.total_pagado, pg.monto)) AS costo,
      SUM(
        pg.monto * (1 - COALESCE(e.comision_porcentaje, 0) / 100.0)
        - COALESCE(cv.costo, 0) * pg.monto / COALESCE(tv.total_pagado, pg.monto)
      )                                           AS margen
      FROM pagos pg
      LEFT JOIN ${tE} e ON e.id = pg.entidad_bancaria_id AND e.empresa_id = $1::uuid
      LEFT JOIN costo_venta cv ON cv.venta_id = pg.venta_id
      LEFT JOIN total_por_venta tv ON tv.venta_id = pg.venta_id
     GROUP BY pg.metodo_pago, e.nombre, e.comision_porcentaje
     ORDER BY SUM(pg.monto) DESC
    `,
    [empresaId, desde, hasta]
  );
  return rows;
}
