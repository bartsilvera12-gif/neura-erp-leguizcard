-- =============================================================================
-- Leguizcard - vehiculos del cliente (base del lubricentro)
-- =============================================================================
-- Un lubricentro hace seguimiento por AUTO, no por cliente: el historial de
-- servicios y el aviso de "proximo cambio" cuelgan del vehiculo. Un cliente
-- puede tener varios.
--
-- La patente es el identificador operativo: unica por empresa, normalizada a
-- mayusculas sin espacios ni guiones para que "ABC 123" y "abc-123" no entren
-- dos veces.
--
-- Los servicios NO se modelan aca: un servicio es un `productos` con
-- `tipo_producto = 'servicio'` (el CHECK ya lo permite) y su receta lista los
-- insumos que consume. Asi se venden con el flujo de ventas actual y el costeo
-- sale de `fn_receta_costeo()`.
--
-- Aditiva e idempotente. No toca ninguna tabla existente salvo para agregarle
-- columnas nullable a `ventas`.
-- =============================================================================

-- 1) Vehiculos -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS leguizcard.vehiculos (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id      uuid NOT NULL REFERENCES leguizcard.empresas(id) ON DELETE CASCADE,
  cliente_id      uuid REFERENCES leguizcard.clientes(id) ON DELETE SET NULL,
  patente         text NOT NULL,
  marca           text,
  modelo          text,
  anio            smallint,
  motor           text,
  combustible     text,
  vin             text,
  color           text,
  /** Ultima lectura de kilometraje conocida. La actualiza cada servicio. */
  km_actual       numeric,
  km_actualizado_at timestamptz,
  observaciones   text,
  activo          boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid,
  CONSTRAINT vehiculos_anio_check
    CHECK (anio IS NULL OR (anio >= 1900 AND anio <= 2200)),
  CONSTRAINT vehiculos_km_check
    CHECK (km_actual IS NULL OR km_actual >= 0),
  CONSTRAINT vehiculos_combustible_check
    CHECK (combustible IS NULL OR combustible = ANY (ARRAY['nafta','diesel','gnv','electrico','hibrido','otro'])),
  CONSTRAINT vehiculos_patente_no_vacia
    CHECK (btrim(patente) <> '')
);

-- Patente normalizada: unica por empresa. Ignora mayusculas, espacios y guiones.
CREATE UNIQUE INDEX IF NOT EXISTS ux_vehiculos_empresa_patente
  ON leguizcard.vehiculos (empresa_id, upper(regexp_replace(patente, '[^A-Za-z0-9]', '', 'g')));

CREATE INDEX IF NOT EXISTS idx_vehiculos_cliente
  ON leguizcard.vehiculos (empresa_id, cliente_id) WHERE cliente_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_vehiculos_activo
  ON leguizcard.vehiculos (empresa_id, activo);

DROP TRIGGER IF EXISTS tr_vehiculos_updated ON leguizcard.vehiculos;
CREATE TRIGGER tr_vehiculos_updated
  BEFORE UPDATE ON leguizcard.vehiculos
  FOR EACH ROW EXECUTE FUNCTION leguizcard.set_updated_at();

-- 2) Enganche con ventas -------------------------------------------------------
-- Una venta de servicio puede referir al vehiculo atendido y dejar registrada la
-- lectura de km del momento. Ambas nullable: las ventas de mostrador no las usan.
ALTER TABLE leguizcard.ventas
  ADD COLUMN IF NOT EXISTS vehiculo_id uuid,
  ADD COLUMN IF NOT EXISTS km_registrado numeric;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'leguizcard.ventas'::regclass AND conname = 'ventas_vehiculo_id_fkey'
  ) THEN
    ALTER TABLE leguizcard.ventas
      ADD CONSTRAINT ventas_vehiculo_id_fkey
      FOREIGN KEY (vehiculo_id) REFERENCES leguizcard.vehiculos(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'leguizcard.ventas'::regclass AND conname = 'ventas_km_registrado_check'
  ) THEN
    ALTER TABLE leguizcard.ventas
      ADD CONSTRAINT ventas_km_registrado_check
      CHECK (km_registrado IS NULL OR km_registrado >= 0);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_ventas_vehiculo
  ON leguizcard.ventas (empresa_id, vehiculo_id, fecha DESC) WHERE vehiculo_id IS NOT NULL;

-- 3) RLS -----------------------------------------------------------------------
-- Mismo patron que el resto del schema: filtro por empresa via
-- puede_acceder_empresa(). Sin excepciones ni atajos.
ALTER TABLE leguizcard.vehiculos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS vehiculos_select ON leguizcard.vehiculos;
CREATE POLICY vehiculos_select ON leguizcard.vehiculos
  FOR SELECT USING (leguizcard.puede_acceder_empresa(empresa_id));

DROP POLICY IF EXISTS vehiculos_insert ON leguizcard.vehiculos;
CREATE POLICY vehiculos_insert ON leguizcard.vehiculos
  FOR INSERT WITH CHECK (leguizcard.puede_acceder_empresa(empresa_id));

DROP POLICY IF EXISTS vehiculos_update ON leguizcard.vehiculos;
CREATE POLICY vehiculos_update ON leguizcard.vehiculos
  FOR UPDATE USING (leguizcard.puede_acceder_empresa(empresa_id))
  WITH CHECK (leguizcard.puede_acceder_empresa(empresa_id));

DROP POLICY IF EXISTS vehiculos_delete ON leguizcard.vehiculos;
CREATE POLICY vehiculos_delete ON leguizcard.vehiculos
  FOR DELETE USING (leguizcard.puede_acceder_empresa(empresa_id));

-- 4) Grants (mismos roles y privilegios que el resto de las tablas del schema) --
DO $$
BEGIN
  IF pg_has_role(current_user, 'supabase_admin', 'member') THEN
    SET LOCAL ROLE supabase_admin;
  END IF;
  EXECUTE 'GRANT ALL ON leguizcard.vehiculos TO anon, authenticated, service_role, postgres';
END $$;

COMMENT ON TABLE leguizcard.vehiculos IS
  'Vehiculos del cliente. Identificados por patente (unica por empresa, normalizada). Base del historial de servicios del lubricentro.';
