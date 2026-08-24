-- =============================================================================
-- Leguizcard - modulo Vehiculos
-- =============================================================================
-- Alta del modulo en el catalogo y habilitacion para la empresa. El Sidebar
-- muestra la entrada solo si el slug existe en `modulos` y esta activo en
-- `empresa_modulos`; sin esta fila las pantallas quedan accesibles por URL pero
-- invisibles en el menu.
--
-- El UUID se genero con gen_random_uuid() y es propio de esta instancia: no
-- proviene del catalogo de ningun otro cliente.
--
-- Idempotente.
-- =============================================================================

DO $$
DECLARE
  v_empresa_id uuid := '093b75ed-62a7-496a-9d1f-7b12cd37ac24';
  v_modulo_id  uuid := '1c78bc42-514e-4f5b-8e18-1c2fbb4d02ef';
BEGIN
  INSERT INTO leguizcard.modulos (id, nombre, slug, descripcion)
  VALUES (v_modulo_id, 'Vehiculos', 'vehiculos',
          'Vehiculos de los clientes e historial de servicios del lubricentro')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO leguizcard.empresa_modulos (empresa_id, modulo_id, activo)
  SELECT v_empresa_id, v_modulo_id, true
  WHERE NOT EXISTS (
    SELECT 1 FROM leguizcard.empresa_modulos
     WHERE empresa_id = v_empresa_id AND modulo_id = v_modulo_id
  );

  UPDATE leguizcard.empresa_modulos
     SET activo = true
   WHERE empresa_id = v_empresa_id AND modulo_id = v_modulo_id;

  RAISE NOTICE 'Modulo vehiculos habilitado. Modulos activos: %',
    (SELECT count(*) FROM leguizcard.empresa_modulos WHERE empresa_id = v_empresa_id AND activo);
END $$;
