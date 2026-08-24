"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Phone, Search } from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import StatCard from "@/components/ui/StatCard";
import EdgeScrollArea from "@/components/ui/EdgeScrollArea";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";

type Item = {
  cliente_id: string | null;
  cliente_nombre: string | null;
  cliente_telefono: string | null;
  vehiculos: number;
  patentes: string[];
  visitas: number;
  facturado: number;
  ultima_visita: string | null;
  dias_sin_venir: number | null;
  ticket_promedio: number;
};
type Totales = { clientes: number; con_vehiculo: number; facturado: number; inactivos: number };

const gs = (v: number) => `Gs. ${Math.round(v).toLocaleString("es-PY")}`;
function fecha(iso: string | null): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
  } catch {
    return iso;
  }
}

export default function HistorialClientesPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [totales, setTotales] = useState<Totales | null>(null);
  const [cargando, setCargando] = useState(true);
  const [busqueda, setBusqueda] = useState("");
  const [soloInactivos, setSoloInactivos] = useState(false);

  useEffect(() => {
    let cancel = false;
    fetchWithSupabaseSession("/api/reportes/historial-clientes", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (cancel) return;
        setItems(j?.data?.items ?? []);
        setTotales(j?.data?.totales ?? null);
        setCargando(false);
      })
      .catch(() => !cancel && setCargando(false));
    return () => {
      cancel = true;
    };
  }, []);

  const filtrados = useMemo(() => {
    const t = busqueda.trim().toLowerCase();
    return items.filter((i) => {
      if (soloInactivos && !(i.visitas > 0 && (i.dias_sin_venir ?? 0) > 180)) return false;
      if (!t) return true;
      return (
        (i.cliente_nombre ?? "").toLowerCase().includes(t) ||
        (i.cliente_telefono ?? "").toLowerCase().includes(t) ||
        i.patentes.some((p) => p.toLowerCase().includes(t))
      );
    });
  }, [items, busqueda, soloInactivos]);

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Zentra · Taller"
        title="Historial de clientes"
        description="Qué autos tiene cada cliente, cuántas veces vino, cuánto gastó y hace cuánto no aparece."
        backHref="/reportes"
        backLabel="Volver a reportes"
      />

      {totales && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard compact label="Clientes" value={String(totales.clientes)} hint={`${totales.con_vehiculo} con vehículo`} />
          <StatCard compact label="Facturado histórico" value={gs(totales.facturado)} />
          <StatCard compact label="Sin venir hace +6 meses" value={String(totales.inactivos)} hint="candidatos a recontactar" />
          <StatCard compact label="Con auto cargado" value={String(totales.con_vehiculo)} />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[240px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar por cliente, teléfono o patente…"
            className="w-full rounded-xl border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm shadow-sm outline-none transition-colors focus:border-[#4FAEB2]"
          />
        </div>
        <label className="flex items-center gap-2 text-xs font-medium text-slate-600">
          <input
            type="checkbox"
            checked={soloInactivos}
            onChange={(e) => setSoloInactivos(e.target.checked)}
            className="h-4 w-4 accent-[#4FAEB2]"
          />
          Solo los que no vienen hace +6 meses
        </label>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm ring-1 ring-[#4FAEB2]/15 sm:p-6">
        {cargando ? (
          <p className="py-10 text-center text-sm text-slate-400">Cargando…</p>
        ) : filtrados.length === 0 ? (
          <p className="py-12 text-center text-sm text-slate-400">
            {items.length === 0
              ? "Todavía no hay clientes con vehículos ni ventas."
              : "Ningún cliente coincide con el filtro."}
          </p>
        ) : (
          <EdgeScrollArea className="overflow-x-auto">
            <table className="w-full min-w-[880px] text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-[11px] uppercase tracking-wide text-slate-400">
                  <th className="pb-2 pr-3 font-medium">Cliente</th>
                  <th className="pb-2 pr-3 font-medium">Vehículos</th>
                  <th className="pb-2 pr-3 text-right font-medium">Visitas</th>
                  <th className="pb-2 pr-3 text-right font-medium">Facturado</th>
                  <th className="pb-2 pr-3 text-right font-medium">Ticket prom.</th>
                  <th className="pb-2 font-medium">Última visita</th>
                </tr>
              </thead>
              <tbody>
                {filtrados.map((i) => {
                  const inactivo = i.visitas > 0 && (i.dias_sin_venir ?? 0) > 180;
                  return (
                    <tr key={i.cliente_id ?? i.cliente_nombre} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/60">
                      <td className="py-2.5 pr-3">
                        {i.cliente_id ? (
                          <Link href={`/clientes/${i.cliente_id}`} className="font-medium text-[#3F8E91] hover:underline">
                            {i.cliente_nombre ?? "—"}
                          </Link>
                        ) : (
                          <span className="font-medium text-slate-800">{i.cliente_nombre ?? "—"}</span>
                        )}
                        {i.cliente_telefono && (
                          <div className="flex items-center gap-1 text-xs text-slate-400">
                            <Phone className="h-3 w-3" />
                            {i.cliente_telefono}
                          </div>
                        )}
                      </td>
                      <td className="py-2.5 pr-3">
                        {i.patentes.length === 0 ? (
                          <span className="text-xs text-slate-400">Sin vehículos</span>
                        ) : (
                          <div className="flex flex-wrap gap-1">
                            {i.patentes.map((p) => (
                              <span key={p} className="rounded-full bg-slate-100 px-2 py-0.5 font-mono text-[11px] text-slate-600">
                                {p}
                              </span>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="py-2.5 pr-3 text-right font-mono text-slate-600">{i.visitas || "—"}</td>
                      <td className="py-2.5 pr-3 text-right font-mono text-slate-700">{i.visitas ? gs(i.facturado) : "—"}</td>
                      <td className="py-2.5 pr-3 text-right font-mono text-slate-500">{i.visitas ? gs(i.ticket_promedio) : "—"}</td>
                      <td className="py-2.5">
                        <span className={inactivo ? "font-medium text-amber-700" : "text-slate-600"}>
                          {fecha(i.ultima_visita)}
                        </span>
                        {i.dias_sin_venir != null && i.visitas > 0 && (
                          <div className="text-[11px] text-slate-400">hace {i.dias_sin_venir} días</div>
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
