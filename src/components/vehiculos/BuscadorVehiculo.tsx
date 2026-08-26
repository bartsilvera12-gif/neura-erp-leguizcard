"use client";

/**
 * Buscador de vehiculos para el mostrador.
 *
 * Una sola caja que encuentra por patente, marca, modelo, año, color, chasis,
 * aceite o nombre del cliente, tolerando como se escribe en la practica. Cada
 * resultado muestra foto, ultimo odometro, que aceite usa y cuando vino: eso es
 * lo que permite confirmar que es el auto correcto sin abrir su ficha.
 *
 * El puntaje vive en `lib/vehiculos/buscar.ts`, aparte de la UI, para poder
 * probarlo solo.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { Car, Loader2, Plus, Search } from "lucide-react";
import { buscarVehiculos, normalizar } from "@/lib/vehiculos/buscar";
import { crearVehiculo } from "@/lib/vehiculos/storage";
import type { Vehiculo } from "@/lib/vehiculos/types";

const miles = (v: number) => Math.round(v).toLocaleString("es-PY");

/** "hace 3 días" dice mas que una fecha cuando lo que importa es la distancia. */
function haceCuanto(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const dias = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  if (dias <= 0) return "hoy";
  if (dias === 1) return "ayer";
  if (dias < 30) return `hace ${dias} días`;
  const meses = Math.floor(dias / 30);
  if (meses < 12) return `hace ${meses} ${meses === 1 ? "mes" : "meses"}`;
  const anios = Math.floor(meses / 12);
  return `hace ${anios} ${anios === 1 ? "año" : "años"}`;
}

export default function BuscadorVehiculo({
  vehiculos,
  excluir,
  onElegir,
  onCreado,
  onCerrar,
}: {
  vehiculos: Vehiculo[];
  /** Ids ya cargados en la venta: no tiene sentido ofrecerlos de nuevo. */
  excluir: string[];
  onElegir: (v: Vehiculo) => void;
  /** Un auto recien creado hay que sumarlo a la lista de la pantalla. */
  onCreado: (v: Vehiculo) => void;
  onCerrar: () => void;
}) {
  const [q, setQ] = useState("");
  const [alta, setAlta] = useState<{ patente: string; marca: string; modelo: string } | null>(null);
  const [creando, setCreando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resaltado, setResaltado] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const excluidos = useMemo(() => new Set(excluir), [excluir]);
  const resultados = useMemo(
    () => buscarVehiculos(vehiculos.filter((v) => !excluidos.has(v.id)), q, 25),
    [vehiculos, excluidos, q]
  );

  useEffect(() => {
    setResaltado(0);
  }, [q]);

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      onCerrar();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setResaltado((i) => Math.min(i + 1, resultados.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setResaltado((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const r = resultados[resaltado];
      if (r) onElegir(r.vehiculo);
      else if (q.trim()) setAlta({ patente: q.trim().toUpperCase(), marca: "", modelo: "" });
    }
  }

  async function guardarNuevo() {
    if (!alta) return;
    if (normalizar(alta.patente).replace(/[^a-z0-9]/g, "").length < 3) {
      setError("La patente es muy corta.");
      return;
    }
    setCreando(true);
    setError(null);
    const r = await crearVehiculo({
      patente: alta.patente.trim(),
      marca: alta.marca.trim() || null,
      modelo: alta.modelo.trim() || null,
    });
    setCreando(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    onCreado(r.vehiculo);
    onElegir(r.vehiculo);
  }

  const INPUT =
    "w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none transition-colors focus:border-[#4FAEB2]";

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-slate-900/40 p-4 pt-[8vh] backdrop-blur-[2px]"
      onClick={onCerrar}
      role="presentation"
    >
      <div
        className="flex max-h-[80vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Buscar vehículo"
      >
        {/* Caja de búsqueda */}
        <div className="relative border-b border-slate-200">
          <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Patente, marca, modelo, color o cliente…"
            className="w-full border-0 py-4 pl-11 pr-4 text-base outline-none placeholder:text-slate-400"
          />
        </div>

        {alta ? (
          /* ── Alta rápida ──────────────────────────────────────────────── */
          <div className="p-4">
            <p className="mb-3 text-sm font-semibold text-slate-700">Vehículo nuevo</p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <input
                autoFocus
                value={alta.patente}
                onChange={(e) => setAlta({ ...alta, patente: e.target.value.toUpperCase() })}
                placeholder="Patente"
                className={`${INPUT} font-mono font-semibold uppercase`}
              />
              <input
                value={alta.marca}
                onChange={(e) => setAlta({ ...alta, marca: e.target.value })}
                placeholder="Marca"
                className={INPUT}
              />
              <input
                value={alta.modelo}
                onChange={(e) => setAlta({ ...alta, modelo: e.target.value })}
                placeholder="Modelo"
                className={INPUT}
              />
            </div>
            {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
            <p className="mt-2 text-[11px] text-slate-500">
              Se puede completar el resto (foto, aceite, cliente) después, desde su ficha.
            </p>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={guardarNuevo}
                disabled={creando}
                className="inline-flex items-center gap-1.5 rounded-xl bg-[#4FAEB2] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#3F8E91] disabled:opacity-60"
              >
                {creando && <Loader2 className="h-4 w-4 animate-spin" />}
                Guardar y usar
              </button>
              <button
                type="button"
                onClick={() => {
                  setAlta(null);
                  setError(null);
                }}
                className="rounded-xl border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50"
              >
                Volver
              </button>
            </div>
          </div>
        ) : (
          /* ── Resultados ───────────────────────────────────────────────── */
          <>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {resultados.length === 0 ? (
                <p className="px-4 py-8 text-center text-sm text-slate-400">
                  {q.trim() ? "Ningún vehículo coincide." : "Todavía no hay vehículos cargados."}
                </p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {resultados.map((r, i) => {
                    const v = r.vehiculo;
                    const visita = haceCuanto(v.ultima_visita);
                    return (
                      <li key={v.id}>
                        <button
                          type="button"
                          onClick={() => onElegir(v)}
                          onMouseEnter={() => setResaltado(i)}
                          className={`flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                            i === resaltado ? "bg-[#4FAEB2]/[0.09]" : "hover:bg-slate-50"
                          }`}
                        >
                          {/* Foto: reconocer el auto sin leer la chapa. */}
                          <div className="relative h-12 w-16 shrink-0 overflow-hidden rounded-lg bg-slate-100">
                            {v.imagen_url ? (
                              <Image
                                src={v.imagen_url}
                                alt={v.patente}
                                fill
                                sizes="64px"
                                className="object-cover"
                                unoptimized
                              />
                            ) : (
                              <span className="flex h-full w-full items-center justify-center text-slate-300">
                                <Car className="h-5 w-5" />
                              </span>
                            )}
                          </div>

                          <div className="min-w-0 flex-1">
                            <div className="flex items-baseline gap-2">
                              <span className="font-mono text-sm font-bold uppercase tracking-wide text-slate-900">
                                {v.patente}
                              </span>
                              {!v.activo && (
                                <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">
                                  De baja
                                </span>
                              )}
                            </div>
                            <p className="truncate text-xs text-slate-600">
                              {[v.marca, v.modelo].filter(Boolean).join(" ") || "Sin marca ni modelo"}
                              {v.anio ? ` · ${v.anio}` : ""}
                              {v.cliente_nombre ? ` · ${v.cliente_nombre}` : ""}
                            </p>
                            <p className="truncate text-[11px] text-slate-400">
                              {v.km_actual != null ? `${miles(v.km_actual)} km` : "sin odómetro"}
                              {v.aceite_tipo ? ` · ${v.aceite_tipo}` : ""}
                              {visita ? ` · vino ${visita}` : " · nunca vino"}
                            </p>
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <button
              type="button"
              onClick={() => setAlta({ patente: q.trim().toUpperCase(), marca: "", modelo: "" })}
              className="flex w-full items-center gap-2 border-t border-slate-200 bg-slate-50 px-4 py-3 text-left text-sm font-semibold text-[#3F8E91] transition-colors hover:bg-slate-100"
            >
              <Plus className="h-4 w-4" />
              {q.trim() ? `Cargar el vehículo "${q.trim().toUpperCase()}"` : "Cargar un vehículo nuevo"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
