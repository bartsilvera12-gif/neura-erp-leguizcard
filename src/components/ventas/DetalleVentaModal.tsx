"use client";

/**
 * Detalle de una venta: que se vendio, a quien y a que auto.
 *
 * Es un panel y no una pagina a proposito. Se abre desde el listado para una
 * consulta corta ("que llevaba la VTA-000012"), y volver tiene que ser cerrar,
 * no navegar hacia atras y perder los filtros y el scroll de la lista.
 *
 * No pide nada al servidor: el listado ya trae la venta completa con sus items,
 * asi que abre instantaneo.
 */

import { useEffect } from "react";
import Link from "next/link";
import { Car, Printer, User, X } from "lucide-react";
import type { Venta } from "@/lib/ventas/types";

const gs = (v: number) => `Gs. ${Math.round(v).toLocaleString("es-PY")}`;
const miles = (v: number) => Math.round(v).toLocaleString("es-PY");

function fechaHora(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const f = `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
  return `${f} · ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

const METODO: Record<string, string> = {
  efectivo: "Efectivo",
  tarjeta: "Tarjeta",
  transferencia: "Transferencia",
  mixto: "Mixto",
};

export default function DetalleVentaModal({
  venta,
  onClose,
}: {
  venta: Venta;
  onClose: () => void;
}) {
  // Escape cierra: es la salida que la gente prueba primero en un panel.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const unidades = venta.items.reduce((s, i) => s + i.cantidad, 0);
  const autos = venta.vehiculos ?? [];

  /**
   * Con varios autos el listado plano no sirve: hay que ver que se le puso a
   * cada uno. Con uno solo se muestra plano, sin un encabezado que no aporta.
   */
  const grupos: { titulo: string | null; subtitulo: string | null; lineas: typeof venta.items }[] =
    autos.length > 1
      ? [
          ...autos.map((a) => ({
            titulo: a.patente,
            subtitulo: [a.descripcion, a.km_registrado != null ? `${miles(a.km_registrado)} km` : null]
              .filter(Boolean)
              .join(" · ") || null,
            lineas: venta.items.filter((i) => i.vehiculo_id === a.vehiculo_id),
          })),
          // Lo que no quedo asignado a ningun auto no se puede esconder: es
          // parte de la venta y tiene que sumar a la vista.
          {
            titulo: "Sin vehículo asignado",
            subtitulo: null,
            lineas: venta.items.filter((i) => !i.vehiculo_id),
          },
        ].filter((g) => g.lineas.length > 0)
      : [{ titulo: null, subtitulo: null, lineas: venta.items }];

  // El IVA se desglosa por tasa: en una misma venta puede haber 10%, 5% y
  // exentas, y un unico total de IVA no deja ver cual es cual.
  const porIva = new Map<string, number>();
  for (const i of venta.items) {
    porIva.set(i.tipo_iva, (porIva.get(i.tipo_iva) ?? 0) + i.monto_iva);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-0 backdrop-blur-[2px] sm:items-center sm:p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`Detalle de la venta ${venta.numero_control}`}
      >
        {/* ── Cabecera ─────────────────────────────────────────────────── */}
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4 sm:px-6">
          <div className="min-w-0">
            <p className="font-mono text-lg font-bold tracking-tight text-slate-900">
              {venta.numero_control}
            </p>
            <p className="mt-0.5 text-xs text-slate-500">{fechaHora(venta.fecha)}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <a
              href={`/api/ventas/${venta.id}/ticket`}
              target="_blank"
              rel="noopener"
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-50"
            >
              <Printer className="h-3.5 w-3.5" />
              Imprimir
            </a>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
              aria-label="Cerrar"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* ── Etiquetas de condición ───────────────────────────────────── */}
        <div className="flex flex-wrap gap-2 border-b border-slate-100 px-5 py-3 sm:px-6">
          <span
            className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
              venta.tipo_venta === "CONTADO"
                ? "bg-emerald-50 text-emerald-700"
                : "bg-amber-50 text-amber-700"
            }`}
          >
            {venta.tipo_venta === "CONTADO" ? "Contado" : `Crédito ${venta.plazo_dias ?? ""} días`}
          </span>
          {venta.metodo_pago && (
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">
              {METODO[venta.metodo_pago] ?? venta.metodo_pago}
            </span>
          )}
          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">
            {venta.items.length} {venta.items.length === 1 ? "ítem" : "ítems"} · {miles(unidades)}{" "}
            {unidades === 1 ? "unidad" : "unidades"}
          </span>
        </div>

        {/* ── Cliente y vehículo ───────────────────────────────────────── */}
        {(venta.cliente_nombre || autos.length > 0) && (
          <div className="grid gap-px border-b border-slate-100 bg-slate-100 sm:grid-cols-2">
            <div className="flex items-start gap-2.5 bg-white px-5 py-3 sm:px-6">
              <User className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
              <div className="min-w-0">
                <p className="text-[11px] uppercase tracking-wide text-slate-400">Cliente</p>
                <p className="truncate text-sm font-medium text-slate-800">
                  {venta.cliente_nombre ?? "Sin cliente"}
                </p>
              </div>
            </div>
            <div className="flex items-start gap-2.5 bg-white px-5 py-3 sm:px-6">
              <Car className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
              <div className="min-w-0">
                <p className="text-[11px] uppercase tracking-wide text-slate-400">
                  {autos.length > 1 ? `Vehículos (${autos.length})` : "Vehículo"}
                </p>
                {autos.length ? (
                  autos.map((a) => (
                    <div key={a.vehiculo_id} className="mt-0.5 first:mt-0">
                      <Link
                        href={`/vehiculos/${a.vehiculo_id}`}
                        className="font-mono text-sm font-semibold uppercase text-[#3F8E91] hover:underline"
                      >
                        {a.patente}
                      </Link>
                      <span className="ml-2 text-xs text-slate-500">
                        {a.descripcion ?? "Sin marca ni modelo"}
                        {a.km_registrado != null && ` · ${miles(a.km_registrado)} km`}
                      </span>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-slate-400">Sin vehículo</p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── Lo que se vendió ─────────────────────────────────────────── */}
        <div className="min-h-0 flex-1 overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-5 py-2.5 text-left font-medium sm:px-6">Producto</th>
                <th className="px-2 py-2.5 text-center font-medium">Cant.</th>
                <th className="px-2 py-2.5 text-right font-medium">P. unit.</th>
                <th className="px-5 py-2.5 text-right font-medium sm:px-6">Total</th>
              </tr>
            </thead>
            {grupos.map((g, gi) => (
            <tbody key={gi} className="divide-y divide-slate-100">
              {g.titulo && (
                <tr>
                  <td colSpan={4} className="bg-[#4FAEB2]/[0.07] px-5 py-2 sm:px-6">
                    <span className="font-mono text-xs font-bold uppercase tracking-wide text-[#3F8E91]">
                      {g.titulo}
                    </span>
                    {g.subtitulo && (
                      <span className="ml-2 text-[11px] text-slate-500">{g.subtitulo}</span>
                    )}
                  </td>
                </tr>
              )}
              {g.lineas.map((i, k) => (
                <tr key={k} className="align-top">
                  <td className="px-5 py-3 sm:px-6">
                    <p className="font-medium leading-snug text-slate-800">{i.producto_nombre}</p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-slate-400">
                      {i.sku && <span className="font-mono">{i.sku}</span>}
                      <span>IVA {i.tipo_iva === "EXENTA" ? "exenta" : i.tipo_iva}</span>
                    </p>
                  </td>
                  <td className="px-2 py-3 text-center tabular-nums text-slate-700">{i.cantidad}</td>
                  <td className="px-2 py-3 text-right tabular-nums text-slate-600">
                    {miles(i.precio_venta)}
                  </td>
                  <td className="px-5 py-3 text-right font-semibold tabular-nums text-slate-900 sm:px-6">
                    {miles(i.total_linea)}
                  </td>
                </tr>
              ))}
            </tbody>
            ))}
          </table>

          {venta.observaciones && (
            <div className="mx-5 my-4 rounded-lg bg-amber-50/70 px-3 py-2 sm:mx-6">
              <p className="text-[11px] uppercase tracking-wide text-amber-700/70">Observaciones</p>
              <p className="mt-0.5 whitespace-pre-line text-sm text-amber-900">{venta.observaciones}</p>
            </div>
          )}
        </div>

        {/* ── Totales ──────────────────────────────────────────────────── */}
        <div className="border-t border-slate-200 bg-slate-50 px-5 py-4 sm:px-6">
          <div className="ml-auto max-w-xs space-y-1.5">
            <div className="flex justify-between text-sm text-slate-600">
              <span>Subtotal</span>
              <span className="tabular-nums">{gs(venta.subtotal)}</span>
            </div>
            {[...porIva.entries()]
              .filter(([, monto]) => monto > 0)
              .map(([tasa, monto]) => (
                <div key={tasa} className="flex justify-between text-sm text-slate-600">
                  <span>IVA {tasa}</span>
                  <span className="tabular-nums">{gs(monto)}</span>
                </div>
              ))}
            <div className="flex justify-between border-t border-slate-300 pt-2 text-base font-bold text-slate-900">
              <span>TOTAL</span>
              <span className="tabular-nums">{gs(venta.total)}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
