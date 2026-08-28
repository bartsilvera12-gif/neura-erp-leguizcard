-- =============================================================================
-- Leguizcard - el presupuesto sabe para que auto es
-- =============================================================================
-- En un lubricentro un presupuesto casi nunca es "para el cliente": es para SU
-- AUTO. La misma persona puede pedir uno para la camioneta y otro para el auto
-- chico, con productos y precios distintos, y hoy los dos salian iguales salvo
-- por lo que alguien escribiera en las observaciones.
--
-- ON DELETE SET NULL, no RESTRICT: un presupuesto es una cotizacion, no un
-- registro contable. Si el auto se borra, el presupuesto sigue valiendo como
-- historial de lo que se cotizo y a que precio; solo pierde a quien apuntaba.
-- (Las VENTAS si usan RESTRICT: ahi borrar el auto dejaria huerfana una
-- operacion con plata de por medio.)
--
-- Aditiva, nullable e idempotente. Un presupuesto sin vehiculo sigue siendo
-- valido: se cotizan productos sueltos todo el tiempo.
-- =============================================================================

ALTER TABLE leguizcard.presupuestos
  ADD COLUMN IF NOT EXISTS vehiculo_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'leguizcard.presupuestos'::regclass
      AND conname = 'presupuestos_vehiculo_fk'
  ) THEN
    ALTER TABLE leguizcard.presupuestos
      ADD CONSTRAINT presupuestos_vehiculo_fk
      FOREIGN KEY (vehiculo_id) REFERENCES leguizcard.vehiculos(id) ON DELETE SET NULL;
  END IF;
END $$;

-- "Que le cotice a este auto" es la consulta que va a hacer el taller.
CREATE INDEX IF NOT EXISTS presupuestos_vehiculo_idx
  ON leguizcard.presupuestos (empresa_id, vehiculo_id)
  WHERE vehiculo_id IS NOT NULL;

COMMENT ON COLUMN leguizcard.presupuestos.vehiculo_id IS
  'Auto al que corresponde la cotizacion. NULL = productos sueltos, sin auto.';
