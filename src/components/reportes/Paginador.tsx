"use client";

/**
 * Controles de paginado de los reportes.
 *
 * Se extrajo del reporte de rotacion ABC, que ya paginaba, para que todos los
 * reportes se vean y se manejen igual. Dos paginados distintos en el mismo
 * sistema obligan al usuario a aprender dos veces lo mismo.
 *
 * Es solo presentacion: quien lo usa decide si la pagina se resuelve en el
 * cliente (`usePaginacion`) o pidiendosela al servidor.
 */

import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";

export const TAMANOS_PAGINA = [25, 50, 100, 200] as const;

const BTN =
  "rounded-md border border-slate-200 p-1.5 text-slate-500 transition-colors hover:bg-slate-50 disabled:opacity-40 disabled:hover:bg-transparent";

export default function Paginador({
  pagina,
  totalPaginas,
  total,
  desde,
  hasta,
  tamano,
  onPagina,
  onTamano,
  etiqueta = "registros",
}: {
  pagina: number;
  totalPaginas: number;
  total: number;
  /** Numero de la primera fila visible (1-indexado). */
  desde: number;
  hasta: number;
  tamano: number;
  onPagina: (p: number) => void;
  onTamano: (n: number) => void;
  /** Como llamar a lo que se lista: "productos", "ventas". */
  etiqueta?: string;
}) {
  // Con una sola pagina los controles no aportan: solo el conteo.
  const unaSola = totalPaginas <= 1;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-3 py-2.5">
      <div className="flex items-center gap-2 text-xs text-slate-500">
        <span className="tabular-nums">
          {total === 0
            ? `Sin ${etiqueta}`
            : `${desde.toLocaleString("es-PY")}–${hasta.toLocaleString("es-PY")} de ${total.toLocaleString("es-PY")} ${etiqueta}`}
        </span>
        {!unaSola && (
          <>
            <span className="text-slate-300">·</span>
            <label className="flex items-center gap-1.5">
              <span>Ver</span>
              <select
                value={tamano}
                onChange={(e) => onTamano(Number(e.target.value))}
                className="rounded-md border border-slate-200 bg-white px-1.5 py-1 text-xs text-slate-700 outline-none focus:border-[#4FAEB2]"
                aria-label={`Cantidad de ${etiqueta} por página`}
              >
                {TAMANOS_PAGINA.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}
      </div>

      {!unaSola && (
        <div className="flex items-center gap-2">
          <span className="text-xs tabular-nums text-slate-500">
            Página {pagina} de {totalPaginas}
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => onPagina(1)}
              disabled={pagina <= 1}
              className={BTN}
              aria-label="Primera página"
            >
              <ChevronsLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => onPagina(pagina - 1)}
              disabled={pagina <= 1}
              className={BTN}
              aria-label="Página anterior"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => onPagina(pagina + 1)}
              disabled={pagina >= totalPaginas}
              className={BTN}
              aria-label="Página siguiente"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => onPagina(totalPaginas)}
              disabled={pagina >= totalPaginas}
              className={BTN}
              aria-label="Última página"
            >
              <ChevronsRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
