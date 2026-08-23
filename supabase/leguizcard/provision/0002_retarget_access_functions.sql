-- =============================================================================
-- Leguizcard - aislamiento: retarget de search_path y limpieza de plumbing ajeno
-- =============================================================================
-- El schema `leguizcard` se clono desde `instemaq`, que a su vez arrastra en su
-- linaje (ferrecolor -> enlodemari / reservacaacupe) funciones con `search_path`
-- apuntando a schemas de OTROS clientes. El clonador reescribe los cuerpos a
-- `leguizcard.*` de forma calificada, por lo que esos search_path quedan inertes;
-- aun asi se retargetean para no dejar ninguna dependencia silenciosa.
--
-- Idempotente: ALTER FUNCTION ... SET search_path / DROP FUNCTION IF EXISTS /
-- CREATE OR REPLACE FUNCTION.
-- =============================================================================

-- 1) Funciones de control de acceso usadas por las 406 politicas RLS de leguizcard.
--    Venian con `SET search_path TO 'instemaq'`.
ALTER FUNCTION leguizcard.jwt_email_normalized()      SET search_path TO 'leguizcard';
ALTER FUNCTION leguizcard.empresa_id_actual()         SET search_path TO 'leguizcard';
ALTER FUNCTION leguizcard.es_super_admin()            SET search_path TO 'leguizcard';
ALTER FUNCTION leguizcard.puede_acceder_empresa(uuid) SET search_path TO 'leguizcard';

-- 2) Costeo de recetas: venia con `SET search_path TO 'reservacaacupe', 'public'`
--    (schema de otro cliente, heredado del linaje).
ALTER FUNCTION leguizcard.fn_receta_costeo(uuid)      SET search_path TO 'leguizcard', 'public';

-- 3) Plumbing multi-tenant heredado. Estas funciones provisionan / clonan /
--    destruyen schemas de OTROS tenants y hardcodean 'enlodemari' / 'zentra_erp'
--    en su cuerpo. En una instancia dedicada monocliente no tienen uso: ningun
--    trigger, default ni codigo de la app las invoca (solo aparecen en scripts de
--    diagnostico y en un string de ayuda de error). Se eliminan para no dejar
--    hardcodes de tenants ajenos ni herramientas capaces de escribir fuera de
--    `leguizcard`.
DROP FUNCTION IF EXISTS leguizcard.neura_clone_zentra_erp_to_tenant(text);
DROP FUNCTION IF EXISTS leguizcard.neura_clone_omnicanal_schema(text);
DROP FUNCTION IF EXISTS leguizcard.neura_provision_empresa_data_schema(uuid, text);
DROP FUNCTION IF EXISTS leguizcard.neura_teardown_provision_failed(uuid);
DROP FUNCTION IF EXISTS leguizcard.neura_fix_foreign_keys_retarget_from_public(text);
DROP FUNCTION IF EXISTS leguizcard.neura_install_nota_credito_tables(text);

-- 4) RPC del inbox omnicanal (la usa la app: src/lib/chat/actions.ts y
--    src/lib/chat/chat-inbox-fetch-pg.ts). Su guard heredado solo aceptaba
--    '^(zentra_erp|public|er_[0-9a-f]{32}|erp_[a-z0-9_]+)$', es decir RECHAZABA el
--    schema propio de la instancia y abortaba con 'schema no permitido'.
--    Se reemplaza por una comparacion exacta contra el schema de esta instancia.
--    Ademas se corrige un segundo bug heredado: el cuerpo tiene 3 placeholders
--    `%I` pero format() recibia un solo argumento (`sch`), por lo que la funcion
--    fallaba con 'too few arguments for format()'. Ahora se pasa `sch` 3 veces.
CREATE OR REPLACE FUNCTION leguizcard.neura_inbox_awaiting_reply_since_batch(p_schema text, p_empresa_id uuid, p_conversation_ids uuid[])
 RETURNS TABLE(conversation_id uuid, awaiting_since timestamp with time zone, client_turn_since timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  sch text := trim(both from coalesce(p_schema, ''));
BEGIN
  -- Instancia dedicada monocliente: unico schema direccionable.
  IF sch IS NULL OR sch <> 'leguizcard' THEN
    RAISE EXCEPTION 'schema no permitido: %', p_schema;
  END IF;

  RETURN QUERY EXECUTE format(
    $q$
    WITH conv AS (SELECT unnest($1::uuid[]) AS id),
    last_contact AS (
      SELECT DISTINCT ON (m.conversation_id)
        m.conversation_id,
        m.created_at AS at
      FROM %I.chat_messages m
      INNER JOIN conv c ON c.id = m.conversation_id
      WHERE m.empresa_id = $2::uuid
        AND m.from_me = false
        AND lower(coalesce(m.sender_type, 'contact')) IN ('contact')
      ORDER BY m.conversation_id, m.created_at DESC
    ),
    last_human AS (
      SELECT m.conversation_id, max(m.created_at) AS at
      FROM %I.chat_messages m
      INNER JOIN conv c ON c.id = m.conversation_id
      WHERE m.empresa_id = $2::uuid
        AND m.from_me = true
        AND lower(coalesce(m.sender_type, '')) = 'human'
      GROUP BY m.conversation_id
    ),
    last_global AS (
      SELECT DISTINCT ON (m.conversation_id)
        m.conversation_id,
        m.from_me,
        m.created_at AS at
      FROM %I.chat_messages m
      INNER JOIN conv c ON c.id = m.conversation_id
      WHERE m.empresa_id = $2::uuid
      ORDER BY m.conversation_id, m.created_at DESC
    )
    SELECT
      conv.id AS conversation_id,
      CASE
        WHEN lc.at IS NOT NULL AND lc.at > coalesce(lh.at, '-infinity'::timestamptz) THEN lc.at
        ELSE NULL::timestamptz
      END AS awaiting_since,
      CASE
        WHEN lc.at IS NOT NULL AND lc.at > coalesce(lh.at, '-infinity'::timestamptz) THEN NULL::timestamptz
        WHEN lg.from_me IS TRUE THEN lg.at
        ELSE NULL::timestamptz
      END AS client_turn_since
    FROM conv
    LEFT JOIN last_contact lc ON lc.conversation_id = conv.id
    LEFT JOIN last_human lh ON lh.conversation_id = conv.id
    LEFT JOIN last_global lg ON lg.conversation_id = conv.id
    $q$,
    sch, sch, sch
  )
  USING p_conversation_ids, p_empresa_id;
END;
$function$
;
