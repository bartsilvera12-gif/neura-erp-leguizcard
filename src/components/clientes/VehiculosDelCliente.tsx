"use client";

/**
 * Vehiculos de un cliente, desde su ficha.
 *
 * En un lubricentro se entra por el auto, pero cuando el cliente llama hay que
 * poder ir al reves: "que autos tiene Juan". Aca se ven, se vinculan y se
 * desvinculan.
 *
 * Vincular es asignarle el cliente al vehiculo (`vehiculos.cliente_id`): el
 * auto es la entidad y el dueno un dato suyo, no al reves. Por eso desvincular
 * NO borra nada — el auto sigue existiendo con todo su historial, solo queda
 * sin dueno asignado. Es lo que pasa cuando un auto se vende.
 */

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { Car, Link2Off, Loader2, Plus } from "lucide-react";
import BuscadorVehiculo from "@/components/vehiculos/BuscadorVehiculo";
import { actualizarVehiculo, getVehiculos } from "@/lib/vehiculos/storage";
import type { Vehiculo } from "@/lib/vehiculos/types";

const miles = (v: number) => Math.round(v).toLocaleString("es-PY");

export default function VehiculosDelCliente({
  clienteId,
  clienteLabel,
}: {
  clienteId: string;
  clienteLabel: string;
}) {
  const [todos, setTodos] = useState<Vehiculo[]>([]);
  const [cargando, setCargando] = useState(true);
  const [buscadorAbierto, setBuscadorAbierto] = useState(false);
  const [trabajando, setTrabajando] = useState<string | null>(null);
  const [confirmar, setConfirmar] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    // Se traen TODOS y se filtra en memoria: el buscador necesita los otros
    // para poder ofrecerlos, y son dos listas de la misma consulta.
    const rows = await getVehiculos();
    setTodos(rows);
    setCargando(false);
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const mios = todos.filter((v) => v.cliente_id === clienteId);

  async function vincular(v: Vehiculo) {
    setBuscadorAbierto(false);
    setTrabajando(v.id);
    setError(null);
    const r = await actualizarVehiculo(v.id, { cliente_id: clienteId });
    setTrabajando(null);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setTodos((prev) => prev.map((x) => (x.id === v.id ? r.vehiculo : x)));
  }

  async function desvincular(id: string) {
    setTrabajando(id);
    setError(null);
    const r = await actualizarVehiculo(id, { cliente_id: null });
    setTrabajando(null);
    setConfirmar(null);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setTodos((prev) => prev.map((x) => (x.id === id ? r.vehiculo : x)));
  }

  if (cargando) {
    return <p className="py-8 text-center text-sm text-slate-400">Cargando vehículos…</p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-800">
            Vehículos de {clienteLabel}
            <span className="ml-2 text-xs font-normal text-slate-400">({mios.length})</span>
          </h3>
          <p className="mt-0.5 text-xs text-slate-500">
            El historial de servicios cuelga de cada vehículo, no del cliente.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setBuscadorAbierto(true)}
          className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-[#4FAEB2] px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[#3F8E91]"
        >
          <Plus className="h-4 w-4" />
          Vincular vehículo
        </button>
      </div>

      {error && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      )}

      {mios.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-slate-200 py-10 text-center">
          <Car className="mx-auto h-7 w-7 text-slate-300" />
          <p className="mt-2 text-sm text-slate-500">Este cliente no tiene vehículos vinculados.</p>
          <p className="mt-1 text-xs text-slate-400">
            Vinculá uno existente o cargá uno nuevo desde el buscador.
          </p>
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {mios.map((v) => (
            <li
              key={v.id}
              className="flex items-center gap-3 rounded-xl border border-slate-200 p-3 transition-colors hover:border-[#4FAEB2]/60"
            >
              <div className="relative h-14 w-20 shrink-0 overflow-hidden rounded-lg bg-slate-100">
                {v.imagen_url ? (
                  <Image src={v.imagen_url} alt={v.patente} fill sizes="80px" className="object-cover" unoptimized />
                ) : (
                  <span className="flex h-full w-full items-center justify-center text-slate-300">
                    <Car className="h-5 w-5" />
                  </span>
                )}
              </div>

              <div className="min-w-0 flex-1">
                <Link
                  href={`/vehiculos/${v.id}`}
                  className="font-mono text-sm font-bold uppercase tracking-wide text-[#3F8E91] hover:underline"
                >
                  {v.patente}
                </Link>
                <p className="truncate text-xs text-slate-600">
                  {[v.marca, v.modelo].filter(Boolean).join(" ") || "Sin marca ni modelo"}
                  {v.anio ? ` · ${v.anio}` : ""}
                </p>
                <p className="truncate text-[11px] text-slate-400">
                  {v.km_actual != null ? `${miles(v.km_actual)} km` : "sin odómetro"}
                  {v.aceite_tipo ? ` · ${v.aceite_tipo}` : ""}
                </p>
              </div>

              {confirmar === v.id ? (
                <div className="flex shrink-0 flex-col gap-1">
                  <button
                    type="button"
                    onClick={() => desvincular(v.id)}
                    disabled={trabajando === v.id}
                    className="inline-flex items-center gap-1 rounded-lg bg-red-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-red-700 disabled:opacity-60"
                  >
                    {trabajando === v.id && <Loader2 className="h-3 w-3 animate-spin" />}
                    Sí, desvincular
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmar(null)}
                    className="rounded-lg border border-slate-200 px-2.5 py-1 text-[11px] text-slate-500 hover:bg-slate-50"
                  >
                    Cancelar
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmar(v.id)}
                  className="shrink-0 rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-red-600"
                  title="Desvincular de este cliente (el vehículo y su historial se conservan)"
                >
                  <Link2Off className="h-4 w-4" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {buscadorAbierto && (
        <BuscadorVehiculo
          vehiculos={todos}
          // Los que ya son de este cliente no se ofrecen de nuevo.
          excluir={mios.map((v) => v.id)}
          onElegir={vincular}
          onCreado={(v) => setTodos((prev) => [v, ...prev.filter((x) => x.id !== v.id)])}
          onCerrar={() => setBuscadorAbierto(false)}
          // Un auto creado desde acá nace ya vinculado a este cliente.
          clientes={[{ id: clienteId, label: clienteLabel }]}
          clienteIdVenta={clienteId}
        />
      )}
    </div>
  );
}
