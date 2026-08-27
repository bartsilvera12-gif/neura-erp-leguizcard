"use client";

import { useEffect, useState } from "react";
import { AlertCircle } from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import StatCard from "@/components/ui/StatCard";
import EdgeScrollArea from "@/components/ui/EdgeScrollArea";
import RangoFechasSelector from "@/components/reportes/RangoFechasSelector";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import Paginador from "@/components/reportes/Paginador";
import { usePaginacion } from "@/lib/reportes/usePaginacion";

type Item = {
  producto_id: string;
  nombre: string;
  sku: string | null;
  precio_venta: number;
  costo_teorico: number | null;
  margen_teorico: number | null;
  margen_teorico_pct: number | null;
  tiene_receta: boolean;
  insumos: number;
  intervalo_km: number | null;
  intervalo_meses: number | null;
  veces: number;
  facturado: number;
  costo: number;
  margen: number;
  margen_pct: number | null;
  ultima_vez: string | null;
};
type Totales = {
  servicios: number;
  sin_receta: number;
  realizados: number;
  facturado: number;
  costo: number;
  margen: number;
};

const gs = (v: number | null) => (v == null ? "—" : `Gs. ${Math.round(v).toLocaleString("es-PY")}`);
const pc = (v: number | null) => (v == null ? "—" : `${v.toFixed(1)}%`);

function primeroDeMesISO() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
}

export default function ReporteServiciosPage() {
  const [desde, setDesde] = useState(primeroDeMesISO());
  const [hasta, setHasta] = useState(new Date().toISOString().slice(0, 10));
  const [items, setItems] = useState<Item[]>([]);
  const [totales, setTotales] = useState<Totales | null>(null);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    let cancel = false;
    setCargando(true);
    fetchWithSupabaseSession(`/api/reportes/servicios?desde=${desde}&hasta=${hasta}`, { cache: "no-store" })
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
  }, [desde, hasta]);

  const pag1 = usePaginacion(items);

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Zentra · Taller"
        title="Servicios del lubricentro"
        description="Qué servicios se hacen, cuánto dejan, y qué margen tiene cada uno según su receta."
        backHref="/reportes"
        backLabel="Volver a reportes"
      />

      <RangoFechasSelector desde={desde} hasta={hasta} onChange={(r) => { setDesde(r.desde); setHasta(r.hasta); }} />

      {totales && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard compact label="Servicios en catálogo" value={String(totales.servicios)} hint={`${totales.sin_receta} sin receta`} />
          <StatCard compact label="Realizados en el período" value={String(totales.realizados)} />
          <StatCard compact label="Facturado" value={gs(totales.facturado)} />
          <StatCard compact label="Margen" value={gs(totales.margen)} hint={`costo ${gs(totales.costo)}`} />
        </div>
      )}

      {totales && totales.sin_receta > 0 && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <p className="text-sm text-amber-800">
            <strong>{totales.sin_receta}</strong>{" "}
            {totales.sin_receta === 1 ? "servicio no tiene receta" : "servicios no tienen receta"}. Sin
            receta no se puede calcular su costo real, y el margen queda igual al precio. Cargala en{" "}
            <strong>Recetas</strong>.
          </p>
        </div>
      )}

      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm ring-1 ring-[#4FAEB2]/15 sm:p-6">
        {cargando ? (
          <p className="py-10 text-center text-sm text-slate-400">Calculando…</p>
        ) : items.length === 0 ? (
          <div className="py-12 text-center">
            <p className="text-sm font-medium text-slate-600">Todavía no hay servicios cargados.</p>
            <p className="mt-1 text-xs text-slate-400">
              Un servicio es un producto con tipo <strong>Servicio</strong>. Cargale una receta con los
              insumos que consume y aparecerá acá con su costo y margen, aún sin ventas.
            </p>
          </div>
        ) : (
          <EdgeScrollArea className="overflow-x-auto">
            <table className="w-full min-w-[960px] text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-[11px] uppercase tracking-wide text-slate-400">
                  <th className="pb-2 pr-3 font-medium">Servicio</th>
                  <th className="pb-2 pr-3 text-right font-medium">Precio</th>
                  <th className="pb-2 pr-3 text-right font-medium">Costo receta</th>
                  <th className="pb-2 pr-3 text-right font-medium">Margen teórico</th>
                  <th className="pb-2 pr-3 text-right font-medium">Veces</th>
                  <th className="pb-2 pr-3 text-right font-medium">Facturado</th>
                  <th className="pb-2 text-right font-medium">Margen real</th>
                </tr>
              </thead>
              <tbody>
                {pag1.filas.map((i) => (
                  <tr key={i.producto_id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/60">
                    <td className="py-2.5 pr-3">
                      <span className="font-medium text-slate-800">{i.nombre}</span>
                      <div className="text-xs text-slate-400">
                        {i.sku && <span className="font-mono">{i.sku}</span>}
                        {i.tiene_receta ? (
                          <span> · {i.insumos} insumo{i.insumos === 1 ? "" : "s"}</span>
                        ) : (
                          <span className="text-amber-600"> · sin receta</span>
                        )}
                        {(i.intervalo_km || i.intervalo_meses) && (
                          <span>
                            {" · cada "}
                            {[
                              i.intervalo_km ? `${Math.round(i.intervalo_km).toLocaleString("es-PY")} km` : null,
                              i.intervalo_meses ? `${i.intervalo_meses} meses` : null,
                            ].filter(Boolean).join(" o ")}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-2.5 pr-3 text-right font-mono text-slate-700">{gs(i.precio_venta)}</td>
                    <td className="py-2.5 pr-3 text-right font-mono text-slate-500">{gs(i.costo_teorico)}</td>
                    <td className="py-2.5 pr-3 text-right font-mono">
                      <span className={i.margen_teorico != null && i.margen_teorico < 0 ? "text-red-600" : "text-slate-700"}>
                        {gs(i.margen_teorico)}
                      </span>
                      <div className="text-[11px] text-slate-400">{pc(i.margen_teorico_pct)}</div>
                    </td>
                    <td className="py-2.5 pr-3 text-right font-mono text-slate-600">{i.veces || "—"}</td>
                    <td className="py-2.5 pr-3 text-right font-mono text-slate-700">
                      {i.veces ? gs(i.facturado) : "—"}
                    </td>
                    <td className="py-2.5 text-right font-mono">
                      {i.veces ? (
                        <>
                          <span className={i.margen >= 0 ? "font-semibold text-emerald-700" : "font-semibold text-red-600"}>
                            {gs(i.margen)}
                          </span>
                          <div className="text-[11px] text-slate-400">{pc(i.margen_pct)}</div>
                        </>
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Paginador {...pag1.props} etiqueta="servicios" />
          </EdgeScrollArea>
        )}
        <p className="mt-4 text-[11px] text-slate-400">
          El <strong>margen teórico</strong> compara precio contra el costo de la receta y no depende de
          que haya ventas: sirve para revisar precios desde el día uno. El <strong>margen real</strong> usa
          lo efectivamente facturado en el período. El costo sale de <code>fn_receta_costeo()</code>, que
          contempla conversión de unidades, merma y rendimiento.
        </p>
      </div>
    </div>
  );
}
