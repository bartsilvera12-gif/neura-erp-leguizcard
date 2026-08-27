-- =============================================================================
-- Leguizcard - explosion de receta: cuanto insumo consume vender N servicios
-- =============================================================================
-- Vender "Cambio de aceite" tiene que bajar del stock los 4 L de aceite y el
-- filtro que ese servicio consume. Esta funcion dice exactamente cuanto.
--
-- Vive en la base y no en la aplicacion a proposito: aplica la MISMA aritmetica
-- que fn_receta_costeo() — conversion de unidades (4 L de un insumo cargado en
-- ml), merma como fraccion y rendimiento de la receta. Si esa aritmetica se
-- duplicara en TypeScript, el costo y el consumo terminarian diciendo cosas
-- distintas apenas una de las dos cambie.
--
-- Devuelve una fila por insumo con la cantidad EN LA UNIDAD DEL INSUMO, que es
-- la unidad en la que se lleva su stock.
-- =============================================================================

CREATE OR REPLACE FUNCTION leguizcard.fn_receta_explosion(
  p_receta_id uuid,
  p_veces numeric DEFAULT 1
)
RETURNS TABLE (
  insumo_producto_id uuid,
  insumo_nombre      text,
  cantidad_efectiva  numeric,
  unidad_insumo      text,
  unidad_incompatible boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = leguizcard, public
AS $$
  WITH base AS (
    SELECT
      ri.insumo_producto_id,
      pi.nombre AS insumo_nombre,
      ri.cantidad,
      COALESCE(ri.merma_pct, 0) AS merma_pct,
      pi.unidad_medida AS u_ins_raw,
      upper(trim(COALESCE(NULLIF(ri.unidad_medida, ''), pi.unidad_medida))) AS u_item,
      upper(trim(pi.unidad_medida)) AS u_ins,
      COALESCE(r.rendimiento_cantidad, 1) AS rendimiento
    FROM leguizcard.receta_items ri
    JOIN leguizcard.productos pi ON pi.id = ri.insumo_producto_id
    JOIN leguizcard.recetas r ON r.id = ri.receta_id
    WHERE ri.receta_id = p_receta_id
  ),
  fam AS (
    SELECT b.*,
      CASE u_item WHEN 'G' THEN 1 WHEN 'GR' THEN 1 WHEN 'GRS' THEN 1 WHEN 'KG' THEN 1000
                  WHEN 'ML' THEN 1 WHEN 'L' THEN 1000 WHEN 'LT' THEN 1000 WHEN 'LTS' THEN 1000
                  WHEN 'UNIDAD' THEN 1 WHEN 'UNID' THEN 1 WHEN 'U' THEN 1 ELSE NULL END AS f_item,
      CASE u_ins  WHEN 'G' THEN 1 WHEN 'GR' THEN 1 WHEN 'GRS' THEN 1 WHEN 'KG' THEN 1000
                  WHEN 'ML' THEN 1 WHEN 'L' THEN 1000 WHEN 'LT' THEN 1000 WHEN 'LTS' THEN 1000
                  WHEN 'UNIDAD' THEN 1 WHEN 'UNID' THEN 1 WHEN 'U' THEN 1 ELSE NULL END AS f_ins,
      CASE
        WHEN u_item IN ('G','GR','GRS','KG')    AND u_ins IN ('G','GR','GRS','KG')    THEN true
        WHEN u_item IN ('ML','L','LT','LTS')    AND u_ins IN ('ML','L','LT','LTS')    THEN true
        WHEN u_item IN ('UNIDAD','UNID','U')    AND u_ins IN ('UNIDAD','UNID','U')    THEN true
        ELSE false
      END AS compat
    FROM base b
  )
  SELECT
    insumo_producto_id,
    insumo_nombre,
    -- La receta rinde `rendimiento` servicios; para N servicios se consume la
    -- parte proporcional. merma_pct es una FRACCION (0.05 = 5%), no un
    -- porcentaje: asi lo define el CHECK de la tabla.
    SUM(
      CASE
        WHEN compat AND f_ins > 0 AND rendimiento > 0
        THEN (cantidad * f_item / f_ins) * (1 + merma_pct) * p_veces / rendimiento
        ELSE 0
      END
    ) AS cantidad_efectiva,
    MIN(u_ins_raw) AS unidad_insumo,
    -- Si la unidad no es convertible no se descuenta nada: es preferible un
    -- stock sin mover y visible que uno movido con un numero inventado.
    bool_or(NOT compat) AS unidad_incompatible
  FROM fam
  GROUP BY insumo_producto_id, insumo_nombre
  HAVING SUM(
    CASE
      WHEN compat AND f_ins > 0 AND rendimiento > 0
      THEN (cantidad * f_item / f_ins) * (1 + merma_pct) * p_veces / rendimiento
      ELSE 0
    END
  ) > 0;
$$;

COMMENT ON FUNCTION leguizcard.fn_receta_explosion(uuid, numeric) IS
  'Cuanto insumo consume vender N veces el servicio de esta receta, en la unidad del insumo.';

DO $$
BEGIN
  EXECUTE 'GRANT EXECUTE ON FUNCTION leguizcard.fn_receta_explosion(uuid, numeric) '
       || 'TO anon, authenticated, service_role';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'Sin privilegios para el GRANT; correr como supabase_admin.';
END $$;
