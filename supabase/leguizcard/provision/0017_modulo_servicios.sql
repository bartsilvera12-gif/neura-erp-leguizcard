-- =============================================================================
-- Leguizcard - modulo Servicios
-- =============================================================================
-- El menu lateral y el guard de rutas filtran por modulo, asi que la pantalla
-- de servicios necesita el suyo para ser visible y accesible.
--
-- Se registra activo para esta empresa. Idempotente por el slug.
-- =============================================================================

INSERT INTO leguizcard.modulos (nombre, slug, descripcion)
SELECT 'Servicios', 'servicios',
       'Servicios del lubricentro: mano de obra, insumos que consume e intervalo de mantenimiento.'
 WHERE NOT EXISTS (SELECT 1 FROM leguizcard.modulos WHERE slug = 'servicios');

INSERT INTO leguizcard.empresa_modulos (empresa_id, modulo_id, activo)
SELECT e.id, m.id, true
  FROM leguizcard.empresas e
  CROSS JOIN leguizcard.modulos m
 WHERE m.slug = 'servicios'
   AND NOT EXISTS (
     SELECT 1 FROM leguizcard.empresa_modulos em
      WHERE em.empresa_id = e.id AND em.modulo_id = m.id
   );
