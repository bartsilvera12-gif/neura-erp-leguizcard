import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import type { Servicio } from "./servicios-pg";

export type { Servicio, InsumoServicio } from "./servicios-pg";

/** Lo que la pantalla manda: la merma va en PORCENTAJE, la API la convierte. */
export interface ServicioForm {
  nombre: string;
  precio_venta: number;
  mano_obra: number;
  margen_pct: number | null;
  intervalo_km: number | null;
  intervalo_meses: number | null;
  insumos: {
    insumo_producto_id: string;
    cantidad: number;
    unidad_medida: string | null;
    merma_pct: number;
  }[];
}

type Resp<T> = { success?: boolean; data?: T; error?: string };

export async function getServicios(): Promise<Servicio[]> {
  try {
    const res = await fetchWithSupabaseSession("/api/servicios", { cache: "no-store" });
    const j = (await res.json().catch(() => ({}))) as Resp<{ servicios?: Servicio[] }>;
    if (!res.ok || !j.success) {
      console.error("[servicios] getServicios:", j.error ?? res.statusText);
      return [];
    }
    return j.data?.servicios ?? [];
  } catch (e) {
    console.error("[servicios] getServicios:", e);
    return [];
  }
}

async function enviar(
  url: string,
  method: "POST" | "PATCH",
  form: ServicioForm
): Promise<{ ok: true; servicio: Servicio } | { ok: false; error: string }> {
  try {
    const res = await fetchWithSupabaseSession(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    const j = (await res.json().catch(() => ({}))) as Resp<{ servicio?: Servicio }>;
    if (!res.ok || !j.success || !j.data?.servicio) {
      return { ok: false, error: j.error ?? "No se pudo guardar el servicio." };
    }
    return { ok: true, servicio: j.data.servicio };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error de red." };
  }
}

export const crearServicio = (form: ServicioForm) => enviar("/api/servicios", "POST", form);

export const guardarServicio = (id: string, form: ServicioForm) =>
  enviar(`/api/servicios/${encodeURIComponent(id)}`, "PATCH", form);

export async function darDeBajaServicio(id: string): Promise<boolean> {
  try {
    const res = await fetchWithSupabaseSession(`/api/servicios/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    const j = (await res.json().catch(() => ({}))) as Resp<unknown>;
    return res.ok && j.success === true;
  } catch {
    return false;
  }
}
