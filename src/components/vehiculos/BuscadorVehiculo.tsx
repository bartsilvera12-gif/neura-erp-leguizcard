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
import { Camera, Car, Loader2, Plus, Search, X } from "lucide-react";
import { buscarVehiculos, normalizar } from "@/lib/vehiculos/buscar";
import { crearVehiculo, subirImagenVehiculo } from "@/lib/vehiculos/storage";
import {
  COMBUSTIBLES,
  COMBUSTIBLE_LABEL,
  type Combustible,
  type Vehiculo,
} from "@/lib/vehiculos/types";

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

interface FormAlta {
  patente: string;
  cliente_id: string;
  marca: string;
  modelo: string;
  anio: string;
  motor: string;
  combustible: Combustible | "";
  color: string;
  vin: string;
  km_actual: string;
  aceite_tipo: string;
  aceite_litros: string;
  observaciones: string;
}

function formVacio(patente: string, clienteId: string): FormAlta {
  return {
    patente,
    cliente_id: clienteId,
    marca: "",
    modelo: "",
    anio: "",
    motor: "",
    combustible: "",
    color: "",
    vin: "",
    km_actual: "",
    aceite_tipo: "",
    aceite_litros: "",
    observaciones: "",
  };
}

export default function BuscadorVehiculo({
  vehiculos,
  excluir,
  onElegir,
  onCreado,
  onCerrar,
  clientes = [],
  clienteIdVenta = "",
}: {
  vehiculos: Vehiculo[];
  /** Ids ya cargados en la venta: no tiene sentido ofrecerlos de nuevo. */
  excluir: string[];
  onElegir: (v: Vehiculo) => void;
  /** Un auto recien creado hay que sumarlo a la lista de la pantalla. */
  onCreado: (v: Vehiculo) => void;
  onCerrar: () => void;
  /** Clientes de la venta, para poder asignarle dueno al auto nuevo. */
  clientes?: { id: string; label: string }[];
  /** Cliente ya elegido en la venta: se propone como dueno del auto nuevo. */
  clienteIdVenta?: string;
}) {
  const [q, setQ] = useState("");
  /**
   * La ficha completa se carga aca mismo. Antes solo se pedia patente, marca y
   * modelo y el resto quedaba para despues: en la practica "despues" es nunca,
   * y el auto termina sin el aceite ni el odometro, que es justo lo que el
   * seguimiento de mantenimiento necesita.
   */
  const [alta, setAlta] = useState<FormAlta | null>(null);
  /** La foto se sube DESPUES de crear: recien ahi existe el id que la nombra. */
  const [foto, setFoto] = useState<File | null>(null);
  const [fotoPreview, setFotoPreview] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const fotoRef = useRef<HTMLInputElement>(null);
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
      else if (q.trim()) abrirAlta();
    }
  }

  function abrirAlta() {
    setAlta(formVacio(q.trim().toUpperCase(), clienteIdVenta));
    setFoto(null);
    setFotoPreview(null);
    setError(null);
    setAviso(null);
  }

  function elegirFoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // Se limpia siempre: sin esto, elegir el mismo archivo dos veces seguidas
    // no dispara onChange y parece que no pasa nada.
    e.target.value = "";
    if (!file) return;
    setFoto(file);
    setFotoPreview(URL.createObjectURL(file));
  }

  /** Numero del formulario, o null si esta vacio o no es valido. */
  function num(v: string): number | null {
    const t = v.trim();
    if (t === "") return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  }

  async function guardarNuevo() {
    if (!alta) return;
    if (normalizar(alta.patente).replace(/[^a-z0-9]/g, "").length < 3) {
      setError("La patente es muy corta.");
      return;
    }
    const anio = num(alta.anio);
    if (anio != null && (anio < 1900 || anio > 2200)) {
      setError("Año inválido.");
      return;
    }
    const litros = num(alta.aceite_litros);
    if (litros != null && (litros <= 0 || litros > 100)) {
      setError("Litros de aceite inválidos.");
      return;
    }
    const km = num(alta.km_actual);
    if (km != null && km < 0) {
      setError("Kilometraje inválido.");
      return;
    }

    setCreando(true);
    setError(null);
    const r = await crearVehiculo({
      patente: alta.patente.trim(),
      cliente_id: alta.cliente_id || null,
      marca: alta.marca.trim() || null,
      modelo: alta.modelo.trim() || null,
      anio,
      motor: alta.motor.trim() || null,
      combustible: alta.combustible || null,
      color: alta.color.trim() || null,
      vin: alta.vin.trim() || null,
      km_actual: km,
      aceite_tipo: alta.aceite_tipo.trim() || null,
      aceite_litros: litros,
      observaciones: alta.observaciones.trim() || null,
    });
    if (!r.ok) {
      setCreando(false);
      setError(r.error);
      return;
    }

    // La foto va DESPUES: recien ahora existe el id que la nombra. Si falla, el
    // vehiculo ya esta creado y no se lo tira por eso — se avisa y sigue.
    let vehiculo = r.vehiculo;
    if (foto) {
      const f = await subirImagenVehiculo(vehiculo.id, foto);
      if (f.ok) vehiculo = { ...vehiculo, imagen_url: f.imagen_url };
      else setAviso(`El vehículo se creó, pero la foto no subió: ${f.error}`);
    }
    setCreando(false);

    onCreado(vehiculo);
    onElegir(vehiculo);
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
          /* ── Alta: la ficha completa, sin salir de la venta ──────────────
              El "lo completo después" en la practica es nunca, y el auto queda
              sin aceite ni odometro — que es justo lo que el seguimiento de
              mantenimiento necesita para servir de algo. */
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-sm font-semibold text-slate-700">Vehículo nuevo</p>
              <span className="text-[11px] text-slate-400">Solo la patente es obligatoria</span>
            </div>

            <div className="flex flex-col gap-4 sm:flex-row">
              {/* Foto: se sube apenas se crea el auto. */}
              <div className="w-full shrink-0 sm:w-40">
                <div className="relative aspect-[4/3] w-full overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
                  {fotoPreview ? (
                    <>
                      {/* Preview local (blob), no pasa por el optimizador. */}
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={fotoPreview} alt="Foto elegida" className="h-full w-full object-cover" />
                      <button
                        type="button"
                        onClick={() => {
                          setFoto(null);
                          setFotoPreview(null);
                        }}
                        className="absolute right-1 top-1 rounded-full bg-white/90 p-1 text-slate-500 shadow hover:text-red-600"
                        aria-label="Quitar foto"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => fotoRef.current?.click()}
                      className="flex h-full w-full flex-col items-center justify-center gap-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-[#3F8E91]"
                    >
                      <Camera className="h-6 w-6" />
                      <span className="text-[11px] font-medium">Foto (opcional)</span>
                    </button>
                  )}
                </div>
                <input
                  ref={fotoRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={elegirFoto}
                  className="hidden"
                />
              </div>

              <div className="grid flex-1 grid-cols-2 gap-2 sm:grid-cols-3">
                <input
                  autoFocus
                  value={alta.patente}
                  onChange={(e) => setAlta({ ...alta, patente: e.target.value.toUpperCase() })}
                  placeholder="Patente *"
                  className={`${INPUT} col-span-2 font-mono font-semibold uppercase sm:col-span-1`}
                />
                <select
                  value={alta.cliente_id}
                  onChange={(e) => setAlta({ ...alta, cliente_id: e.target.value })}
                  className={`${INPUT} col-span-2`}
                >
                  <option value="">Sin cliente</option>
                  {clientes.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </select>

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
                <input
                  type="number"
                  min={1900}
                  max={2200}
                  value={alta.anio}
                  onChange={(e) => setAlta({ ...alta, anio: e.target.value })}
                  placeholder="Año"
                  className={INPUT}
                />

                <input
                  value={alta.motor}
                  onChange={(e) => setAlta({ ...alta, motor: e.target.value })}
                  placeholder="Motor"
                  className={INPUT}
                />
                <select
                  value={alta.combustible}
                  onChange={(e) => setAlta({ ...alta, combustible: e.target.value as Combustible | "" })}
                  className={INPUT}
                >
                  <option value="">Combustible</option>
                  {COMBUSTIBLES.map((c) => (
                    <option key={c} value={c}>
                      {COMBUSTIBLE_LABEL[c]}
                    </option>
                  ))}
                </select>
                <input
                  value={alta.color}
                  onChange={(e) => setAlta({ ...alta, color: e.target.value })}
                  placeholder="Color"
                  className={INPUT}
                />

                <input
                  value={alta.vin}
                  onChange={(e) => setAlta({ ...alta, vin: e.target.value })}
                  placeholder="Chasis / VIN"
                  className={`${INPUT} col-span-2 font-mono`}
                />
                <input
                  type="number"
                  min={0}
                  value={alta.km_actual}
                  onChange={(e) => setAlta({ ...alta, km_actual: e.target.value })}
                  placeholder="Km actual"
                  className={INPUT}
                />
              </div>
            </div>

            {/* Aceite: separado porque es el dato que dispara el mantenimiento. */}
            <div className="mt-3 rounded-xl border border-[#4FAEB2]/30 bg-[#4FAEB2]/5 p-3">
              <p className="mb-2 text-xs font-semibold text-slate-700">Aceite que usa</p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <input
                  value={alta.aceite_tipo}
                  onChange={(e) => setAlta({ ...alta, aceite_tipo: e.target.value })}
                  placeholder="Ej: 15W40 semisintético"
                  className={INPUT}
                />
                <input
                  type="number"
                  min={0}
                  step="0.1"
                  value={alta.aceite_litros}
                  onChange={(e) => setAlta({ ...alta, aceite_litros: e.target.value })}
                  placeholder="Litros del cambio"
                  className={INPUT}
                />
              </div>
            </div>

            <textarea
              value={alta.observaciones}
              onChange={(e) => setAlta({ ...alta, observaciones: e.target.value })}
              rows={2}
              placeholder="Observaciones"
              className={`${INPUT} mt-3`}
            />

            {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
            {aviso && <p className="mt-2 text-xs text-amber-700">{aviso}</p>}

            <div className="mt-4 flex gap-2">
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
                  setAviso(null);
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
              onClick={abrirAlta}
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
