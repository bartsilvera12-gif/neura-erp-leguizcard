# Leguizcard — Instancia dedicada monocliente

Guía de despliegue y provisión de la instancia **Leguizcard**. Sin secretos.

- **Cliente:** Leguizcard
- **Modo:** `single_client` (un cliente = un repositorio = un schema = un deploy)
- **Repositorio:** `bartsilvera12-gif/neura-erp-leguizcard`
- **Schema Postgres:** `leguizcard`
- **Schema baseline clonado:** `instemaq` (solo estructura, sin datos)
- **empresa_id (UUID propio):** `093b75ed-62a7-496a-9d1f-7b12cd37ac24`

> El `empresa_id` de Instemaq (`20863e7f-39f3-4bb7-87bf-90fd7e08f396`) **no** se reutiliza
> en ningún punto de esta instancia.

## 1. Variables de entorno (Coolify) — completar los secretos en el panel

```env
NEXT_PUBLIC_SUPABASE_URL=https://api.neura.com.py
NEXT_PUBLIC_SUPABASE_ANON_KEY=        # secreto — panel Coolify
SUPABASE_SERVICE_ROLE_KEY=            # secreto — panel Coolify
SUPABASE_DB_URL=                      # secreto — panel Coolify (postgresql://...)
NEURA_CLIENT_SCHEMA=leguizcard
NEXT_PUBLIC_NEURA_CLIENT_SCHEMA=leguizcard
NEURA_INSTANCE_MODE=single_client
NEURA_CLIENT_NAME=Leguizcard
NODE_ENV=production
```

`NEXT_PUBLIC_NEURA_CLIENT_SCHEMA` es obligatoria: se inyecta en el bundle del navegador
durante el build. Debe estar presente en el entorno de **build** de Coolify, no solo en
runtime.

## 2. Provisión de base de datos (ya aplicada)

El schema `leguizcard` se creó clonando **la estructura** (sin datos) de `instemaq`:

```sql
SELECT public.neura_clone_schema_full('instemaq', 'leguizcard', false);
```

Resultado: 135 tablas, 406 policies, 33 funciones, 62 triggers, 523 índices,
285 foreign keys, RLS activo en las 135 tablas.

Luego, en orden (todos idempotentes):

| Script | Qué hace |
| --- | --- |
| `supabase/leguizcard/provision/0001_provision_leguizcard_master_data.sql` | Empresa Leguizcard con UUID nuevo + catálogos estructurales (módulos, dashboard views, etapas CRM, tipos de servicio, entidades bancarias). **No** copia datos operativos. |
| `supabase/leguizcard/provision/0002_retarget_access_functions.sql` | Retarget de `search_path` heredado a schemas ajenos + baja del plumbing multi-tenant + fix del RPC del inbox. |
| `supabase/leguizcard/provision/0003_grant_anon_like_source.sql` | Grants del rol `anon` (el clonador solo cubre `authenticated` y `service_role`). |

Aplicar un `.sql` con el helper del repo:

```bash
node scripts/apply-migration-file-pg.cjs supabase/leguizcard/provision/0001_provision_leguizcard_master_data.sql
```

### Correcciones de aislamiento aplicadas en 0002

El linaje del baseline (`ferrecolor` → `enlodemari` / `reservacaacupe` → `instemaq`) dejó
referencias a schemas de otros clientes. En `leguizcard` se corrigieron:

- `jwt_email_normalized()`, `empresa_id_actual()`, `es_super_admin()`,
  `puede_acceder_empresa(uuid)` — venían con `SET search_path TO 'instemaq'`.
  Son las funciones que usan las 406 policies RLS.
- `fn_receta_costeo(uuid)` — venía con `SET search_path TO 'reservacaacupe', 'public'`.
- Se eliminó el plumbing multi-tenant (`neura_clone_zentra_erp_to_tenant`,
  `neura_clone_omnicanal_schema`, `neura_provision_empresa_data_schema`,
  `neura_teardown_provision_failed`, `neura_fix_foreign_keys_retarget_from_public`,
  `neura_install_nota_credito_tables`): hardcodean `enlodemari` / `zentra_erp` y pueden
  escribir fuera del schema propio. Ningún trigger, default ni código de la app los usa.
- `neura_inbox_awaiting_reply_since_batch(...)` — su guard heredado solo aceptaba
  `zentra_erp|public|er_*|erp_*`, es decir **rechazaba el schema propio**; además
  `format()` recibía 1 argumento para 3 placeholders `%I`. Ambos bugs corregidos.

## 3. Exposición en PostgREST — **PENDIENTE**

El schema `leguizcard` todavía **no** está expuesto en PostgREST. La exposición la realiza
el responsable de la VPS, de forma **append-only** (sin tocar ni reemplazar la lista de
schemas existente):

```bash
cd /root/supabase/docker
./exponer-schema.sh leguizcard
```

Verificación contra la API (requiere el anon key real):

```bash
curl -s -o /dev/null -w "%{http_code}\n" \
  -H "apikey: $NEXT_PUBLIC_SUPABASE_ANON_KEY" \
  -H "Accept-Profile: leguizcard" \
  "https://api.neura.com.py/rest/v1/"
# esperado: 200
```

Hasta que este paso se complete, la app no puede leer/escribir vía PostgREST.

## 4. Usuario administrador — **PENDIENTE (requiere dato externo)**

No se copian usuarios de Instemaq. Para vincular un administrador hace falta un **email**
de Leguizcard: crear el usuario en Supabase Auth y luego insertar su fila de catálogo en
`leguizcard.usuarios` con el `auth_user_id` real. **No inventar `auth_user_id` ni
credenciales.**

```sql
-- Reemplazar <AUTH_USER_ID> por el UUID real de auth.users y <email> por el correo.
INSERT INTO leguizcard.usuarios (id, email, nombre, rol, empresa_id, auth_user_id, activo)
VALUES (
  gen_random_uuid(),
  '<email>',
  'Administrador',
  'super_admin',
  '093b75ed-62a7-496a-9d1f-7b12cd37ac24',
  '<AUTH_USER_ID>',
  true
);
```

Las funciones RLS (`empresa_id_actual()`, `es_super_admin()`) resuelven contra
`leguizcard.usuarios` por el email del JWT; hasta que exista al menos un usuario, el acceso
autenticado queda denegado por RLS — comportamiento esperado en una instancia recién creada.

## 5. Datos de empresa pendientes

`leguizcard.empresas` tiene la fila mínima válida (`nombre_empresa = 'Leguizcard'`,
`estado = 'activo'`, `data_schema = 'leguizcard'`). Quedan en `NULL` y se completan cuando
el cliente los provea: `ruc`, `telefono`, `email`, `direccion`, `plan`, razón social,
timbrado y datos fiscales (`empresa_sifen_config`), y el logo.

No se inventaron datos fiscales. Los documentos imprimibles (membrete, KuDE, presupuestos)
omiten los campos vacíos en lugar de fallar.

## 6. Módulos

`0001` habilita para Leguizcard el **catálogo completo** de módulos (baseline general del
ERP). La selección comercial de Instemaq (9 módulos de ferretería) **no** se replicó por ser
específica de ese cliente. Cuando Leguizcard defina su alcance, recortar desde
`admin/empresas/[id]` o con un `DELETE` + `INSERT` sobre `leguizcard.empresa_modulos`.

> `resolveEffectiveModules` hace fallback a "ERP completo" si no hay ninguna fila activa:
> siempre debe quedar al menos un módulo activo.

## 7. Branding pendiente

`public/brand/leguizcard-logo.png` es hoy un **placeholder** (logo neutro de la plataforma).
Reemplazarlo por el logo real de Leguizcard; lo consumen el header, el membrete de
documentos, el KuDE y los presupuestos.

## 8. Integraciones — sin configurar (a propósito)

La estructura de los módulos está presente, pero **no** se heredó ninguna configuración de
proveedor de Instemaq: WhatsApp / Meta / YCloud (`chat_channels`, `phone_number_id`, tokens),
webhooks, SIFEN (certificados, timbrado), n8n, email/SMTP y pagos quedan vacíos hasta que se
provean los datos de Leguizcard. Nunca se copian secretos entre instancias.

## 9. Storage

Los buckets de Supabase Storage son globales y compartidos (`productos-imagenes`,
`compras-facturas`, `chat-media`, `sifen`, `sifen-certificados`, `sorteo-*`), pero **todas**
las rutas de objeto están prefijadas por `empresa_id`. Con el UUID nuevo de Leguizcard el
aislamiento es automático: no se copió ningún archivo de Instemaq ni se reutiliza ninguna
ruta suya.
