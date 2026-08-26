/**
 * Storage helpers para la foto del vehiculo.
 *
 * Bucket: `vehiculos-imagenes` (privado).
 * Path:   `{empresa_id}/{vehiculo_id}/principal.{ext}`
 *
 * Aislamiento por tenant: el primer segmento del path es `empresa_id` y los
 * endpoints validan el `empresa_id` del usuario antes de leer o escribir. Que
 * el aislamiento se vea en la ruta hace que un error sea evidente al mirarla.
 *
 * Mismo patron que `inventario/imagen-storage.ts`, a proposito: son dos
 * archivos y no uno generico porque los buckets, los limites y los formatos
 * pueden divergir (una foto de auto no es una foto de producto), y unificarlos
 * ahora ataria las dos decisiones sin ganar nada.
 */
import type { AppSupabaseClient } from "@/lib/supabase/schema";

export const VEHICULOS_IMAGENES_BUCKET = "vehiculos-imagenes";

export const ALLOWED_IMAGE_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);
const ALLOWED_IMAGE_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

/** Las fotos salen del celular del taller; 8 MB cubre una foto sin recortar. */
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

let bucketEnsured = false;

/**
 * Crea el bucket privado si no existe. Idempotente, y cachea el resultado en
 * memoria del proceso para no llamar a getBucket en cada request.
 */
export async function ensureVehiculosImagenesBucket(supabase: AppSupabaseClient): Promise<void> {
  if (bucketEnsured) return;
  try {
    const { data: existing } = await supabase.storage.getBucket(VEHICULOS_IMAGENES_BUCKET);
    if (existing) {
      bucketEnsured = true;
      return;
    }
  } catch {
    // No existe o no se pudo consultar: se intenta crear abajo.
  }
  const { error } = await supabase.storage.createBucket(VEHICULOS_IMAGENES_BUCKET, {
    public: false,
    fileSizeLimit: MAX_IMAGE_BYTES,
    allowedMimeTypes: [...ALLOWED_IMAGE_MIME],
  });
  if (error && !/already exists|duplicate/i.test(error.message)) {
    throw new Error(`No se pudo crear el bucket: ${error.message}`);
  }
  bucketEnsured = true;
}

export function buildVehiculoImagenPath(
  empresaId: string,
  vehiculoId: string,
  mime: string
): string {
  const ext = ALLOWED_IMAGE_EXT[mime] ?? "bin";
  return `${empresaId}/${vehiculoId}/principal.${ext}`;
}

/** URL firmada para mostrar la foto. Devuelve null si no hay path o si falla. */
export async function signVehiculoImagen(
  supabase: AppSupabaseClient,
  imagenPath: string | null | undefined,
  ttlSeconds = 3600
): Promise<string | null> {
  if (!imagenPath) return null;
  try {
    const { data, error } = await supabase.storage
      .from(VEHICULOS_IMAGENES_BUCKET)
      .createSignedUrl(imagenPath, ttlSeconds);
    if (error || !data?.signedUrl) return null;
    return data.signedUrl;
  } catch {
    return null;
  }
}

/**
 * Firma varias en una sola llamada. El listado de vehiculos puede traer cientos:
 * firmar de a una seria un roundtrip por auto.
 */
export async function signVehiculoImagenes(
  supabase: AppSupabaseClient,
  paths: string[],
  ttlSeconds = 3600
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const unicos = [...new Set(paths.filter(Boolean))];
  if (!unicos.length) return out;
  try {
    const { data, error } = await supabase.storage
      .from(VEHICULOS_IMAGENES_BUCKET)
      .createSignedUrls(unicos, ttlSeconds);
    if (error || !data) return out;
    for (const d of data) {
      if (d.path && d.signedUrl) out.set(d.path, d.signedUrl);
    }
  } catch {
    // Sin firmas: la UI muestra el placeholder. No es motivo para romper la
    // pantalla entera.
  }
  return out;
}

/** El path tiene que empezar con la empresa: corta cualquier cruce entre clientes. */
export function pathBelongsToEmpresa(path: string | null | undefined, empresaId: string): boolean {
  if (!path) return false;
  return path.split("/")[0] === empresaId;
}
