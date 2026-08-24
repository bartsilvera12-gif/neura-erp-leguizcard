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
| `supabase/leguizcard/provision/0004_usuario_administrador.sql` | Vincula el usuario de Supabase Auth con la empresa Leguizcard. |
| `supabase/leguizcard/provision/0005_empresa_modulos_seleccion.sql` | Acota los módulos habilitados al alcance acordado. |
| `supabase/leguizcard/provision/0006_productos_marca.sql` | Agrega `productos.marca` (la usa el reporte de stock mínimo). |

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

## 3. Exposición en PostgREST — aplicada

`leguizcard` está expuesto en PostgREST, agregado de forma **append-only** a
`authenticator.pgrst.db_schemas` (verificado: los ~110 schemas previos siguen en la lista).

Verificación contra la API:

```bash
curl -s -o /dev/null -w "%{http_code}
"   -H "apikey: $NEXT_PUBLIC_SUPABASE_ANON_KEY"   -H "Accept-Profile: leguizcard"   "https://api.neura.com.py/rest/v1/"
# 200
```

Con el rol `anon` las tablas devuelven `[]`: RLS filtrando correctamente.

## 4. Usuario administrador — aplicado

No se copió ningún usuario de Instemaq. El administrador se vinculó a un usuario que ya
existía en Supabase Auth (`0004_usuario_administrador.sql`):

| | |
| --- | --- |
| `auth_user_id` | `8e41620a-1d17-4ee0-a30c-eaa5151892ae` |
| email | `admin@leguizcard.com` |
| `leguizcard.usuarios.id` | `5f4d6214-eca1-464c-b98e-22f5ab05ca69` |
| rol | `administrador` |

`rol = 'administrador'` y no `super_admin`: `es_super_admin()` hace que
`puede_acceder_empresa()` devuelva `true` para **cualquier** empresa, salteando el filtro.
Con `administrador` el acceso queda anclado a `empresa_id_actual()`, y no pierde nada —
`esRolAdminEmpresa()` le da todos los módulos habilitados y la app no borra usuarios
(los desactiva), que es la única policy que exige `super_admin`.

Verificado simulando su JWT bajo el rol `authenticated`: `empresa_id_actual()` resuelve a
Leguizcard, `es_super_admin()` es `false`, `puede_acceder_empresa(<Instemaq>)` es `false`,
y un INSERT con el `empresa_id` de Instemaq es rechazado por RLS.

## 5. Datos de empresa pendientes

`leguizcard.empresas` tiene la fila mínima válida (`nombre_empresa = 'Leguizcard'`,
`estado = 'activo'`, `data_schema = 'leguizcard'`). Quedan en `NULL` y se completan cuando
el cliente los provea: `ruc`, `telefono`, `email`, `direccion`, `plan`, razón social,
timbrado y datos fiscales (`empresa_sifen_config`), y el logo.

No se inventaron datos fiscales. Los documentos imprimibles (membrete, KuDE, presupuestos)
omiten los campos vacíos en lugar de fallar.

## 6. Módulo Caja (portado desde ferreteria-republica-erp)

El módulo de turnos de caja se portó desde `bartsilvera12-gif/ferreteria-republica-erp`
(rama `main` — ojo: el `origin/HEAD` de ese repo apunta a `perf/optimization-batch-1`,
que **no** tiene el módulo).

- **Estructura de base: cero migraciones.** `cajas`, `caja_movimientos` y `pedidos_caja`
  ya venían con el clon de `instemaq` y se verificaron idénticas al origen en columnas,
  índices y CHECK constraints. `ventas.caja_id` también existe.
  Única diferencia: el origen tiene `caja_movimientos.credito_cliente_id` (feature de
  devoluciones/saldo a favor) que el módulo de caja no usa, y Leguizcard tiene
  `anulado_por`, que el origen no tiene.
- **UI:** el panel del turno (`CajaControlPanel`) y los pedidos pendientes viven dentro
  de `/ventas`, colapsados por defecto. Los arqueos están en `/reportes/cajas`
  (módulo `reportes`, entrada "Reportes → Arqueos de caja" en el menú).
- **No se copiaron** las 4 migraciones SQL del repo origen: hardcodean el schema
  `ferreteriarepublica` (29 referencias) y son redundantes porque la estructura ya existía.
- Se actualizaron `lib/excel/export.ts` y `components/ui/EdgeScrollArea.tsx` a las
  versiones del origen: son supersets aditivos (`sheetFromRows`,
  `buildXlsxBufferSheets`, prop `drag`), la parte preexistente quedó byte a byte igual.

QA end-to-end contra `leguizcard` vía PostgREST + service role: apertura con arqueo por
denominaciones, rechazo del segundo turno activo sobre el mismo `numero_caja` (409 por el
índice unique parcial), movimientos de ingreso/egreso, paso a `en_cierre`, cierre con
arqueo y diferencia, y reapertura del número tras el cierre. Todo limpiado por id.

## 6.b Reportes, Cobranzas y Recetas (portados)

Del mismo repo origen se portaron tres módulos más, todos sin migraciones salvo
`productos.marca`:

- **Reportes** — hub en `/reportes` con 17 reportes: estado de cuenta, ventas,
  ventas-detalle, productos vendidos, compras, panel de compras, proveedores,
  conciliación, créditos por cliente, facturas, variación de precios, arqueos de caja,
  **stock mínimo**, **proyección de inventario** y **rotación ABC**. Con export a Excel
  y PDF donde el origen los tenía.
- **Cobranzas** — `/cobros`, cuentas por cobrar y registro de cobros contra entidades
  bancarias. Antes `cobros` era un módulo habilitado sin API ni página.
- **Recetas** — `/dashboard/recetas`: composición y costeo de un producto a partir de sus
  insumos, con conversión de unidades y merma. Es la base natural para modelar los
  servicios del lubricentro (mano de obra + insumos consumidos).

Referencias al cliente origen que se limpiaron al portar:
`extracto-pdf.ts` cargaba `ferreteriarepublica-doc-logo.png`; las páginas de recetas
ataban un feature flag a `NEURA_CLIENT_SCHEMA === "reservacaacupe"`; y tres cabeceras
nombraban el schema ajeno. Las migraciones SQL del origen no se copiaron (hardcodean
`enlodemari` / `reservacaacupe`).

Validación: se ejecutó contra `leguizcard` el SQL de los reportes nuevos (stock mínimo,
rotación ABC, proyección, estado de cuenta, cobros, ventas-detalle, compras, recetas y
`fn_receta_costeo()`); todas corren.

## 7. Módulos

`0001` habilita el catálogo completo (31) como baseline; `0005` lo acota al alcance
acordado: **20 activos**. Se desactivan (`activo = false`, reversible con un UPDATE) los 7
que dependen de integraciones externas no contratadas — `campanas`, `conversaciones`,
`conversaciones-finalizadas`, `historial-omnicanal`, `omnicanal`, `monitoreo`, `sorteos` —
más `crm`, `marketing`, `marketing_ops` y `proyectos`.

> `resolveEffectiveModules` hace fallback a "ERP completo" si no hay ninguna fila activa:
> siempre debe quedar al menos un módulo activo. `0005` aborta si el resultado sería 0.

**Módulos sin UI.** Ya no quedan fantasmas: `cobros`, `recetas` y `reportes` tienen
página y entrada de menú. `comisiones` y `pagos` también se agregaron al sidebar.
El único que sigue habilitado sin entrada propia es `planes` (`/planes` existe y es
accesible por URL).

## 8. Branding pendiente

`public/brand/leguizcard-logo.png` es hoy un **placeholder** (logo neutro de la plataforma).
Reemplazarlo por el logo real de Leguizcard; lo consumen el header, el membrete de
documentos, el KuDE y los presupuestos.

## 9. Integraciones — sin configurar (a propósito)

La estructura de los módulos está presente, pero **no** se heredó ninguna configuración de
proveedor de Instemaq: WhatsApp / Meta / YCloud (`chat_channels`, `phone_number_id`, tokens),
webhooks, SIFEN (certificados, timbrado), n8n, email/SMTP y pagos quedan vacíos hasta que se
provean los datos de Leguizcard. Nunca se copian secretos entre instancias.

## 10. Storage

Los buckets de Supabase Storage son globales y compartidos (`productos-imagenes`,
`compras-facturas`, `chat-media`, `sifen`, `sifen-certificados`, `sorteo-*`), pero **todas**
las rutas de objeto están prefijadas por `empresa_id`. Con el UUID nuevo de Leguizcard el
aislamiento es automático: no se copió ningún archivo de Instemaq ni se reutiliza ninguna
ruta suya.
