"use client";

import Link from "next/link";
import { use, useCallback, useEffect, useState } from "react";
import { Car, Gauge, Loader2, Wrench } from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import { actualizarVehiculo, getVehiculo } from "@/lib/vehiculos/storage";
import { COMBUSTIBLE_LABEL, type ServicioVehiculo, type Vehiculo } from "@/lib/vehiculos/types";

function gs(v: number): string {
  return `Gs. ${Math.round(v).toLocaleString("es-PY")}`;
}
function km(v: number | null): string {
  return v == null ? "—" : `${Math.round(v).toLocaleString("es-PY")} km`;
}
function fecha(iso: string): string {
  try {
    const d = new Date(iso);
    return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
  } catch {
    return iso;
  }
}

function Dato({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className="mt-0.5 text-sm text-slate-800">{value ?? "—"}</dd>
    </div>
  );
}

export default function VehiculoDetallePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [vehiculo, setVehiculo] = useState<Vehiculo | null>(null);
  const [servicios, setServicios] = useState<ServicioVehiculo[]>([]);
  const [cargando, setCargando] = useState(true);

  const [nuevoKm, setNuevoKm] = useState("");
  const [guardandoKm, setGuardandoKm] = useState(false);
  const [errorKm, setErrorKm] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    const r = await getVehiculo(id);
    if (r) {
      setVehiculo(r.vehiculo);
      setServicios(r.servicios);
    }
    setCargando(false);
  }, [id]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  async function guardarKm(e: React.FormEvent) {
    e.preventDefault();
    setErrorKm(null);
    const v = Number(nuevoKm);
    if (!Number.isFinite(v) || v < 0) {
      setErrorKm("Kilometraje inválido.");
      return;
    }
    setGuardandoKm(true);
    const r = await actualizarVehiculo(id, { km_actual: v });
    setGuardandoKm(false);
    if (!r.ok) {
      setErrorKm(r.error);
      return;
    }
    setVehiculo(r.vehiculo);
    setNuevoKm("");
  }

  if (cargando) {
    return <p className="py-16 text-center text-sm text-slate-400">Cargando vehículo…</p>;
  }
  if (!vehiculo) {
    return (
      <div className="py-16 text-center">
        <p className="text-sm font-medium text-slate-600">Vehículo no encontrado.</p>
        <Link href="/vehiculos" className="mt-2 inline-block text-sm text-[#3F8E91] hover:underline">
          Volver a vehículos
        </Link>
      </div>
    );
  }

  const desc = [vehiculo.marca, vehiculo.modelo].filter(Boolean).join(" ");

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Zentra · Taller"
        title={vehiculo.patente}
        description={desc ? `${desc}${vehiculo.anio ? ` · ${vehiculo.anio}` : ""}` : "Sin marca ni modelo cargados"}
        backHref="/vehiculos"
        backLabel="Volver a vehículos"
      />

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Ficha */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm ring-1 ring-[#4FAEB2]/15 lg:col-span-2">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-800">
            <Car className="h-4 w-4 text-[#4FAEB2]" />
            Ficha del vehículo
          </h2>
          <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
            <Dato
              label="Cliente"
              value={
                vehiculo.cliente_id && vehiculo.cliente_nombre ? (
                  <Link href={`/clientes/${vehiculo.cliente_id}`} className="text-[#3F8E91] hover:underline">
                    {vehiculo.cliente_nombre}
                  </Link>
                ) : (
                  "Sin asignar"
                )
              }
            />
            <Dato label="Marca" value={vehiculo.marca} />
            <Dato label="Modelo" value={vehiculo.modelo} />
            <Dato label="Año" value={vehiculo.anio} />
            <Dato label="Motor" value={vehiculo.motor} />
            <Dato
              label="Combustible"
              value={vehiculo.combustible ? COMBUSTIBLE_LABEL[vehiculo.combustible] : null}
            />
            <Dato label="Color" value={vehiculo.color} />
            <Dato label="Chasis / VIN" value={vehiculo.vin ? <span className="font-mono text-xs">{vehiculo.vin}</span> : null} />
            <Dato
              label="Estado"
              value={vehiculo.activo ? "Activo" : <span className="text-slate-500">De baja</span>}
            />
          </dl>
          {vehiculo.observaciones && (
            <div className="mt-4 rounded-lg bg-slate-50 px-3 py-2">
              <p className="text-[11px] uppercase tracking-wide text-slate-400">Observaciones</p>
              <p className="mt-0.5 whitespace-pre-line text-sm text-slate-700">{vehiculo.observaciones}</p>
            </div>
          )}
        </div>

        {/* Kilometraje */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm ring-1 ring-[#4FAEB2]/15">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-800">
            <Gauge className="h-4 w-4 text-[#4FAEB2]" />
            Kilometraje
          </h2>
          <p className="mt-3 font-mono text-2xl font-bold text-slate-900">{km(vehiculo.km_actual)}</p>
          {vehiculo.km_actualizado_at && (
            <p className="mt-1 text-xs text-slate-400">Actualizado el {fecha(vehiculo.km_actualizado_at)}</p>
          )}

          <form onSubmit={guardarKm} className="mt-4 space-y-2">
            <label className="block text-xs font-medium text-slate-600" htmlFor="km">
              Registrar nueva lectura
            </label>
            <div className="flex gap-2">
              <input
                id="km"
                type="number"
                min={0}
                value={nuevoKm}
                onChange={(e) => setNuevoKm(e.target.value)}
                placeholder={vehiculo.km_actual != null ? String(Math.round(vehiculo.km_actual)) : "0"}
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none transition-colors focus:border-[#4FAEB2]"
              />
              <button
                type="submit"
                disabled={guardandoKm || !nuevoKm}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-[#4FAEB2] px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#3F8E91] disabled:opacity-50"
              >
                {guardandoKm && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Guardar
              </button>
            </div>
            {errorKm && <p className="text-xs text-red-600">{errorKm}</p>}
            <p className="text-[11px] text-slate-400">El odómetro no puede retroceder.</p>
          </form>
        </div>
      </div>

      {/* Historial de servicios */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm ring-1 ring-[#4FAEB2]/15 sm:p-6">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-800">
          <Wrench className="h-4 w-4 text-[#4FAEB2]" />
          Historial de servicios
          <span className="text-xs font-normal text-slate-400">({servicios.length})</span>
        </h2>

        {servicios.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-400">
            Todavía no hay servicios registrados para este vehículo.
          </p>
        ) : (
          <ul className="mt-4 space-y-3">
            {servicios.map((s) => (
              <li
                key={s.venta_id}
                className="rounded-lg border border-slate-100 px-4 py-3 transition-colors hover:bg-slate-50/60"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div className="flex items-baseline gap-3">
                    <span className="font-mono text-sm font-semibold text-slate-800">{s.numero_control}</span>
                    <span className="text-xs text-slate-500">{fecha(s.fecha)}</span>
                    {s.km_registrado != null && (
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 font-mono text-[11px] text-slate-600">
                        {km(s.km_registrado)}
                      </span>
                    )}
                    {s.estado === "anulada" && (
                      <span className="rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-medium text-red-600">
                        Anulada
                      </span>
                    )}
                  </div>
                  <span className="font-mono text-sm font-semibold text-slate-900">{gs(s.total)}</span>
                </div>
                {s.detalle.length > 0 && (
                  <p className="mt-1 text-xs text-slate-500">{s.detalle.join(" · ")}</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
