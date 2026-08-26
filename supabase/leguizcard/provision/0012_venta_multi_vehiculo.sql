-- =============================================================================
-- Leguizcard - una venta puede atender varios vehiculos
-- =============================================================================
-- Hasta ahora la venta tenia UN vehiculo (ventas.vehiculo_id) y UNA lectura de
-- odometro (ventas.km_registrado). Eso no alcanza para un cliente con flota:
-- entran tres camionetas, cada una lleva su aceite y sus filtros, y todo se
-- factura junto. Con el modelo viejo habia que partirlo en tres ventas o perder
-- el detalle de que le toco a cada auto.
--
-- Se agregan dos piezas:
--
--   1. ventas_vehiculos: que autos cubre la venta y con cuantos km entro CADA
--      uno. El kilometraje no puede vivir en la venta porque es propio de cada
--      vehiculo.
--   2. ventas_items.vehiculo_id: a que auto pertenece cada linea. NULL = linea
--      que no es de ningun auto en particular (una venta de mostrador, o algo
--      general dentro de una venta con flota).
--
-- ventas.vehiculo_id y ventas.km_registrado DEJAN de ser la fuente de verdad.
-- No se borran para no romper lecturas viejas que puedan quedar dando vueltas,
-- pero el codigo ya no las escribe ni las lee: la verdad esta en
-- ventas_vehiculos. Los datos existentes se migran mas abajo.
--
-- Aditiva e idempotente.
-- =============================================================================

CREATE TABLE IF NOT EXISTS leguizcard.ventas_vehiculos (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id    uuid NOT NULL,
  venta_id      uuid NOT NULL,
  vehiculo_id   uuid NOT NULL,
  -- Odometro de ESTE auto al momento de esta venta.
  km_registrado numeric,
  -- Orden en que el cajero los cargo: se respeta al mostrar el detalle.
  orden         smallint NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'leguizcard.ventas_vehiculos'::regclass
      AND conname = 'ventas_vehiculos_venta_fkey'
  ) THEN
    -- Al anular/borrar la venta se van sus vehiculos: la fila no significa nada
    -- sin la venta que la contiene.
    ALTER TABLE leguizcard.ventas_vehiculos
      ADD CONSTRAINT ventas_vehiculos_venta_fkey
      FOREIGN KEY (venta_id) REFERENCES leguizcard.ventas(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'leguizcard.ventas_vehiculos'::regclass
      AND conname = 'ventas_vehiculos_vehiculo_fkey'
  ) THEN
    -- RESTRICT y no SET NULL a proposito. ventas.vehiculo_id era SET NULL, y por
    -- eso borrar un vehiculo con historial no daba error: dejaba las ventas
    -- huerfanas en silencio. Aca la base misma lo impide, y la regla deja de
    -- depender de que la aplicacion se acuerde de chequearlo.
    ALTER TABLE leguizcard.ventas_vehiculos
      ADD CONSTRAINT ventas_vehiculos_vehiculo_fkey
      FOREIGN KEY (vehiculo_id) REFERENCES leguizcard.vehiculos(id) ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'leguizcard.ventas_vehiculos'::regclass
      AND conname = 'ventas_vehiculos_km_check'
  ) THEN
    ALTER TABLE leguizcard.ventas_vehiculos
      ADD CONSTRAINT ventas_vehiculos_km_check
      CHECK (km_registrado IS NULL OR km_registrado >= 0);
  END IF;
END $$;

-- Un vehiculo no puede estar dos veces en la misma venta: seria ambiguo con que
-- kilometraje entro.
CREATE UNIQUE INDEX IF NOT EXISTS ux_ventas_vehiculos_venta_vehiculo
  ON leguizcard.ventas_vehiculos (venta_id, vehiculo_id);

CREATE INDEX IF NOT EXISTS idx_ventas_vehiculos_vehiculo
  ON leguizcard.ventas_vehiculos (empresa_id, vehiculo_id);

COMMENT ON TABLE leguizcard.ventas_vehiculos IS
  'Vehiculos atendidos en una venta, con el odometro de cada uno. Reemplaza a ventas.vehiculo_id / ventas.km_registrado.';

-- -----------------------------------------------------------------------------
-- A que vehiculo pertenece cada linea
-- -----------------------------------------------------------------------------
ALTER TABLE leguizcard.ventas_items
  ADD COLUMN IF NOT EXISTS vehiculo_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'leguizcard.ventas_items'::regclass
      AND conname = 'ventas_items_vehiculo_fkey'
  ) THEN
    ALTER TABLE leguizcard.ventas_items
      ADD CONSTRAINT ventas_items_vehiculo_fkey
      FOREIGN KEY (vehiculo_id) REFERENCES leguizcard.vehiculos(id) ON DELETE RESTRICT;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_ventas_items_vehiculo
  ON leguizcard.ventas_items (empresa_id, vehiculo_id)
  WHERE vehiculo_id IS NOT NULL;

COMMENT ON COLUMN leguizcard.ventas_items.vehiculo_id IS
  'Vehiculo al que corresponde la linea. NULL = no es de ningun auto en particular.';

-- -----------------------------------------------------------------------------
-- RLS: mismo patron que el resto del schema
-- -----------------------------------------------------------------------------
ALTER TABLE leguizcard.ventas_vehiculos ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='leguizcard'
                  AND tablename='ventas_vehiculos' AND policyname='ventas_vehiculos_select') THEN
    CREATE POLICY ventas_vehiculos_select ON leguizcard.ventas_vehiculos
      FOR SELECT USING (leguizcard.puede_acceder_empresa(empresa_id));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='leguizcard'
                  AND tablename='ventas_vehiculos' AND policyname='ventas_vehiculos_insert') THEN
    CREATE POLICY ventas_vehiculos_insert ON leguizcard.ventas_vehiculos
      FOR INSERT WITH CHECK (leguizcard.puede_acceder_empresa(empresa_id));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='leguizcard'
                  AND tablename='ventas_vehiculos' AND policyname='ventas_vehiculos_update') THEN
    CREATE POLICY ventas_vehiculos_update ON leguizcard.ventas_vehiculos
      FOR UPDATE USING (leguizcard.puede_acceder_empresa(empresa_id))
      WITH CHECK (leguizcard.puede_acceder_empresa(empresa_id));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='leguizcard'
                  AND tablename='ventas_vehiculos' AND policyname='ventas_vehiculos_delete') THEN
    CREATE POLICY ventas_vehiculos_delete ON leguizcard.ventas_vehiculos
      FOR DELETE USING (leguizcard.puede_acceder_empresa(empresa_id));
  END IF;
END $$;

-- Los grants se dan con el rol que los administra en este schema, igual que en
-- 0003: el owner de las tablas no es postgres.
DO $$
BEGIN
  EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER '
       || 'ON leguizcard.ventas_vehiculos TO anon, authenticated, service_role';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'Sin privilegios para el GRANT; correr como supabase_admin.';
END $$;

-- -----------------------------------------------------------------------------
-- Migracion de lo que ya existe
-- -----------------------------------------------------------------------------
-- Cada venta que tenia un vehiculo pasa a tener una fila en ventas_vehiculos
-- con su kilometraje. Idempotente por el indice unico.
INSERT INTO leguizcard.ventas_vehiculos (empresa_id, venta_id, vehiculo_id, km_registrado, orden)
SELECT v.empresa_id, v.id, v.vehiculo_id, v.km_registrado, 0
  FROM leguizcard.ventas v
 WHERE v.vehiculo_id IS NOT NULL
ON CONFLICT (venta_id, vehiculo_id) DO NOTHING;

-- Y sus lineas quedan atribuidas a ese vehiculo, que es lo que implicaban.
UPDATE leguizcard.ventas_items i
   SET vehiculo_id = v.vehiculo_id
  FROM leguizcard.ventas v
 WHERE i.venta_id = v.id
   AND i.empresa_id = v.empresa_id
   AND v.vehiculo_id IS NOT NULL
   AND i.vehiculo_id IS NULL;

COMMENT ON COLUMN leguizcard.ventas.vehiculo_id IS
  'OBSOLETO: la verdad esta en ventas_vehiculos. Se conserva por compatibilidad; el codigo ya no lo escribe.';
COMMENT ON COLUMN leguizcard.ventas.km_registrado IS
  'OBSOLETO: el odometro de cada auto vive en ventas_vehiculos.km_registrado.';
