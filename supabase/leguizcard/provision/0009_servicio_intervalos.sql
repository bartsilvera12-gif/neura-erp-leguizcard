-- =============================================================================
-- Leguizcard - intervalos de mantenimiento por servicio
-- =============================================================================
-- Un servicio del lubricentro se repite cada cierto kilometraje y/o cada cierto
-- tiempo (p. ej. cambio de aceite: 5.000 km o 6 meses, lo que ocurra primero).
--
-- El intervalo vive en el producto-servicio, no en el vehiculo: es una propiedad
-- del servicio. Combinado con la ultima venta de ese servicio sobre el vehiculo
-- y con `vehiculos.km_actual`, permite calcular cuando toca el proximo.
--
-- Solo aplica a productos con tipo_producto = 'servicio'; en el resto quedan
-- NULL y se ignoran.
--
-- Aditiva, nullable e idempotente.
-- =============================================================================

ALTER TABLE leguizcard.productos
  ADD COLUMN IF NOT EXISTS servicio_intervalo_km numeric,
  ADD COLUMN IF NOT EXISTS servicio_intervalo_meses smallint;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'leguizcard.productos'::regclass
      AND conname = 'productos_servicio_intervalo_km_check'
  ) THEN
    ALTER TABLE leguizcard.productos
      ADD CONSTRAINT productos_servicio_intervalo_km_check
      CHECK (servicio_intervalo_km IS NULL OR servicio_intervalo_km > 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'leguizcard.productos'::regclass
      AND conname = 'productos_servicio_intervalo_meses_check'
  ) THEN
    ALTER TABLE leguizcard.productos
      ADD CONSTRAINT productos_servicio_intervalo_meses_check
      CHECK (servicio_intervalo_meses IS NULL OR (servicio_intervalo_meses > 0 AND servicio_intervalo_meses <= 120));
  END IF;
END $$;

COMMENT ON COLUMN leguizcard.productos.servicio_intervalo_km IS
  'Solo servicios: cada cuantos km se repite. NULL = no aplica control por km.';
COMMENT ON COLUMN leguizcard.productos.servicio_intervalo_meses IS
  'Solo servicios: cada cuantos meses se repite. NULL = no aplica control por tiempo.';

-- Servicios con algun intervalo configurado: los que alimentan los avisos.
CREATE INDEX IF NOT EXISTS idx_productos_servicio_intervalos
  ON leguizcard.productos (empresa_id)
  WHERE tipo_producto = 'servicio'
    AND (servicio_intervalo_km IS NOT NULL OR servicio_intervalo_meses IS NOT NULL);
