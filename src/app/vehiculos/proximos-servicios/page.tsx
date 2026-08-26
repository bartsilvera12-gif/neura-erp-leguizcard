"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CalendarClock, CheckCircle2, Phone } from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import EdgeScrollArea from "@/components/ui/EdgeScrollArea";
import StatCard from "@/components/ui/StatCard";
import { getProximosServicios } from "@/lib/vehiculos/storage";
import type { ProximoServicio } from "@/lib/vehiculos/types";

function fecha(iso: string | null): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
  } catch {
    return iso;
  }
}
function km(v: number | null): string {
  return v == null ? "—" : `${Math.round(v).toLocaleString("es-PY")} km`;
}

/** Texto de cuánto falta: se muestra el criterio que vence primero. */
function restante(i: ProximoServicio): { texto: string; urgente: boolean } {
  const partes: string[] = [];
  if (i.km_restantes != null) {
    partes.push(
      i.km_restantes < 0
        ? `${Math.abs(Math.round(i.km_restantes)).toLocaleString("es-PY")} km pasado`
        : `faltan ${Math.round(i.km_restantes).toLocaleString("es-PY")} km`
    );
  }
  if (i.dias_restantes != null) {
    partes.push(
      i.dias_restantes < 0
        ? `${Math.abs(i.dias_restantes)} días pasado`
        : `faltan ${i.dias_restantes} días`
    );
  }
  return { texto: partes.join(" · ") || "—", urgente: i.vencido };
}

const VENTANAS = [
  { dias: 15, label: "15 días" },
  { dias: 30, label: "30 días" },
  { dias: 60, label: "60 días" },
  { dias: 90, label: "90 días" },
];

export default function ProximosServiciosPage() {
  const router = useRouter();
  const [items, setItems] = useState<ProximoServicio[]>([]);
  const [cargando, setCargando] = useState(true);
  const [dias, setDias] = useState(30);
  const [soloVencidos, setSoloVencidos] = useState(false);

  useEffect(() => {
    let cancel = false;
    setCargando(true);
    getProximosServicios({ dias, soloVencidos }).then((r) => {
      if (cancel) return;
      setItems(r.items);
      setCargando(false);
    });
    return () => {
      cancel = true;
    };
  }, [dias, soloVencidos]);

  const vencidos = useMemo(() => items.filter((i) => i.vencido).length, [items]);
  const porVencer = items.length - vencidos;

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Zentra · Taller"
        title="Próximos servicios"
        description="Vehículos a los que les toca mantenimiento, por kilometraje o por tiempo."
        backHref="/vehiculos"
        backLabel="Volver a vehículos"
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard compact label="Vencidos" value={String(vencidos)} hint="ya pasaron el intervalo" />
        <StatCard compact label="Por vencer" value={String(porVencer)} hint={`dentro de ${dias} días`} />
        <StatCard compact label="Total a contactar" value={String(items.length)} />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-medium text-slate-500">Ventana:</span>
          {VENTANAS.map((v) => (
            <button
              key={v.dias}
              type="button"
              onClick={() => setDias(v.dias)}
              className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${
                dias === v.dias
                  ? "bg-[#4FAEB2] text-white"
                  : "border border-slate-200 text-slate-600 hover:bg-slate-50"
              }`}
            >
              {v.label}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-xs font-medium text-slate-600">
          <input
            type="checkbox"
            checked={soloVencidos}
            onChange={(e) => setSoloVencidos(e.target.checked)}
            className="h-4 w-4 accent-[#4FAEB2]"
          />
          Solo vencidos
        </label>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm ring-1 ring-[#4FAEB2]/15 sm:p-6">
        {cargando ? (
          <p className="py-10 text-center text-sm text-slate-400">Calculando…</p>
        ) : items.length === 0 ? (
          <div className="py-12 text-center">
            <CheckCircle2 className="mx-auto h-8 w-8 text-emerald-400" />
            <p className="mt-3 text-sm font-medium text-slate-600">No hay servicios pendientes.</p>
            <p className="mt-1 text-xs text-slate-400">
              Los avisos aparecen cuando un servicio tiene intervalo configurado y ya se le hizo
              al menos una vez al vehículo.
            </p>
          </div>
        ) : (
          <EdgeScrollArea className="overflow-x-auto">
            <table className="w-full min-w-[880px] text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-[11px] uppercase tracking-wide text-slate-400">
                  <th className="pb-2 pr-3 font-medium">Vehículo</th>
                  <th className="pb-2 pr-3 font-medium">Cliente</th>
                  <th className="pb-2 pr-3 font-medium">Servicio</th>
                  <th className="pb-2 pr-3 font-medium">Último</th>
                  <th className="pb-2 pr-3 font-medium">Toca en</th>
                  <th className="pb-2 font-medium">Estado</th>
                </tr>
              </thead>
              <tbody>
                {items.map((i) => {
                  const r = restante(i);
                  return (
                    <tr
                      key={`${i.vehiculo_id}-${i.producto_id}`}
                      onClick={() => router.push(`/vehiculos/${i.vehiculo_id}`)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          router.push(`/vehiculos/${i.vehiculo_id}`);
                        }
                      }}
                      tabIndex={0}
                      role="link"
                      aria-label={`Ver la ficha de ${i.patente}`}
                      className="cursor-pointer border-b border-slate-100 last:border-0 transition-colors hover:bg-slate-50/60 focus:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#4FAEB2]/40"
                    >
                      <td className="py-2.5 pr-3">
                        <Link
                          href={`/vehiculos/${i.vehiculo_id}`}
                          onClick={(e) => e.stopPropagation()}
                          className="font-mono font-semibold text-[#3F8E91] hover:underline"
                        >
                          {i.patente}
                        </Link>
                        <div className="text-xs text-slate-400">
                          {[i.marca, i.modelo].filter(Boolean).join(" ") || "—"}
                          {i.km_actual != null && <span> · {km(i.km_actual)}</span>}
                        </div>
                      </td>
                      <td className="py-2.5 pr-3 text-slate-600">
                        {i.cliente_nombre ?? "—"}
                        {i.cliente_telefono && (
                          <div className="flex items-center gap-1 text-xs text-slate-400">
                            <Phone className="h-3 w-3" />
                            {i.cliente_telefono}
                          </div>
                        )}
                      </td>
                      <td className="py-2.5 pr-3 text-slate-700">
                        {i.servicio_nombre}
                        <div className="text-xs text-slate-400">
                          cada{" "}
                          {[
                            i.intervalo_km ? `${Math.round(i.intervalo_km).toLocaleString("es-PY")} km` : null,
                            i.intervalo_meses ? `${i.intervalo_meses} meses` : null,
                          ]
                            .filter(Boolean)
                            .join(" o ")}
                        </div>
                      </td>
                      <td className="py-2.5 pr-3 text-slate-600">
                        {fecha(i.ultima_fecha)}
                        <div className="font-mono text-xs text-slate-400">{km(i.ultimo_km)}</div>
                      </td>
                      <td className="py-2.5 pr-3">
                        <span className={r.urgente ? "font-medium text-red-600" : "text-slate-700"}>
                          {r.texto}
                        </span>
                        {i.proxima_fecha && (
                          <div className="text-xs text-slate-400">{fecha(i.proxima_fecha)}</div>
                        )}
                      </td>
                      <td className="py-2.5">
                        {i.vencido ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700">
                            <AlertTriangle className="h-3 w-3" />
                            Vencido
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
                            <CalendarClock className="h-3 w-3" />
                            Por vencer
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </EdgeScrollArea>
        )}
      </div>
    </div>
  );
}
