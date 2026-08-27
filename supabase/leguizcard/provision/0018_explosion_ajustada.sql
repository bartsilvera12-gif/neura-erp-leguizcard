-- =============================================================================
-- Leguizcard - ajustar los insumos de un servicio en la venta
-- =============================================================================
-- QUE RESUELVE
--
-- La receta de un servicio dice lo que lleva NORMALMENTE. En el mostrador la
-- realidad se corre: a la IST le entraron 4 L y no 3,7; a esta camioneta no se
-- le cambio el filtro porque estaba nuevo. Hasta ahora eso no se podia decir, y
-- el stock quedaba descontando lo de la receta, no lo que salio del estante.
--
-- Se agrega un tercer parametro a fn_receta_explosion: una lista de ajustes
-- {insumo_producto_id, cantidad} que PISAN la cantidad de la receta para esa
-- venta. Cantidad 0 = ese insumo no se uso.
--
-- Se pisa SOLO la cantidad. La conversion de unidades y la merma siguen siendo
-- las de la receta: quien carga la venta dice "puse 4 litros", no tiene por que
-- saber que el aceite se compra por galon ni cuanto se pierde en el envase.
--
-- POR QUE SE REEMPLAZA LA FUNCION EN VEZ DE HACER UNA NUEVA
--
-- Una copia con el parametro extra serian dos cuerpos con la misma aritmetica
-- de conversion. Ya paso una vez (migracion 0016): la tabla de unidades vivia
-- duplicada y alcanzo con arreglar una para que el costo y el consumo dijeran
-- cosas distintas. Un solo cuerpo, un solo lugar donde equivocarse.
--
-- El DROP es seguro: la funcion es nuestra, se recrea aca mismo, y el unico que
-- la llama es create-venta-pg.ts.
-- =============================================================================

DROP FUNCTION IF EXISTS leguizcard.fn_receta_explosion(uuid, numeric);

CREATE OR REPLACE FUNCTION leguizcard.fn_receta_explosion(
  p_receta_id uuid,
  p_veces numeric DEFAULT 1,
  p_ajustes jsonb DEFAULT NULL
)
RETURNS TABLE (
  insumo_producto_id uuid,
  insumo_nombre      text,
  cantidad_efectiva  numeric,
  unidad_insumo      text,
  unidad_incompatible boolean
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = leguizcard, public
AS $$
  WITH base AS (
    SELECT
      ri.insumo_producto_id,
      pi.nombre AS insumo_nombre,
      -- El ajuste pisa la cantidad de la receta. Sin ajuste, la receta manda.
      COALESCE(aj.cantidad, ri.cantidad) AS cantidad,
      COALESCE(ri.merma_pct, 0) AS merma_pct,
      pi.unidad_medida AS u_ins_raw,
      COALESCE(NULLIF(ri.unidad_medida, ''), pi.unidad_medida) AS u_item,
      pi.unidad_medida AS u_ins,
      COALESCE(r.rendimiento_cantidad, 1) AS rendimiento
    FROM leguizcard.receta_items ri
    JOIN leguizcard.productos pi ON pi.id = ri.insumo_producto_id
    JOIN leguizcard.recetas r ON r.id = ri.receta_id
    LEFT JOIN LATERAL (
      SELECT GREATEST((o->>'cantidad')::numeric, 0) AS cantidad
      FROM jsonb_array_elements(COALESCE(p_ajustes, '[]'::jsonb)) o
      WHERE (o->>'insumo_producto_id')::uuid = ri.insumo_producto_id
        AND (o->>'cantidad') IS NOT NULL
      LIMIT 1
    ) aj ON true
    WHERE ri.receta_id = p_receta_id
  ),
  calc AS (
    SELECT b.*,
      leguizcard.fn_unidad_factor(u_item) AS f_item,
      leguizcard.fn_unidad_factor(u_ins)  AS f_ins,
      (leguizcard.fn_unidad_familia(u_item) IS NOT NULL
       AND leguizcard.fn_unidad_familia(u_item) = leguizcard.fn_unidad_familia(u_ins)) AS compat
    FROM base b
  )
  SELECT
    insumo_producto_id,
    insumo_nombre,
    -- merma_pct es una FRACCION (0.05 = 5%), asi lo define el CHECK de la tabla.
    SUM(
      CASE WHEN compat AND f_ins > 0 AND rendimiento > 0
           THEN (cantidad * f_item / f_ins) * (1 + merma_pct) * p_veces / rendimiento
           ELSE 0 END
    ) AS cantidad_efectiva,
    MIN(u_ins_raw) AS unidad_insumo,
    bool_or(NOT compat) AS unidad_incompatible
  FROM calc
  GROUP BY insumo_producto_id, insumo_nombre
  -- Un insumo ajustado a 0 no se uso: no descuenta ni aparece.
  HAVING SUM(
    CASE WHEN compat AND f_ins > 0 AND rendimiento > 0
         THEN (cantidad * f_item / f_ins) * (1 + merma_pct) * p_veces / rendimiento
         ELSE 0 END
  ) > 0;
$$;

COMMENT ON FUNCTION leguizcard.fn_receta_explosion(uuid, numeric, jsonb) IS
  'Cuanto se consume de cada insumo al hacer p_veces el servicio. p_ajustes '
  '[{insumo_producto_id, cantidad}] pisa la cantidad de la receta para esa venta.';

DO $$
BEGIN
  EXECUTE 'GRANT EXECUTE ON FUNCTION leguizcard.fn_receta_explosion(uuid, numeric, jsonb) '
       || 'TO anon, authenticated, service_role';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'Sin privilegios para el GRANT; correr como supabase_admin.';
END $$;
