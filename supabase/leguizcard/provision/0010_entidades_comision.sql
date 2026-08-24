-- =============================================================================
-- Leguizcard - comision del medio de cobro
-- =============================================================================
-- Cobrar 100.000 en efectivo y cobrar 100.000 con tarjeta NO dejan lo mismo: el
-- POS se queda un porcentaje. Sin este dato, "ganancias por metodo de pago" es
-- una suma bruta que no refleja lo que realmente entra.
--
-- La comision vive en la entidad bancaria (el POS / la billetera / el banco
-- concreto), no en el metodo de pago, porque dos POS distintos cobran distinto.
--
-- Aditiva, nullable e idempotente. NULL o 0 = sin comision (efectivo, banco).
-- =============================================================================

ALTER TABLE leguizcard.entidades_bancarias
  ADD COLUMN IF NOT EXISTS comision_porcentaje numeric;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'leguizcard.entidades_bancarias'::regclass
      AND conname = 'entidades_bancarias_comision_check'
  ) THEN
    ALTER TABLE leguizcard.entidades_bancarias
      ADD CONSTRAINT entidades_bancarias_comision_check
      CHECK (comision_porcentaje IS NULL OR (comision_porcentaje >= 0 AND comision_porcentaje <= 100));
  END IF;
END $$;

COMMENT ON COLUMN leguizcard.entidades_bancarias.comision_porcentaje IS
  'Porcentaje que retiene el medio de cobro (POS, billetera). NULL o 0 = sin comision.';
