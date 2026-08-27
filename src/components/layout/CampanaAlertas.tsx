"use client";

/**
 * Campanita de alertas.
 *
 * Antes mostraba un "0" escrito a mano y no hacia nada. Ahora trae lo que
 * necesita atencion: por ahora, productos que cayeron por debajo de su minimo.
 *
 * El numero y el detalle salen del mismo pedido, asi no pueden discrepar.
 * Se refresca solo cada 5 minutos y al volver a la pestana: una venta baja el
 * stock, y el cajero no deberia tener que recargar para enterarse.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Bell, Loader2, PackageX } from "lucide-react";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";

type Alerta = {
  tipo: string;
  nivel: "critico" | "aviso";
  producto_id: string;
  titulo: string;
  detalle: string;
  href: string;
};

/** Cada cuanto se vuelve a preguntar. Cinco minutos: el stock no cambia solo. */
const REFRESCO_MS = 5 * 60 * 1000;

export default function CampanaAlertas() {
  const [abierto, setAbierto] = useState(false);
  const [cargando, setCargando] = useState(true);
  const [total, setTotal] = useState(0);
  const [criticos, setCriticos] = useState(0);
  const [alertas, setAlertas] = useState<Alerta[]>([]);
  const panelRef = useRef<HTMLDivElement>(null);

  const cargar = useCallback(async () => {
    try {
      const res = await fetchWithSupabaseSession("/api/alertas", { cache: "no-store" });
      const j = await res.json();
      if (!res.ok || !j?.success) return;
      setTotal(Number(j.data?.total ?? 0));
      setCriticos(Number(j.data?.criticos ?? 0));
      setAlertas((j.data?.alertas ?? []) as Alerta[]);
    } catch {
      // Sin alertas la campanita queda en cero. No es motivo para romper el
      // encabezado de toda la aplicacion.
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    void cargar();
    const t = setInterval(() => void cargar(), REFRESCO_MS);
    // Al volver a la pestaña se refresca: si estuvo cinco minutos en otra, el
    // numero que ve al volver ya es viejo.
    const onVisible = () => {
      if (document.visibilityState === "visible") void cargar();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [cargar]);

  // Cerrar al hacer clic fuera.
  useEffect(() => {
    if (!abierto) return;
    function fuera(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setAbierto(false);
    }
    document.addEventListener("mousedown", fuera);
    return () => document.removeEventListener("mousedown", fuera);
  }, [abierto]);

  const hay = total > 0;

  return (
    <div className="relative" ref={panelRef}>
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        className="relative rounded-lg p-2 text-slate-500 transition-colors hover:bg-slate-50 hover:text-[#3F8E91]"
        aria-label={hay ? `${total} alertas de reposición` : "Sin alertas"}
        aria-expanded={abierto}
      >
        <Bell className="h-5 w-5" />
        <span
          className={`absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-bold text-white ${
            // Rojo solo si hay algo en cero: si todo es "va faltando", el rojo
            // pierde significado y se deja de mirar.
            criticos > 0 ? "bg-red-600" : hay ? "bg-[#4FAEB2]" : "bg-slate-300"
          }`}
        >
          {cargando ? "…" : total > 99 ? "99+" : total}
        </span>
      </button>

      {abierto && (
        <div className="absolute right-0 top-full z-50 mt-2 w-80 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_16px_40px_-12px_rgba(15,23,42,0.28)]">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <p className="text-sm font-semibold text-slate-800">Reposición</p>
            {hay && (
              <span className="text-[11px] text-slate-400">
                {total} {total === 1 ? "producto" : "productos"}
              </span>
            )}
          </div>

          {cargando ? (
            <p className="flex items-center justify-center gap-2 py-8 text-sm text-slate-400">
              <Loader2 className="h-4 w-4 animate-spin" />
              Cargando…
            </p>
          ) : !hay ? (
            <p className="py-8 text-center text-sm text-slate-400">
              Ningún producto está por debajo de su mínimo.
            </p>
          ) : (
            <>
              <ul className="max-h-80 divide-y divide-slate-100 overflow-y-auto">
                {alertas.map((a) => (
                  <li key={a.producto_id}>
                    <Link
                      href={a.href}
                      onClick={() => setAbierto(false)}
                      className="flex items-start gap-2.5 px-4 py-2.5 transition-colors hover:bg-slate-50"
                    >
                      {a.nivel === "critico" ? (
                        <PackageX className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
                      ) : (
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                      )}
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-slate-800">{a.titulo}</p>
                        <p
                          className={`text-[11px] ${
                            a.nivel === "critico" ? "font-semibold text-red-600" : "text-slate-500"
                          }`}
                        >
                          {a.detalle}
                        </p>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
              <Link
                href="/reportes/stock-minimo"
                onClick={() => setAbierto(false)}
                className="block border-t border-slate-100 bg-slate-50 px-4 py-2.5 text-center text-xs font-semibold text-[#3F8E91] transition-colors hover:bg-slate-100"
              >
                {total > alertas.length
                  ? `Ver los ${total} en el reporte`
                  : "Ver el reporte de stock mínimo"}
              </Link>
            </>
          )}
        </div>
      )}
    </div>
  );
}
