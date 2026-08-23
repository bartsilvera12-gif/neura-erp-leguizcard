# Neura ERP — Leguizcard

ERP dedicado monocliente para **Leguizcard**, construido sobre Next.js 16 (App Router),
React 19, Tailwind 4 y Supabase/PostgREST self-hosted.

Modelo de la instancia:

```
1 cliente = 1 repositorio = 1 schema = 1 deploy
```

| | |
| --- | --- |
| Cliente | Leguizcard |
| Modo | `single_client` |
| Schema Postgres | `leguizcard` |
| `empresa_id` | `093b75ed-62a7-496a-9d1f-7b12cd37ac24` |

Esta instancia es independiente: no comparte datos, schema, `empresa_id`, usuarios,
credenciales ni rutas de Storage con ninguna otra instancia de Neura ERP.

## Puesta en marcha local

```bash
npm ci
```

Copiá `.env.example` a `.env.local` y completá los valores (nunca commitear `.env.local`).

```bash
npm run dev
```

## Comandos

```bash
npm run build
```

```bash
npm run lint
```

Los scripts `db:*` y `verify:*` de `package.json` aplican migraciones y verificaciones
puntuales contra la base; requieren `SUPABASE_DB_URL` en `.env.local`.

## Documentación

- [`docs/LEGUIZCARD_DEPLOY.md`](docs/LEGUIZCARD_DEPLOY.md) — despliegue, provisión del
  schema, exposición en PostgREST y pendientes de la instancia.
- [`docs/API.md`](docs/API.md) — endpoints del ERP.
- [`DOCUMENTACION_TECNICA.md`](DOCUMENTACION_TECNICA.md) — arquitectura y módulos.
- `supabase/leguizcard/provision/` — scripts de provisión idempotentes de este schema.

## Aislamiento

En ejecución normal **Leguizcard solo lee y escribe en `leguizcard`**. No existe fallback a
otro cliente: el schema se resuelve por `NEURA_CLIENT_SCHEMA` /
`NEXT_PUBLIC_NEURA_CLIENT_SCHEMA`, y cualquier otro valor de schema se rechaza de forma
explícita en `src/lib/supabase/chat-data-schema.ts`.
