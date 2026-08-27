-- =============================================================================
-- Leguizcard - conversion de unidades en un solo lugar
-- =============================================================================
-- PROBLEMA QUE ARREGLA
--
-- fn_receta_costeo() traia su propia tabla de unidades, escrita a mano, y no
-- incluia dos que el catalogo de este cliente usa de verdad:
--
--   * LITRO  -- forma larga de L, que es lo que alguien escribe naturalmente
--   * GALON  -- 18 productos del catalogo estan en galones
--
-- Una unidad no reconocida no da error: la marca como "incompatible", la costea
-- en CERO y la deja fuera del consumo. O sea que un servicio que use un aceite
-- por galon habria mostrado un costo mas bajo del real y no habria descontado
-- nada del stock, sin una sola senal de que algo anda mal.
--
-- La tabla pasa a vivir en dos funciones que usan tanto el costeo como la
-- explosion. Duplicada en dos lugares, alcanzaba con arreglar uno para que el
-- costo y el consumo empezaran a decir cosas distintas.
--
-- El galon es el estadounidense (3.785,41 ml), que es el que se usa para
-- aceite en Paraguay.
-- =============================================================================

CREATE OR REPLACE FUNCTION leguizcard.fn_unidad_familia(u text)
RETURNS text
LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE upper(trim(COALESCE(u, '')))
    WHEN 'G' THEN 'peso' WHEN 'GR' THEN 'peso' WHEN 'GRS' THEN 'peso'
    WHEN 'GRAMO' THEN 'peso' WHEN 'GRAMOS' THEN 'peso'
    WHEN 'KG' THEN 'peso' WHEN 'KILO' THEN 'peso' WHEN 'KILOS' THEN 'peso'
    WHEN 'KILOGRAMO' THEN 'peso'
    WHEN 'ML' THEN 'volumen' WHEN 'CC' THEN 'volumen'
    WHEN 'L' THEN 'volumen' WHEN 'LT' THEN 'volumen' WHEN 'LTS' THEN 'volumen'
    WHEN 'LITRO' THEN 'volumen' WHEN 'LITROS' THEN 'volumen'
    WHEN 'GALON' THEN 'volumen' WHEN 'GALONES' THEN 'volumen' WHEN 'GL' THEN 'volumen'
    WHEN 'UNIDAD' THEN 'conteo' WHEN 'UNIDADES' THEN 'conteo'
    WHEN 'UNID' THEN 'conteo' WHEN 'U' THEN 'conteo' WHEN 'UN' THEN 'conteo'
    ELSE NULL
  END;
$$;

COMMENT ON FUNCTION leguizcard.fn_unidad_familia(text) IS
  'peso | volumen | conteo. NULL = unidad desconocida, no se puede convertir.';

CREATE OR REPLACE FUNCTION leguizcard.fn_unidad_factor(u text)
RETURNS numeric
LANGUAGE sql IMMUTABLE
AS $$
  -- Base: gramo para peso, mililitro para volumen, unidad para conteo.
  SELECT CASE upper(trim(COALESCE(u, '')))
    WHEN 'G' THEN 1 WHEN 'GR' THEN 1 WHEN 'GRS' THEN 1
    WHEN 'GRAMO' THEN 1 WHEN 'GRAMOS' THEN 1
    WHEN 'KG' THEN 1000 WHEN 'KILO' THEN 1000 WHEN 'KILOS' THEN 1000
    WHEN 'KILOGRAMO' THEN 1000
    WHEN 'ML' THEN 1 WHEN 'CC' THEN 1
    WHEN 'L' THEN 1000 WHEN 'LT' THEN 1000 WHEN 'LTS' THEN 1000
    WHEN 'LITRO' THEN 1000 WHEN 'LITROS' THEN 1000
    -- Galon estadounidense: el que se usa para aceite.
    WHEN 'GALON' THEN 3785.41 WHEN 'GALONES' THEN 3785.41 WHEN 'GL' THEN 3785.41
    WHEN 'UNIDAD' THEN 1 WHEN 'UNIDADES' THEN 1
    WHEN 'UNID' THEN 1 WHEN 'U' THEN 1 WHEN 'UN' THEN 1
    ELSE NULL
  END;
$$;

COMMENT ON FUNCTION leguizcard.fn_unidad_factor(text) IS
  'Cuanto vale la unidad en gramos, mililitros o unidades segun su familia. NULL = desconocida.';

-- -----------------------------------------------------------------------------
-- Las dos funciones que la usan
-- -----------------------------------------------------------------------------
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
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = leguizcard, public
AS $$
  WITH base AS (
    SELECT
      ri.insumo_producto_id,
      pi.nombre AS insumo_nombre,
      ri.cantidad,
      COALESCE(ri.merma_pct, 0) AS merma_pct,
      pi.unidad_medida AS u_ins_raw,
      COALESCE(NULLIF(ri.unidad_medida, ''), pi.unidad_medida) AS u_item,
      pi.unidad_medida AS u_ins,
      COALESCE(r.rendimiento_cantidad, 1) AS rendimiento
    FROM leguizcard.receta_items ri
    JOIN leguizcard.productos pi ON pi.id = ri.insumo_producto_id
    JOIN leguizcard.recetas r ON r.id = ri.receta_id
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
  HAVING SUM(
    CASE WHEN compat AND f_ins > 0 AND rendimiento > 0
         THEN (cantidad * f_item / f_ins) * (1 + merma_pct) * p_veces / rendimiento
         ELSE 0 END
  ) > 0;
$$;

CREATE OR REPLACE FUNCTION leguizcard.fn_receta_costeo(p_receta_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = leguizcard, public
AS $$
DECLARE
  v_costo_total       numeric := 0;
  v_precio_venta      numeric := 0;
  v_rendimiento       numeric := 1;
  v_unidades_posibles numeric;
  v_items             jsonb;
  v_producto_id       uuid;
BEGIN
  SELECT r.producto_id, COALESCE(r.rendimiento_cantidad, 1), COALESCE(p.precio_venta, 0)
    INTO v_producto_id, v_rendimiento, v_precio_venta
  FROM leguizcard.recetas r
  JOIN leguizcard.productos p ON p.id = r.producto_id
  WHERE r.id = p_receta_id;

  IF v_producto_id IS NULL THEN
    RETURN jsonb_build_object('error', 'receta_no_encontrada');
  END IF;

  WITH base AS (
    SELECT
      ri.id, ri.insumo_producto_id, pi.nombre AS insumo_nombre, ri.orden,
      ri.cantidad, ri.unidad_medida, COALESCE(ri.merma_pct, 0) AS merma_pct,
      pi.costo_promedio, pi.stock_actual,
      COALESCE(NULLIF(ri.unidad_medida, ''), pi.unidad_medida) AS u_item,
      pi.unidad_medida AS u_ins
    FROM leguizcard.receta_items ri
    JOIN leguizcard.productos pi ON pi.id = ri.insumo_producto_id
    WHERE ri.receta_id = p_receta_id
  ),
  fam AS (
    SELECT b.*,
      leguizcard.fn_unidad_factor(u_item) AS f_item,
      leguizcard.fn_unidad_factor(u_ins)  AS f_ins,
      (leguizcard.fn_unidad_familia(u_item) IS NOT NULL
       AND leguizcard.fn_unidad_familia(u_item) = leguizcard.fn_unidad_familia(u_ins)) AS compat
    FROM base b
  ),
  item_calc AS (
    SELECT *,
      (CASE WHEN compat AND f_ins > 0 THEN cantidad * f_item / f_ins ELSE NULL END) AS cant_insumo,
      (CASE WHEN compat AND f_ins > 0 THEN (cantidad * f_item / f_ins) * (1 + merma_pct) ELSE NULL END) AS cantidad_efectiva,
      (CASE WHEN compat AND f_ins > 0 THEN (cantidad * f_item / f_ins) * (1 + merma_pct) * COALESCE(costo_promedio, 0) ELSE 0 END) AS subcosto,
      (CASE WHEN compat AND f_ins > 0 AND (cantidad * f_item / f_ins) * (1 + merma_pct) > 0
            THEN FLOOR(COALESCE(stock_actual, 0) / ((cantidad * f_item / f_ins) * (1 + merma_pct)))
            ELSE NULL END) AS unidades_aporte,
      (NOT compat) AS unidad_incompatible
    FROM fam
  )
  SELECT
    COALESCE(SUM(subcosto), 0),
    COALESCE(MIN(unidades_aporte), 0),
    COALESCE(jsonb_agg(jsonb_build_object(
      'item_id', id,
      'insumo_producto_id', insumo_producto_id,
      'insumo_nombre', insumo_nombre,
      'cantidad', cantidad,
      'unidad_medida', unidad_medida,
      'merma_pct', merma_pct,
      'costo_promedio', costo_promedio,
      'stock_actual', stock_actual,
      'subcosto', subcosto,
      'unidades_aporte', unidades_aporte,
      'unidad_incompatible', unidad_incompatible
    ) ORDER BY orden, insumo_nombre), '[]'::jsonb)
    INTO v_costo_total, v_unidades_posibles, v_items
  FROM item_calc;

  IF NOT EXISTS (SELECT 1 FROM leguizcard.receta_items WHERE receta_id = p_receta_id) THEN
    v_unidades_posibles := NULL;
  END IF;

  RETURN jsonb_build_object(
    'receta_id', p_receta_id,
    'producto_id', v_producto_id,
    'rendimiento_cantidad', v_rendimiento,
    'costo_total', v_costo_total,
    'costo_unitario', CASE WHEN v_rendimiento > 0 THEN v_costo_total / v_rendimiento ELSE NULL END,
    'precio_venta', v_precio_venta,
    'margen_abs', v_precio_venta - (CASE WHEN v_rendimiento > 0 THEN v_costo_total / v_rendimiento ELSE 0 END),
    'margen_pct', CASE
      WHEN v_precio_venta > 0 AND v_rendimiento > 0
      THEN ROUND(((v_precio_venta - (v_costo_total / v_rendimiento)) / v_precio_venta * 100)::numeric, 2)
      ELSE NULL
    END,
    'unidades_posibles', v_unidades_posibles,
    'items', v_items
  );
END;
$$;

DO $$
BEGIN
  EXECUTE 'GRANT EXECUTE ON FUNCTION leguizcard.fn_unidad_familia(text), '
       || 'leguizcard.fn_unidad_factor(text), '
       || 'leguizcard.fn_receta_explosion(uuid, numeric), '
       || 'leguizcard.fn_receta_costeo(uuid) TO anon, authenticated, service_role';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'Sin privilegios para el GRANT; correr como supabase_admin.';
END $$;
