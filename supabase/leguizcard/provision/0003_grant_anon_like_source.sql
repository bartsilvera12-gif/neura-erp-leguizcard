-- =============================================================================
-- Leguizcard - igualar permisos del rol `anon` al schema baseline
-- =============================================================================
-- El clonador (public.neura_clone_schema_full) otorga privilegios a
-- `authenticated` y `service_role`, pero NO a `anon`. En el baseline `instemaq`,
-- `anon` tiene ALL sobre todas las tablas y el acceso real lo filtra RLS
-- (identico en leguizcard). La app usa el rol `anon` en rutas publicas (browser
-- sin sesion), por lo que sin estos grants PostgREST responde 401 / 42501
-- "permission denied".
--
-- Seguridad: NO afecta el aislamiento - las 406 politicas RLS de leguizcard
-- siguen filtrando fila por fila. Idempotente.
--
-- IMPORTANTE: las tablas son propiedad de `supabase_admin`. El rol `postgres`
-- (no superusuario, sin GRANT OPTION) ejecuta estos GRANT sin error pero sin
-- efecto ("no privileges were granted"). Por eso se hace `SET LOCAL ROLE
-- supabase_admin` (postgres es miembro de ese rol en esta instalacion).
-- =============================================================================

DO $$
BEGIN
  IF pg_has_role(current_user, 'supabase_admin', 'member') THEN
    SET LOCAL ROLE supabase_admin;
  END IF;

  EXECUTE 'GRANT USAGE ON SCHEMA leguizcard TO anon';
  EXECUTE 'GRANT ALL ON ALL TABLES IN SCHEMA leguizcard TO anon';
  EXECUTE 'GRANT ALL ON ALL SEQUENCES IN SCHEMA leguizcard TO anon';
  EXECUTE 'GRANT EXECUTE ON ALL ROUTINES IN SCHEMA leguizcard TO anon';
END $$;
