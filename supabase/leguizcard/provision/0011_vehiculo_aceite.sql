-- =============================================================================
-- Leguizcard - que aceite lleva cada vehiculo
-- =============================================================================
-- Cuando el auto entra, lo primero que necesita saber el taller es que aceite
-- usa y cuantos litros lleva. Hoy eso vive en la cabeza del mecanico o en el
-- cuaderno: si lo atiende otro, o pasa un ano, se pierde.
--
-- Es una propiedad del VEHICULO, no del producto: la Hilux lleva 15W40 y 7
-- litros mas alla de que marca se le ponga esta vez. Por eso va aca y no en
-- `productos` (donde vive el intervalo de mantenimiento, que si es del producto).
--
-- Texto libre a proposito, no una FK al catalogo: la especificacion que pide el
-- fabricante ("15W40 semisintetico") sobrevive a que cambien de proveedor o de
-- marca en gondola. Amarrarlo a un producto lo romperia en la primera rotacion
-- de stock.
--
-- Aditiva, nullable e idempotente.
-- =============================================================================

ALTER TABLE leguizcard.vehiculos
  ADD COLUMN IF NOT EXISTS aceite_tipo text,
  ADD COLUMN IF NOT EXISTS aceite_litros numeric;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'leguizcard.vehiculos'::regclass
      AND conname = 'vehiculos_aceite_litros_check'
  ) THEN
    -- Un auto de calle no pasa de 20 L; el tope corta un cero de mas al tipear.
    ALTER TABLE leguizcard.vehiculos
      ADD CONSTRAINT vehiculos_aceite_litros_check
      CHECK (aceite_litros IS NULL OR (aceite_litros > 0 AND aceite_litros <= 100));
  END IF;
END $$;

COMMENT ON COLUMN leguizcard.vehiculos.aceite_tipo IS
  'Especificacion del aceite que pide el vehiculo (ej. "15W40 semisintetico"). Texto libre.';
COMMENT ON COLUMN leguizcard.vehiculos.aceite_litros IS
  'Cuantos litros lleva un cambio completo. NULL = no cargado.';

-- -----------------------------------------------------------------------------
-- Correccion del indice de 0009.
-- -----------------------------------------------------------------------------
-- Aquel indice parcial filtraba por tipo_producto = 'servicio' porque en ese
-- momento el intervalo solo valia para servicios. Ya no: el mantenimiento lo
-- marca cualquier producto con intervalo cargado (el aceite, el filtro). Con la
-- condicion vieja el indice no cubre la consulta actual y queda muerto.
DROP INDEX IF EXISTS leguizcard.idx_productos_servicio_intervalos;

CREATE INDEX IF NOT EXISTS idx_productos_con_intervalo
  ON leguizcard.productos (empresa_id)
  WHERE servicio_intervalo_km IS NOT NULL
     OR servicio_intervalo_meses IS NOT NULL;

COMMENT ON COLUMN leguizcard.productos.servicio_intervalo_km IS
  'Cada cuantos km se repite este producto (ej. un aceite de 5.000 km). NULL = no marca mantenimiento por km.';
COMMENT ON COLUMN leguizcard.productos.servicio_intervalo_meses IS
  'Cada cuantos meses se repite. NULL = no marca mantenimiento por tiempo.';
