import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import type { NuevoVehiculoInput, ProximoServicio, ServicioVehiculo, Vehiculo } from "./types";

type Resp<T> = { success?: boolean; data?: T; error?: string };

async function leer<T>(res: Response, tag: string): Promise<Resp<T>> {
  const json = (await res.json().catch(() => ({}))) as Resp<T>;
  if (!res.ok || !json.success) {
    console.error(`[vehiculos] ${tag}:`, json.error ?? res.statusText);
  }
  return json;
}

export async function getVehiculos(opts: { clienteId?: string; soloActivos?: boolean } = {}): Promise<Vehiculo[]> {
  try {
    const p = new URLSearchParams();
    if (opts.clienteId) p.set("cliente_id", opts.clienteId);
    if (opts.soloActivos) p.set("activos", "1");
    const qs = p.toString();
    const res = await fetchWithSupabaseSession(`/api/vehiculos${qs ? `?${qs}` : ""}`, { cache: "no-store" });
    const json = await leer<{ vehiculos?: Vehiculo[] }>(res, "getVehiculos");
    return json.data?.vehiculos ?? [];
  } catch (e) {
    console.error("[vehiculos] getVehiculos:", e);
    return [];
  }
}

export async function getVehiculo(
  id: string
): Promise<{ vehiculo: Vehiculo; servicios: ServicioVehiculo[] } | null> {
  try {
    const res = await fetchWithSupabaseSession(`/api/vehiculos/${encodeURIComponent(id)}`, {
      cache: "no-store",
    });
    const json = await leer<{ vehiculo?: Vehiculo; servicios?: ServicioVehiculo[] }>(res, "getVehiculo");
    if (!json.data?.vehiculo) return null;
    return { vehiculo: json.data.vehiculo, servicios: json.data.servicios ?? [] };
  } catch (e) {
    console.error("[vehiculos] getVehiculo:", e);
    return null;
  }
}

export async function crearVehiculo(
  input: NuevoVehiculoInput
): Promise<{ ok: true; vehiculo: Vehiculo } | { ok: false; error: string }> {
  try {
    const res = await fetchWithSupabaseSession("/api/vehiculos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    const json = (await res.json().catch(() => ({}))) as Resp<{ vehiculo?: Vehiculo }>;
    if (!res.ok || !json.success || !json.data?.vehiculo) {
      return { ok: false, error: json.error ?? "No se pudo crear el vehículo." };
    }
    return { ok: true, vehiculo: json.data.vehiculo };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error de red." };
  }
}

export async function actualizarVehiculo(
  id: string,
  patch: Partial<NuevoVehiculoInput>
): Promise<{ ok: true; vehiculo: Vehiculo } | { ok: false; error: string }> {
  try {
    const res = await fetchWithSupabaseSession(`/api/vehiculos/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    const json = (await res.json().catch(() => ({}))) as Resp<{ vehiculo?: Vehiculo }>;
    if (!res.ok || !json.success || !json.data?.vehiculo) {
      return { ok: false, error: json.error ?? "No se pudo actualizar el vehículo." };
    }
    return { ok: true, vehiculo: json.data.vehiculo };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error de red." };
  }
}

export async function desactivarVehiculo(id: string): Promise<boolean> {
  try {
    const res = await fetchWithSupabaseSession(`/api/vehiculos/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    const json = await leer<{ desactivado?: boolean }>(res, "desactivarVehiculo");
    return Boolean(json.data?.desactivado);
  } catch (e) {
    console.error("[vehiculos] desactivarVehiculo:", e);
    return false;
  }
}

export async function getProximosServicios(
  opts: { dias?: number; soloVencidos?: boolean } = {}
): Promise<{ items: ProximoServicio[]; vencidos: number; por_vencer: number }> {
  const vacio = { items: [] as ProximoServicio[], vencidos: 0, por_vencer: 0 };
  try {
    const p = new URLSearchParams();
    if (opts.dias != null) p.set("dias", String(opts.dias));
    if (opts.soloVencidos) p.set("vencidos", "1");
    const qs = p.toString();
    const res = await fetchWithSupabaseSession(
      `/api/vehiculos/proximos-servicios${qs ? `?${qs}` : ""}`,
      { cache: "no-store" }
    );
    const json = await leer<{ items?: ProximoServicio[]; vencidos?: number; por_vencer?: number }>(
      res,
      "getProximosServicios"
    );
    if (!json.data?.items) return vacio;
    return {
      items: json.data.items,
      vencidos: json.data.vencidos ?? 0,
      por_vencer: json.data.por_vencer ?? 0,
    };
  } catch (e) {
    console.error("[vehiculos] getProximosServicios:", e);
    return vacio;
  }
}
