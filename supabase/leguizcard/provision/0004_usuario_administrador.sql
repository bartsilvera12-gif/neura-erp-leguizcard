-- =============================================================================
-- Leguizcard - usuario administrador inicial
-- =============================================================================
-- Vincula un usuario YA EXISTENTE en Supabase Auth con la empresa Leguizcard.
-- El `auth_user_id` es real (provisto por el responsable de la instancia); no se
-- inventa ni se reutiliza ningun usuario de Instemaq.
--
--   auth.users.id : 8e41620a-1d17-4ee0-a30c-eaa5151892ae
--   email         : admin@leguizcard.com
--   empresa_id    : 093b75ed-62a7-496a-9d1f-7b12cd37ac24  (Leguizcard)
--
-- rol = 'administrador' (mismo criterio que el baseline):
--   - `esRolAdminEmpresa()` le da todos los modulos habilitados de la empresa.
--   - RLS lo mantiene acotado por `empresa_id_actual()`; NO usa el atajo de
--     `es_super_admin()`, que saltearia el filtro por empresa.
--
-- El email debe coincidir exactamente con el de auth.users: las funciones RLS
-- (`empresa_id_actual()`, `es_super_admin()`) resuelven la fila comparando
-- lower(trim(email)) contra el email del JWT.
--
-- Idempotente por auth_user_id.
-- =============================================================================

DO $$
DECLARE
  v_empresa_id   uuid := '093b75ed-62a7-496a-9d1f-7b12cd37ac24';
  v_auth_user_id uuid := '8e41620a-1d17-4ee0-a30c-eaa5151892ae';
  v_email        text;
BEGIN
  -- El usuario debe existir previamente en Supabase Auth.
  SELECT lower(btrim(u.email)) INTO v_email
  FROM auth.users u
  WHERE u.id = v_auth_user_id;

  IF v_email IS NULL THEN
    RAISE EXCEPTION 'auth.users % no existe: crear el usuario en Supabase Auth antes de correr este script', v_auth_user_id;
  END IF;

  INSERT INTO leguizcard.usuarios (id, email, nombre, rol, empresa_id, auth_user_id, activo, estado)
  VALUES (gen_random_uuid(), v_email, 'Administrador', 'administrador', v_empresa_id, v_auth_user_id, true, 'activo')
  ON CONFLICT DO NOTHING;

  -- Si la fila ya existia, garantizar que apunte a la empresa correcta.
  UPDATE leguizcard.usuarios
     SET empresa_id = v_empresa_id,
         email      = v_email,
         rol        = 'administrador',
         activo     = true,
         estado     = 'activo'
   WHERE auth_user_id = v_auth_user_id;

  RAISE NOTICE 'Administrador Leguizcard vinculado: % (auth_user_id=%)', v_email, v_auth_user_id;
END $$;
