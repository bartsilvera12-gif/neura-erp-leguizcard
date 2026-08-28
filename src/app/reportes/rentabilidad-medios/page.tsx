"use client";

import { useEffect, useState } from "react";
import PageHeader from "@/components/ui/PageHeader";
import StatCard from "@/components/ui/StatCard";
import EdgeScrollArea from "@/components/ui/EdgeScrollArea";
import RangoFechasSelector from "@/components/reportes/RangoFechasSelector";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import Paginador from "@/components/reportes/Paginador";
import { usePaginacion } from "@/lib/reportes/usePaginacion";
import ComisionesEntidades from "@/components/reportes/ComisionesEntidades";

type Item = {
  metodo_pago: string;
  entidad_nombre: string | null;
  comision_porcentaje: number | null;
  operaciones: number;
  bruto: number;
  comision: number;
  neto: number;
  costo: number;
  margen: number;
};
type Totales = { bruto: number; comision: number; neto: number; costo: number; margen: number };

const gs = (v: number) => `Gs. ${Math.round(v).toLocaleString("es-PY")}`;
const pct = (parte: number, total: number) => (total > 0 ? `${((parte / total) * 100).toFixed(1)}%` : "—");

const METODO_LABEL: Record<string, string> = {
  efectivo: "Efectivo",
  tarjeta: "Tarjeta",
  transferencia: "Transferencia",
  qr: "QR",
  billetera: "Billetera",
  saldo_favor: "Saldo a favor",
  mixto: "Mixto",
  otro: "Otro",
};

function hoyISO() {
  return new Date().toISOString().slice(0, 10);
}
function primeroDeMesISO() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
}

export default function RentabilidadMediosPage() {
  const [desde, setDesde] = useState(primeroDeMesISO());
  const [hasta, setHasta] = useState(hoyISO());
  const [items, setItems] = useState<Item[]>([]);
  const [totales, setTotales] = useState<Totales | null>(null);
  const [cargando, setCargando] = useState(true);
  /** Sube cuando se cambia una comisión: el reporte se recalcula solo. */
  const [refresco, setRefresco] = useState(0);

  useEffect(() => {
    let cancel = false;
    setCargando(true);
    fetchWithSupabaseSession(
      `/api/reportes/rentabilidad-medios?desde=${desde}&hasta=${hasta}`,
      { cache: "no-store" }
    )
      .then((r) => r.json())
      .then((j) => {
        if (cancel) return;
        setItems(j?.data?.items ?? []);
        setTotales(j?.data?.totales ?? null);
        setCargando(false);
      })
      .catch(() => {
        if (!cancel) setCargando(false);
      });
    return () => {
      cancel = true;
    };
  }, [desde, hasta, refresco]);

  const pag1 = usePaginacion(items);

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Zentra · Análisis"
        title="Rentabilidad por método de pago"
        description="Cuánto entra realmente por cada medio, descontando la comisión del POS, y qué margen deja."
        backHref="/reportes"
        backLabel="Volver a reportes"
      />

      <RangoFechasSelector desde={desde} hasta={hasta} onChange={(r) => { setDesde(r.desde); setHasta(r.hasta); }} />

      {/* La configuracion vive junto al numero que explica: si el reporte dice
          "comision 0", el lugar para corregirlo esta a la vista. */}
      <ComisionesEntidades onCambio={() => setRefresco((n) => n + 1)} />

      {totales && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <StatCard compact label="Cobrado (bruto)" value={gs(totales.bruto)} />
          <StatCard compact label="Comisiones" value={gs(totales.comision)} hint={pct(totales.comision, totales.bruto) + " del bruto"} />
          <StatCard compact label="Neto recibido" value={gs(totales.neto)} />
          <StatCard compact label="Costo de lo vendido" value={gs(totales.costo)} />
          <StatCard compact label="Margen" value={gs(totales.margen)} hint={pct(totales.margen, totales.neto) + " del neto"} />
        </div>
      )}

      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm ring-1 ring-[#4FAEB2]/15 sm:p-6">
        {cargando ? (
          <p className="py-10 text-center text-sm text-slate-400">Calculando…</p>
        ) : items.length === 0 ? (
          <p className="py-12 text-center text-sm text-slate-400">
            No hay cobros registrados en el período.
          </p>
        ) : (
          <EdgeScrollArea className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-[11px] uppercase tracking-wide text-slate-400">
                  <th className="pb-2 pr-3 font-medium">Medio</th>
                  <th className="pb-2 pr-3 text-right font-medium">Ops.</th>
                  <th className="pb-2 pr-3 text-right font-medium">Bruto</th>
                  <th className="pb-2 pr-3 text-right font-medium">Comisión</th>
                  <th className="pb-2 pr-3 text-right font-medium">Neto</th>
                  <th className="pb-2 pr-3 text-right font-medium">Costo</th>
                  <th className="pb-2 text-right font-medium">Margen</th>
                </tr>
              </thead>
              <tbody>
                {pag1.filas.map((i, idx) => (
                  <tr key={idx} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/60">
                    <td className="py-2.5 pr-3">
                      <span className="font-medium text-slate-800">
                        {METODO_LABEL[i.metodo_pago] ?? i.metodo_pago}
                      </span>
                      {i.entidad_nombre && (
                        <div className="text-xs text-slate-400">
                          {i.entidad_nombre}
                          {i.comision_porcentaje ? ` · ${i.comision_porcentaje}% comisión` : ""}
                        </div>
                      )}
                    </td>
                    <td className="py-2.5 pr-3 text-right font-mono text-slate-600">{i.operaciones}</td>
                    <td className="py-2.5 pr-3 text-right font-mono text-slate-700">{gs(i.bruto)}</td>
                    <td className="py-2.5 pr-3 text-right font-mono text-amber-700">
                      {i.comision > 0 ? `− ${gs(i.comision)}` : "—"}
                    </td>
                    <td className="py-2.5 pr-3 text-right font-mono font-semibold text-slate-900">{gs(i.neto)}</td>
                    <td className="py-2.5 pr-3 text-right font-mono text-slate-500">{gs(i.costo)}</td>
                    <td className={`py-2.5 text-right font-mono font-semibold ${i.margen >= 0 ? "text-emerald-700" : "text-red-600"}`}>
                      {gs(i.margen)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Paginador {...pag1.props} etiqueta="medios de pago" />
          </EdgeScrollArea>
        )}
        <p className="mt-4 text-[11px] text-slate-400">
          La comisión sale de <strong>Configuración → entidades bancarias</strong>: cargá el porcentaje
          que retiene cada POS o billetera. El costo se prorratea entre los medios según cuánto se
          cobró con cada uno, así una venta mixta no carga todo el costo al primer medio.
        </p>
      </div>
    </div>
  );
}
