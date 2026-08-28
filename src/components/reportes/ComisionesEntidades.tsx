"use client";

/**
 * Comisiones por entidad de cobro.
 *
 * Vive DENTRO del reporte de rentabilidad por medio de pago, y no en una
 * pantalla aparte, porque es ahi donde el numero se nota: el reporte muestra
 * "comision 0" y al lado esta el lugar para corregirlo. Una pantalla de
 * configuracion escondida en otro menu es como todas las entidades quedaron
 * en cero desde que se creo la instancia.
 *
 * Lo que se carga acá lo usa el reporte para calcular el neto:
 *   neto = bruto - (bruto x comision%)
 *
 * Débito y crédito son entidades SEPARADAS a proposito: retienen distinto
 * (2,5% contra 5,5%), y una sola linea "POS" promediaria dos negocios distintos.
 */

import { useCallback, useEffect, useState } from "react";
import { Check, ChevronDown, ChevronRight, Loader2, Plus, X } from "lucide-react";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";

type Entidad = {
  id: string;
  nombre: string;
  tipo: string | null;
  activo: boolean;
  comision_porcentaje: number | null;
};

const TIPOS = ["tarjeta", "banco", "billetera", "caja", "otro"] as const;

const TIPO_LABEL: Record<string, string> = {
  tarjeta: "Tarjeta / POS",
  banco: "Banco",
  billetera: "Billetera",
  caja: "Caja",
  otro: "Otro",
};

const INPUT =
  "h-9 rounded-lg border border-slate-200 bg-white px-2 text-sm text-slate-800 outline-none transition-colors focus:border-[#4FAEB2] focus:ring-2 focus:ring-[#4FAEB2]/15";

export default function ComisionesEntidades({ onCambio }: { onCambio?: () => void }) {
  const [abierto, setAbierto] = useState(false);
  const [entidades, setEntidades] = useState<Entidad[]>([]);
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Alta.
  const [nuevoNombre, setNuevoNombre] = useState("");
  const [nuevoTipo, setNuevoTipo] = useState<string>("tarjeta");
  const [nuevaComision, setNuevaComision] = useState("");
  const [creando, setCreando] = useState(false);

  const cargar = useCallback(async () => {
    try {
      const r = await fetchWithSupabaseSession("/api/entidades-bancarias?todas=1", {
        cache: "no-store",
      });
      const j = await r.json();
      if (r.ok && j?.success) setEntidades((j.data?.entidades ?? []) as Entidad[]);
    } catch {
      setError("No se pudieron cargar las entidades.");
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  /** Guarda el porcentaje de una entidad. Vacío = no retiene nada. */
  async function guardarComision(e: Entidad, valor: string) {
    const texto = valor.trim();
    const n = texto === "" ? null : Number(texto.replace(",", "."));
    if (n != null && (!Number.isFinite(n) || n < 0 || n > 100)) {
      setError("La comisión va entre 0 y 100.");
      return;
    }
    if ((e.comision_porcentaje ?? null) === n) return;

    setGuardando(e.id);
    setError(null);
    try {
      const r = await fetchWithSupabaseSession("/api/entidades-bancarias", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: e.id, comision_porcentaje: n }),
      });
      if (!r.ok) throw new Error();
      setEntidades((prev) =>
        prev.map((x) => (x.id === e.id ? { ...x, comision_porcentaje: n } : x))
      );
      onCambio?.();
    } catch {
      setError("No se pudo guardar la comisión.");
      void cargar();
    } finally {
      setGuardando(null);
    }
  }

  /** Activa o da de baja una entidad. Las de baja no se ofrecen al cobrar. */
  async function alternarActiva(e: Entidad) {
    setGuardando(e.id);
    setError(null);
    try {
      const r = await fetchWithSupabaseSession("/api/entidades-bancarias", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: e.id, activo: !e.activo }),
      });
      if (!r.ok) throw new Error();
      setEntidades((prev) => prev.map((x) => (x.id === e.id ? { ...x, activo: !e.activo } : x)));
      onCambio?.();
    } catch {
      setError("No se pudo cambiar el estado de la entidad.");
      void cargar();
    } finally {
      setGuardando(null);
    }
  }

  async function crear() {
    const nombre = nuevoNombre.trim();
    if (!nombre) {
      setError("Poné un nombre.");
      return;
    }
    setCreando(true);
    setError(null);
    try {
      const r = await fetchWithSupabaseSession("/api/entidades-bancarias", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nombre,
          tipo: nuevoTipo,
          comision_porcentaje: nuevaComision.trim() || null,
          orden: entidades.length + 1,
        }),
      });
      const j = await r.json();
      if (!r.ok || !j?.success) throw new Error(j?.error ?? "");
      setNuevoNombre("");
      setNuevaComision("");
      await cargar();
      onCambio?.();
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : "No se pudo crear la entidad.");
    } finally {
      setCreando(false);
    }
  }

  const sinComision = entidades.filter((e) => e.activo && e.comision_porcentaje == null).length;

  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <span className="flex items-center gap-2">
          {abierto ? (
            <ChevronDown className="h-4 w-4 text-slate-400" />
          ) : (
            <ChevronRight className="h-4 w-4 text-slate-400" />
          )}
          <span className="text-sm font-semibold text-slate-800">Comisiones por entidad</span>
        </span>
        {!cargando && sinComision > 0 && (
          <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
            {sinComision} sin comisión cargada
          </span>
        )}
      </button>

      {abierto && (
        <div className="border-t border-slate-100 px-4 py-3">
          <p className="mb-3 text-[11px] leading-relaxed text-slate-500">
            Lo que retiene cada medio de cobro. Con esto el reporte descuenta la comisión y muestra
            lo que <strong>realmente entra</strong>. Vacío = no retiene nada. Conviene tener débito y
            crédito por separado: retienen distinto.
          </p>

          {cargando ? (
            <p className="py-6 text-center text-sm text-slate-400">Cargando…</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {entidades.map((e) => (
                <li key={e.id} className="flex items-center gap-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className={`truncate text-sm ${e.activo ? "text-slate-800" : "text-slate-400"}`}>
                      {e.nombre}
                      {!e.activo && <span className="ml-2 text-[11px]">(inactiva)</span>}
                    </p>
                    <p className="text-[11px] text-slate-400">
                      {TIPO_LABEL[e.tipo ?? "otro"] ?? e.tipo}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="number"
                      min={0}
                      max={100}
                      step="0.1"
                      defaultValue={e.comision_porcentaje ?? ""}
                      placeholder="0"
                      onBlur={(ev) => void guardarComision(e, ev.target.value)}
                      onKeyDown={(ev) => {
                        if (ev.key === "Enter") (ev.target as HTMLInputElement).blur();
                      }}
                      className={`${INPUT} w-20 text-right tabular-nums`}
                      aria-label={`Comisión de ${e.nombre}`}
                    />
                    <span className="w-3 text-xs text-slate-400">%</span>
                    {guardando === e.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-400" />
                    ) : (
                      <span className="w-3.5" />
                    )}
                    <button
                      type="button"
                      onClick={() => void alternarActiva(e)}
                      className="rounded-md border border-slate-200 px-2 py-1 text-[10px] font-medium text-slate-500 transition-colors hover:border-slate-300 hover:text-slate-700"
                      title={e.activo ? "No ofrecerla al cobrar" : "Volver a ofrecerla al cobrar"}
                    >
                      {e.activo ? "Dar de baja" : "Activar"}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {/* Alta */}
          <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-slate-100 pt-3">
            <div className="min-w-[10rem] flex-1">
              <label className="mb-1 block text-[11px] font-medium text-slate-500" htmlFor="ent-nombre">
                Nueva entidad
              </label>
              <input
                id="ent-nombre"
                value={nuevoNombre}
                onChange={(ev) => setNuevoNombre(ev.target.value)}
                placeholder="Ej: Tarjeta de crédito"
                className={`${INPUT} w-full`}
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-medium text-slate-500" htmlFor="ent-tipo">
                Tipo
              </label>
              <select
                id="ent-tipo"
                value={nuevoTipo}
                onChange={(ev) => setNuevoTipo(ev.target.value)}
                className={INPUT}
              >
                {TIPOS.map((t) => (
                  <option key={t} value={t}>
                    {TIPO_LABEL[t]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-medium text-slate-500" htmlFor="ent-com">
                Comisión %
              </label>
              <input
                id="ent-com"
                type="number"
                min={0}
                max={100}
                step="0.1"
                value={nuevaComision}
                onChange={(ev) => setNuevaComision(ev.target.value)}
                placeholder="5.5"
                className={`${INPUT} w-24 text-right tabular-nums`}
              />
            </div>
            <button
              type="button"
              onClick={() => void crear()}
              disabled={creando}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-[#4FAEB2] px-3 text-sm font-semibold text-white transition-colors hover:bg-[#3F8E91] disabled:opacity-60"
            >
              {creando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              Agregar
            </button>
          </div>

          {error && (
            <p className="mt-2 flex items-center gap-1.5 text-[11px] font-medium text-red-600">
              <X className="h-3 w-3" />
              {error}
            </p>
          )}
          {!error && !cargando && sinComision === 0 && entidades.length > 0 && (
            <p className="mt-2 flex items-center gap-1.5 text-[11px] text-emerald-600">
              <Check className="h-3 w-3" />
              Todas las entidades activas tienen su comisión cargada.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
