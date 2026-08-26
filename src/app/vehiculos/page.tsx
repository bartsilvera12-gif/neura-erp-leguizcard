"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Car, Plus, Search } from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import EdgeScrollArea from "@/components/ui/EdgeScrollArea";
import { getVehiculos } from "@/lib/vehiculos/storage";
import { COMBUSTIBLE_LABEL, type Vehiculo } from "@/lib/vehiculos/types";

function formatKm(km: number | null): string {
  return km == null ? "—" : `${Math.round(km).toLocaleString("es-PY")} km`;
}

export default function VehiculosPage() {
  const router = useRouter();
  const [lista, setLista] = useState<Vehiculo[]>([]);
  const [busqueda, setBusqueda] = useState("");
  const [soloActivos, setSoloActivos] = useState(true);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    let cancel = false;
    setCargando(true);
    getVehiculos().then((rows) => {
      if (cancel) return;
      setLista(rows);
      setCargando(false);
    });
    return () => {
      cancel = true;
    };
  }, []);

  const filtrados = useMemo(() => {
    const t = busqueda.trim().toLowerCase();
    return lista.filter((v) => {
      if (soloActivos && !v.activo) return false;
      if (!t) return true;
      return [v.patente, v.marca, v.modelo, v.cliente_nombre, v.motor, v.vin]
        .filter(Boolean)
        .some((c) => String(c).toLowerCase().includes(t));
    });
  }, [lista, busqueda, soloActivos]);

  const inactivos = lista.filter((v) => !v.activo).length;

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Zentra · Taller"
        title="Vehículos"
        description="Autos de los clientes. El historial de servicios cuelga de cada vehículo."
        actions={
          <Link
            href="/vehiculos/nuevo"
            className="inline-flex items-center gap-2 rounded-xl bg-[#4FAEB2] px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[#3F8E91]"
          >
            <Plus className="h-4 w-4" />
            Nuevo vehículo
          </Link>
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[240px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar por patente, marca, modelo o cliente…"
            className="w-full rounded-xl border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm shadow-sm outline-none transition-colors focus:border-[#4FAEB2]"
          />
        </div>
        {inactivos > 0 && (
          <label className="flex items-center gap-2 text-xs font-medium text-slate-600">
            <input
              type="checkbox"
              checked={soloActivos}
              onChange={(e) => setSoloActivos(e.target.checked)}
              className="h-4 w-4 accent-[#4FAEB2]"
            />
            Ocultar dados de baja ({inactivos})
          </label>
        )}
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm ring-1 ring-[#4FAEB2]/15 sm:p-6">
        {cargando ? (
          <p className="py-10 text-center text-sm text-slate-400">Cargando vehículos…</p>
        ) : filtrados.length === 0 ? (
          <div className="py-12 text-center">
            <Car className="mx-auto h-8 w-8 text-slate-300" />
            <p className="mt-3 text-sm font-medium text-slate-600">
              {lista.length === 0 ? "Todavía no hay vehículos cargados" : "Ningún vehículo coincide con la búsqueda"}
            </p>
            {lista.length === 0 && (
              <p className="mt-1 text-xs text-slate-400">
                Cargá el primero para empezar a registrar servicios por auto.
              </p>
            )}
          </div>
        ) : (
          <EdgeScrollArea className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-[11px] uppercase tracking-wide text-slate-400">
                  <th className="pb-2 pr-3 font-medium">Patente</th>
                  <th className="pb-2 pr-3 font-medium">Vehículo</th>
                  <th className="pb-2 pr-3 font-medium">Cliente</th>
                  <th className="pb-2 pr-3 font-medium">Combustible</th>
                  <th className="pb-2 pr-3 text-right font-medium">Kilometraje</th>
                  <th className="pb-2 font-medium">Estado</th>
                </tr>
              </thead>
              <tbody>
                {filtrados.map((v) => (
                  <tr
                    key={v.id}
                    onClick={() => router.push(`/vehiculos/${v.id}`)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        router.push(`/vehiculos/${v.id}`);
                      }
                    }}
                    tabIndex={0}
                    role="link"
                    aria-label={`Ver la ficha de ${v.patente}`}
                    className="cursor-pointer border-b border-slate-100 last:border-0 transition-colors hover:bg-slate-50/60 focus:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#4FAEB2]/40"
                  >
                    <td className="py-2.5 pr-3">
                      <Link
                        href={`/vehiculos/${v.id}`}
                        onClick={(e) => e.stopPropagation()}
                        className="font-mono font-semibold text-[#3F8E91] hover:underline"
                      >
                        {v.patente}
                      </Link>
                    </td>
                    <td className="py-2.5 pr-3 text-slate-700">
                      {[v.marca, v.modelo].filter(Boolean).join(" ") || "—"}
                      {v.anio ? <span className="text-slate-400"> · {v.anio}</span> : null}
                    </td>
                    <td className="py-2.5 pr-3 text-slate-600">{v.cliente_nombre ?? "—"}</td>
                    <td className="py-2.5 pr-3 text-slate-600">
                      {v.combustible ? COMBUSTIBLE_LABEL[v.combustible] : "—"}
                    </td>
                    <td className="py-2.5 pr-3 text-right font-mono text-slate-700">{formatKm(v.km_actual)}</td>
                    <td className="py-2.5">
                      {v.activo ? (
                        <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
                          Activo
                        </span>
                      ) : (
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">
                          De baja
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </EdgeScrollArea>
        )}
      </div>
    </div>
  );
}
