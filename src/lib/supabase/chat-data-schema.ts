import { SUPABASE_APP_SCHEMA } from "@/lib/supabase/schema";

/**
 * Instancia dedicada monocliente (Leguizcard).
 *
 * El baseline multi-tenant aceptaba aquí `public`, el schema legacy y los schemas
 * `erp_*` / `er_<hex32>` de cualquier otro cliente, lo que permitía que un valor de
 * schema mal resuelto terminara interpolado en SQL contra datos ajenos.
 *
 * En esta instancia el único schema direccionable es el propio. Cualquier otro valor
 * falla de forma explícita — nunca se degrada silenciosamente a otro cliente.
 */
export function assertAllowedChatDataSchema(schema: string): string {
  const s = schema.trim();
  if (!s) throw new Error("schema vacío");
  if (s === SUPABASE_APP_SCHEMA) return s;
  throw new Error(
    `schema no permitido en instancia monocliente: ${s} (esperado: ${SUPABASE_APP_SCHEMA})`
  );
}

/**
 * En el baseline multi-tenant indicaba si el schema tenant probablemente no estaba en
 * "Exposed schemas" de PostgREST y había que caer al shim Postgres directo.
 *
 * Aquí el schema único de la instancia sí se expone en PostgREST, por lo que nunca se
 * activa el shim: siempre `false`.
 */
export function isLikelyUnexposedTenantChatSchema(schema: string): boolean {
  void schema;
  return false;
}
