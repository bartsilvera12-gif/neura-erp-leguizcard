-- =============================================================================
-- Leguizcard - periodicidad y aviso de inactividad, por vehiculo
-- =============================================================================
-- DOS PEDIDOS QUE VIVEN EN EL MISMO LUGAR
--
-- 1. Periodicidad de mantenimiento por vehiculo.
--
--    Hoy el intervalo vive en el SERVICIO: "cambio de aceite, cada 5.000 km".
--    Eso esta bien como valor por defecto, pero no alcanza: la misma Hilux
--    haciendo taxi va cada 5.000 y la de uso particular aguanta 10.000. Y un
--    auto de plataforma no se maneja igual que el de un cliente comun.
--
--    Se agrega el intervalo AL VEHICULO, como excepcion. NULL = manda el del
--    servicio, que es el comportamiento de siempre. No se saca del servicio
--    porque un auto nuevo tiene que avisar desde el primer dia, sin que nadie
--    le cargue nada.
--
-- 2. Aviso de cliente que no vuelve.
--
--    Cuantos dias sin venir antes de avisar. Va en el vehiculo y no en el
--    cliente porque un mismo cliente puede tener un auto de uso diario y otro
--    guardado, y no se los espera con la misma frecuencia.
--
--    NULL = 90 dias (los "3 o 4 meses" que se hablaron). 0 = este auto no
--    avisa nunca. El default no es NULL-significa-nada porque entonces no
--    avisaria ningun auto hasta que alguien los configure uno por uno, y el
--    aviso que hay que encender a mano es el que no se enciende.
--
-- Aditiva, nullable e idempotente. No toca ninguna tabla existente.
-- =============================================================================

ALTER TABLE leguizcard.vehiculos
  ADD COLUMN IF NOT EXISTS intervalo_km numeric,
  ADD COLUMN IF NOT EXISTS intervalo_meses integer,
  ADD COLUMN IF NOT EXISTS avisar_inactivo_dias integer;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'leguizcard.vehiculos'::regclass
      AND conname = 'vehiculos_intervalo_km_check'
  ) THEN
    -- Un intervalo de 0 km no es un intervalo: seria avisar siempre.
    ALTER TABLE leguizcard.vehiculos
      ADD CONSTRAINT vehiculos_intervalo_km_check
      CHECK (intervalo_km IS NULL OR (intervalo_km > 0 AND intervalo_km <= 200000));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'leguizcard.vehiculos'::regclass
      AND conname = 'vehiculos_intervalo_meses_check'
  ) THEN
    ALTER TABLE leguizcard.vehiculos
      ADD CONSTRAINT vehiculos_intervalo_meses_check
      CHECK (intervalo_meses IS NULL OR (intervalo_meses > 0 AND intervalo_meses <= 120));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'leguizcard.vehiculos'::regclass
      AND conname = 'vehiculos_avisar_inactivo_check'
  ) THEN
    -- 0 se admite a proposito: es "no avisar por este auto".
    ALTER TABLE leguizcard.vehiculos
      ADD CONSTRAINT vehiculos_avisar_inactivo_check
      CHECK (avisar_inactivo_dias IS NULL OR (avisar_inactivo_dias >= 0 AND avisar_inactivo_dias <= 3650));
  END IF;
END $$;

COMMENT ON COLUMN leguizcard.vehiculos.intervalo_km IS
  'Cada cuantos km le toca a ESTE auto, pisando el intervalo del servicio. NULL = usa el del servicio.';
COMMENT ON COLUMN leguizcard.vehiculos.intervalo_meses IS
  'Cada cuantos meses le toca a ESTE auto, pisando el del servicio. NULL = usa el del servicio.';
COMMENT ON COLUMN leguizcard.vehiculos.avisar_inactivo_dias IS
  'Dias sin venir antes de avisar. NULL = 90. 0 = este auto no avisa.';
