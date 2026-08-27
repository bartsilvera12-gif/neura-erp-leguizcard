-- =============================================================================
-- Leguizcard - modulo de servicios
-- =============================================================================
-- Un servicio del lubricentro ("Cambio de aceite") se define con tres cosas:
--   1. la mano de obra, que es costo puro del taller y no sale de ningun
--      producto;
--   2. los productos que consume, que ya viven en `recetas` + `receta_items`;
--   3. cada cuanto se repite, que ya vive en servicio_intervalo_km / _meses.
--
-- El costo del servicio es entonces mano de obra + lo que devuelve
-- fn_receta_costeo() para sus insumos. Esa funcion ya resuelve la conversion de
-- unidades (4 L de un insumo cargado en ml), la merma y el rendimiento; no se
-- reimplementa nada de eso.
--
-- El precio admite dos modos, por servicio:
--   - precio_margen_pct NULL  -> el precio lo escribe el usuario (precio_venta).
--   - precio_margen_pct = 40  -> el precio se calcula: costo * 1.40. Si sube el
--     aceite, el precio del servicio sube solo.
--
-- Aditiva, nullable e idempotente.
-- =============================================================================

ALTER TABLE leguizcard.productos
  ADD COLUMN IF NOT EXISTS servicio_mano_obra numeric,
  ADD COLUMN IF NOT EXISTS precio_margen_pct numeric;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'leguizcard.productos'::regclass
      AND conname = 'productos_servicio_mano_obra_check'
  ) THEN
    ALTER TABLE leguizcard.productos
      ADD CONSTRAINT productos_servicio_mano_obra_check
      CHECK (servicio_mano_obra IS NULL OR servicio_mano_obra >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'leguizcard.productos'::regclass
      AND conname = 'productos_precio_margen_pct_check'
  ) THEN
    -- Tope alto pero finito: 1000% es absurdo pero posible; un numero sin tope
    -- deja pasar el cero de mas al tipear.
    ALTER TABLE leguizcard.productos
      ADD CONSTRAINT productos_precio_margen_pct_check
      CHECK (precio_margen_pct IS NULL OR (precio_margen_pct >= 0 AND precio_margen_pct <= 1000));
  END IF;
END $$;

COMMENT ON COLUMN leguizcard.productos.servicio_mano_obra IS
  'Solo servicios: costo de mano de obra, que no sale de ningun producto. Se suma al costo de la receta.';
COMMENT ON COLUMN leguizcard.productos.precio_margen_pct IS
  'NULL = el precio de venta se escribe a mano. Con valor, el precio se calcula como costo * (1 + pct/100).';

-- Los servicios se listan siempre juntos y son pocos frente a los 492 productos.
CREATE INDEX IF NOT EXISTS idx_productos_servicios
  ON leguizcard.productos (empresa_id)
  WHERE tipo_producto = 'servicio';
