-- =============================================================================
-- Leguizcard - seleccion de modulos habilitados
-- =============================================================================
-- `0001` habilita el catalogo completo (31 modulos) como baseline. Aca se acota
-- al alcance acordado con Leguizcard: ERP operativo/comercial, sin omnicanal ni
-- CRM/Marketing/Proyectos.
--
-- Motivo: las integraciones externas (WhatsApp/Meta/YCloud, n8n) no se van a
-- usar por ahora, y sin canal ni token configurado esos modulos aparecen en el
-- menu pero no funcionan.
--
-- Se desactivan con `activo = false` en vez de borrar la fila: es reversible con
-- un UPDATE y no se pierde la asociacion empresa-modulo.
--
-- Idempotente.
--
-- NOTA: `resolveEffectiveModules` hace fallback a "ERP completo" si NO queda
-- ninguna fila activa; siempre debe quedar al menos un modulo activo.
-- =============================================================================

DO $$
DECLARE
  v_empresa_id uuid := '093b75ed-62a7-496a-9d1f-7b12cd37ac24';
  v_off text[] := ARRAY[
    -- Dependientes de integraciones externas (WhatsApp / Meta / YCloud / n8n)
    'campanas',                   -- Campanas WhatsApp
    'conversaciones',             -- Conversaciones
    'conversaciones-finalizadas', -- Conversaciones finalizadas
    'historial-omnicanal',        -- Historial omnicanal
    'omnicanal',                  -- Omnicanal (paquete)
    'monitoreo',                  -- Monitoreo (de colas omnicanal)
    'sorteos',                    -- Sorteos (flujos WhatsApp + n8n)
    -- Fuera del alcance inicial
    'crm',                        -- CRM Funnel
    'marketing',                  -- Marketing Ops
    'marketing_ops',              -- Marketing Ops (slug alternativo del catalogo)
    'proyectos'                   -- Proyectos
  ];
  v_activos int;
BEGIN
  UPDATE leguizcard.empresa_modulos em
     SET activo = false
    FROM leguizcard.modulos m
   WHERE em.modulo_id = m.id
     AND em.empresa_id = v_empresa_id
     AND m.slug = ANY (v_off);

  -- El resto queda explicitamente activo (idempotencia ante reejecuciones).
  UPDATE leguizcard.empresa_modulos em
     SET activo = true
    FROM leguizcard.modulos m
   WHERE em.modulo_id = m.id
     AND em.empresa_id = v_empresa_id
     AND NOT (m.slug = ANY (v_off));

  SELECT count(*) INTO v_activos
  FROM leguizcard.empresa_modulos
  WHERE empresa_id = v_empresa_id AND activo;

  IF v_activos = 0 THEN
    RAISE EXCEPTION 'quedaron 0 modulos activos: resolveEffectiveModules haria fallback a ERP completo';
  END IF;

  RAISE NOTICE 'empresa_modulos Leguizcard: % activos, % desactivados',
    v_activos,
    (SELECT count(*) FROM leguizcard.empresa_modulos WHERE empresa_id = v_empresa_id AND NOT activo);
END $$;
