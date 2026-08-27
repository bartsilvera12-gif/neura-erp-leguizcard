-- =============================================================================
-- Leguizcard - marcar una alerta de reposicion como leida
-- =============================================================================
-- La campanita hoy muestra 76 productos y no hay forma de decir "este ya lo se,
-- el pedido al proveedor ya salio". Con 76 filas siempre encendidas, la
-- campanita deja de mirarse, que es la unica forma en que una alerta falla.
--
-- LO IMPORTANTE: QUE VUELVA A AVISAR
--
-- No alcanza con guardar "producto X leido". Si el filtro de aceite se marca
-- leido hoy, entra mercaderia, se vende y vuelve a quedar en cero, tiene que
-- avisar de nuevo. Un "leido" para siempre es peor que no tener nada: apaga la
-- alerta justo cuando vuelve a importar.
--
-- Por eso se guarda la FOTO de la situacion al marcarla: cuanto stock habia y
-- cual era el minimo. La alerta se considera leida solo mientras esos dos
-- numeros sigan iguales. Se movio el stock (entro mercaderia, se vendio otra
-- unidad) o se cambio el minimo: vuelve a estar sin leer.
--
-- Es por USUARIO: que el dueno la haya visto desde el celular no significa que
-- el playero la haya visto en el mostrador.
--
-- Aditiva e idempotente. No toca ninguna tabla existente.
-- =============================================================================

CREATE TABLE IF NOT EXISTS leguizcard.alertas_stock_leidas (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id    uuid NOT NULL,
  -- auth.users.id de quien la marco. Sin FK a propósito: el usuario vive en el
  -- schema de auth y esta tabla no deberia depender de su ciclo de vida.
  usuario_id    uuid NOT NULL,
  producto_id   uuid NOT NULL,
  -- La foto de la situacion. Si alguno cambia, la alerta vuelve a aparecer.
  stock_visto   numeric NOT NULL,
  minimo_visto  numeric NOT NULL,
  leido_at      timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'leguizcard.alertas_stock_leidas'::regclass
      AND conname = 'alertas_stock_leidas_producto_fk'
  ) THEN
    -- Si el producto se borra, la marca no tiene sentido: se va con el.
    ALTER TABLE leguizcard.alertas_stock_leidas
      ADD CONSTRAINT alertas_stock_leidas_producto_fk
      FOREIGN KEY (producto_id) REFERENCES leguizcard.productos(id) ON DELETE CASCADE;
  END IF;
END $$;

-- Una marca por producto y usuario: marcar de nuevo pisa la foto anterior.
CREATE UNIQUE INDEX IF NOT EXISTS alertas_stock_leidas_unica
  ON leguizcard.alertas_stock_leidas (empresa_id, usuario_id, producto_id);

-- El acceso normal es "todo lo que este usuario marco": ese es el indice.
CREATE INDEX IF NOT EXISTS alertas_stock_leidas_por_usuario
  ON leguizcard.alertas_stock_leidas (empresa_id, usuario_id);

ALTER TABLE leguizcard.alertas_stock_leidas ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='leguizcard'
                 AND tablename='alertas_stock_leidas' AND policyname='alertas_stock_leidas_select') THEN
    CREATE POLICY alertas_stock_leidas_select ON leguizcard.alertas_stock_leidas
      FOR SELECT USING (leguizcard.puede_acceder_empresa(empresa_id));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='leguizcard'
                 AND tablename='alertas_stock_leidas' AND policyname='alertas_stock_leidas_insert') THEN
    CREATE POLICY alertas_stock_leidas_insert ON leguizcard.alertas_stock_leidas
      FOR INSERT WITH CHECK (leguizcard.puede_acceder_empresa(empresa_id));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='leguizcard'
                 AND tablename='alertas_stock_leidas' AND policyname='alertas_stock_leidas_update') THEN
    CREATE POLICY alertas_stock_leidas_update ON leguizcard.alertas_stock_leidas
      FOR UPDATE USING (leguizcard.puede_acceder_empresa(empresa_id))
      WITH CHECK (leguizcard.puede_acceder_empresa(empresa_id));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='leguizcard'
                 AND tablename='alertas_stock_leidas' AND policyname='alertas_stock_leidas_delete') THEN
    CREATE POLICY alertas_stock_leidas_delete ON leguizcard.alertas_stock_leidas
      FOR DELETE USING (leguizcard.puede_acceder_empresa(empresa_id));
  END IF;
END $$;

DO $$
BEGIN
  EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER '
       || 'ON leguizcard.alertas_stock_leidas TO anon, authenticated, service_role';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'Sin privilegios para el GRANT; correr como supabase_admin.';
END $$;

COMMENT ON TABLE leguizcard.alertas_stock_leidas IS
  'Alertas de reposicion que un usuario marco como vistas. Vuelven a aparecer '
  'si el stock o el minimo cambian respecto de stock_visto / minimo_visto.';
