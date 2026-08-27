"use client";

/**
 * Servicios del lubricentro.
 *
 * Todo lo que define un servicio en una sola pantalla: la mano de obra, los
 * productos que consume, el precio y cada cuanto se repite. Antes esto vivia en
 * tres lugares (Inventario, Recetas, intervalos) y por eso quedaba a medias.
 *
 * El costo NO se calcula aca: lo devuelve el servidor a partir de la receta,
 * que resuelve conversion de unidades y merma. La pantalla solo lo muestra.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import PageHeader from "@/components/ui/PageHeader";
import { AlertTriangle, Loader2, Plus, Search, Trash2, Wrench, X } from "lucide-react";
import {
  crearServicio,
  darDeBajaServicio,
  getServicios,
  guardarServicio,
  type Servicio,
  type ServicioForm,
} from "@/lib/servicios/storage";
import { getProductos } from "@/lib/inventario/storage";
import type { Producto } from "@/lib/inventario/types";

const gs = (v: number) => `Gs. ${Math.round(v).toLocaleString("es-PY")}`;
const INPUT =
  "w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none transition-colors focus:border-[#4FAEB2]";
const LABEL = "mb-1 block text-xs font-medium text-slate-600";

type FilaInsumo = {
  insumo_producto_id: string;
  cantidad: string;
  unidad_medida: string;
  /** En PORCENTAJE en la pantalla; la API lo convierte a fraccion. */
  merma_pct: string;
};

type Form = {
  nombre: string;
  mano_obra: string;
  /** "manual" = el precio lo escribe el usuario; "margen" = se calcula. */
  modo_precio: "manual" | "margen";
  precio_venta: string;
  margen_pct: string;
  intervalo_km: string;
  intervalo_meses: string;
  insumos: FilaInsumo[];
};

const FORM_VACIO: Form = {
  nombre: "",
  mano_obra: "",
  modo_precio: "manual",
  precio_venta: "",
  margen_pct: "40",
  intervalo_km: "",
  intervalo_meses: "",
  insumos: [],
};

function desdeServicio(s: Servicio): Form {
  return {
    nombre: s.nombre,
    mano_obra: s.mano_obra ? String(s.mano_obra) : "",
    modo_precio: s.margen_pct == null ? "manual" : "margen",
    precio_venta: s.precio_venta ? String(s.precio_venta) : "",
    margen_pct: s.margen_pct != null ? String(s.margen_pct) : "40",
    intervalo_km: s.intervalo_km != null ? String(s.intervalo_km) : "",
    intervalo_meses: s.intervalo_meses != null ? String(s.intervalo_meses) : "",
    insumos: s.insumos.map((i) => ({
      insumo_producto_id: i.insumo_producto_id,
      cantidad: String(i.cantidad),
      unidad_medida: i.unidad_medida ?? "",
      // De fraccion a porcentaje para mostrarlo.
      merma_pct: i.merma_pct ? String(Math.round(i.merma_pct * 10000) / 100) : "",
    })),
  };
}

export default function ServiciosPage() {
  const [servicios, setServicios] = useState<Servicio[]>([]);
  const [productos, setProductos] = useState<Producto[]>([]);
  const [cargando, setCargando] = useState(true);
  const [editando, setEditando] = useState<string | "nuevo" | null>(null);
  const [form, setForm] = useState<Form>(FORM_VACIO);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmarBaja, setConfirmarBaja] = useState<string | null>(null);
  const [buscaInsumo, setBuscaInsumo] = useState("");

  const cargar = useCallback(async () => {
    const [s, p] = await Promise.all([getServicios(), getProductos()]);
    setServicios(s);
    // Un servicio no puede ser insumo de otro: se consumen productos.
    setProductos(p.filter((x) => x.tipo_producto !== "servicio"));
    setCargando(false);
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const porId = useMemo(() => new Map(productos.map((p) => [p.id, p])), [productos]);

  /**
   * Costo estimado mientras se edita. Es una PREVISUALIZACION: el numero firme
   * lo calcula el servidor al guardar, con la conversion de unidades. Acá se
   * asume que la unidad escrita es la del producto, que es el caso normal.
   */
  const costoEstimado = useMemo(() => {
    const insumos = form.insumos.reduce((sum, f) => {
      const p = porId.get(f.insumo_producto_id);
      if (!p) return sum;
      const cant = Number(f.cantidad) || 0;
      const merma = (Number(f.merma_pct) || 0) / 100;
      return sum + cant * (1 + merma) * (p.costo_promedio ?? 0);
    }, 0);
    return (Number(form.mano_obra) || 0) + insumos;
  }, [form, porId]);

  const precioPrevisto =
    form.modo_precio === "margen"
      ? Math.round(costoEstimado * (1 + (Number(form.margen_pct) || 0) / 100))
      : Number(form.precio_venta) || 0;

  const insumosFiltrados = useMemo(() => {
    const q = buscaInsumo.trim().toLowerCase();
    const yaEstan = new Set(form.insumos.map((i) => i.insumo_producto_id));
    return productos
      .filter((p) => !yaEstan.has(p.id))
      .filter((p) => !q || p.nombre.toLowerCase().includes(q) || (p.sku ?? "").toLowerCase().includes(q))
      .slice(0, 8);
  }, [productos, buscaInsumo, form.insumos]);

  function abrirNuevo() {
    setForm(FORM_VACIO);
    setEditando("nuevo");
    setError(null);
    setBuscaInsumo("");
  }

  function abrirEdicion(s: Servicio) {
    setForm(desdeServicio(s));
    setEditando(s.id);
    setError(null);
    setBuscaInsumo("");
  }

  function agregarInsumo(p: Producto) {
    setForm((f) => ({
      ...f,
      insumos: [
        ...f.insumos,
        {
          insumo_producto_id: p.id,
          cantidad: "1",
          unidad_medida: p.unidad_medida ?? "UNIDAD",
          merma_pct: "",
        },
      ],
    }));
    setBuscaInsumo("");
  }

  async function guardar() {
    if (!form.nombre.trim()) {
      setError("Poné un nombre al servicio.");
      return;
    }
    const payload: ServicioForm = {
      nombre: form.nombre.trim(),
      mano_obra: Number(form.mano_obra) || 0,
      margen_pct: form.modo_precio === "margen" ? Number(form.margen_pct) || 0 : null,
      // Con margen el precio lo calcula el servidor; se manda el previsto para
      // que quede algo coherente guardado si despues se pasa a modo manual.
      precio_venta: precioPrevisto,
      intervalo_km: form.intervalo_km ? Number(form.intervalo_km) : null,
      intervalo_meses: form.intervalo_meses ? Number(form.intervalo_meses) : null,
      insumos: form.insumos
        .filter((i) => Number(i.cantidad) > 0)
        .map((i) => ({
          insumo_producto_id: i.insumo_producto_id,
          cantidad: Number(i.cantidad),
          unidad_medida: i.unidad_medida || null,
          merma_pct: Number(i.merma_pct) || 0,
        })),
    };

    setGuardando(true);
    setError(null);
    const r =
      editando === "nuevo" ? await crearServicio(payload) : await guardarServicio(editando!, payload);
    setGuardando(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setEditando(null);
    void cargar();
  }

  async function darDeBaja(id: string) {
    setGuardando(true);
    const ok = await darDeBajaServicio(id);
    setGuardando(false);
    setConfirmarBaja(null);
    if (ok) void cargar();
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Zentra · Taller"
        title="Servicios"
        description="Qué hace cada servicio, qué consume y cuánto deja."
        actions={
          <button
            type="button"
            onClick={abrirNuevo}
            className="inline-flex items-center gap-2 rounded-xl bg-[#4FAEB2] px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[#3F8E91]"
          >
            <Plus className="h-4 w-4" />
            Nuevo servicio
          </button>
        }
      />

      {cargando ? (
        <p className="py-16 text-center text-sm text-slate-400">Cargando servicios…</p>
      ) : servicios.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-slate-200 py-16 text-center">
          <Wrench className="mx-auto h-8 w-8 text-slate-300" />
          <p className="mt-3 text-sm font-medium text-slate-600">Todavía no hay servicios.</p>
          <p className="mx-auto mt-1 max-w-md text-xs text-slate-400">
            Un servicio junta la mano de obra y los productos que consume. Al venderlo, el stock de
            esos productos baja solo, y su intervalo dispara el aviso del próximo mantenimiento.
          </p>
        </div>
      ) : (
        <div className="grid gap-3">
          {servicios.map((s) => (
            <div
              key={s.id}
              className={`rounded-xl border bg-white p-4 shadow-sm transition-colors ${
                s.activo ? "border-slate-200" : "border-slate-200 opacity-60"
              }`}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-bold text-slate-900">{s.nombre}</h3>
                    {!s.activo && (
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500">
                        De baja
                      </span>
                    )}
                    {s.margen_pct != null && (
                      <span className="rounded-full bg-[#4FAEB2]/10 px-2 py-0.5 text-[10px] font-semibold text-[#3F8E91]">
                        precio por margen {s.margen_pct}%
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    {s.insumos.length === 0
                      ? "Sin insumos cargados"
                      : s.insumos
                          .map((i) => `${i.cantidad}${i.unidad_medida ? " " + i.unidad_medida : ""} ${i.insumo_nombre}`)
                          .join(" · ")}
                  </p>
                  <p className="mt-1 text-[11px] text-slate-400">
                    {s.intervalo_km || s.intervalo_meses ? (
                      <>
                        Se repite cada{" "}
                        {[
                          s.intervalo_km ? `${s.intervalo_km.toLocaleString("es-PY")} km` : null,
                          s.intervalo_meses ? `${s.intervalo_meses} meses` : null,
                        ]
                          .filter(Boolean)
                          .join(" o ")}
                      </>
                    ) : (
                      <span className="text-amber-600">Sin intervalo: no genera aviso de mantenimiento</span>
                    )}
                    {s.unidades_posibles != null && (
                      <> · alcanza para {s.unidades_posibles} con el stock actual</>
                    )}
                  </p>
                  {s.tiene_unidad_incompatible && (
                    <p className="mt-1 flex items-center gap-1 text-[11px] font-medium text-red-600">
                      <AlertTriangle className="h-3 w-3" />
                      Un insumo tiene una unidad que no se puede convertir: no se costea ni se descuenta.
                    </p>
                  )}
                </div>

                <div className="flex shrink-0 items-center gap-4">
                  <div className="text-right">
                    <p className="text-base font-bold tabular-nums text-slate-900">{gs(s.precio_venta)}</p>
                    <p className="text-[11px] text-slate-500">
                      costo {gs(s.costo_total)}
                      {s.margen_real != null && (
                        <span className={s.margen_real >= 0 ? " text-emerald-600" : " text-red-600"}>
                          {" "}
                          · {s.margen_real}%
                        </span>
                      )}
                    </p>
                  </div>
                  <div className="flex flex-col gap-1">
                    <button
                      type="button"
                      onClick={() => abrirEdicion(s)}
                      className="rounded-lg border border-slate-200 px-3 py-1 text-xs font-medium text-slate-600 hover:border-[#4FAEB2] hover:text-[#3F8E91]"
                    >
                      Editar
                    </button>
                    {s.activo &&
                      (confirmarBaja === s.id ? (
                        <button
                          type="button"
                          onClick={() => darDeBaja(s.id)}
                          disabled={guardando}
                          className="rounded-lg bg-red-600 px-3 py-1 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-60"
                        >
                          Confirmar
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirmarBaja(s.id)}
                          className="rounded-lg border border-slate-200 px-3 py-1 text-xs text-slate-500 hover:border-red-300 hover:text-red-600"
                        >
                          Dar de baja
                        </button>
                      ))}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Editor ────────────────────────────────────────────────────────── */}
      {editando && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-slate-900/40 p-4 pt-[6vh] backdrop-blur-[2px]"
          onClick={() => setEditando(null)}
          role="presentation"
        >
          <div
            className="flex max-h-[86vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <h2 className="text-base font-bold text-slate-900">
                {editando === "nuevo" ? "Nuevo servicio" : "Editar servicio"}
              </h2>
              <button
                type="button"
                onClick={() => setEditando(null)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100"
                aria-label="Cerrar"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
              <div>
                <label className={LABEL}>Nombre del servicio</label>
                <input
                  autoFocus
                  value={form.nombre}
                  onChange={(e) => setForm({ ...form, nombre: e.target.value })}
                  placeholder="Ej: Cambio de aceite"
                  className={INPUT}
                />
              </div>

              {/* ── Insumos ─────────────────────────────────────────────── */}
              <div className="rounded-xl border border-slate-200 p-3">
                <p className="mb-2 text-xs font-semibold text-slate-700">Productos que consume</p>

                {form.insumos.length > 0 && (
                  <div className="mb-3 space-y-2">
                    {form.insumos.map((fi, idx) => {
                      const p = porId.get(fi.insumo_producto_id);
                      return (
                        <div key={fi.insumo_producto_id} className="flex items-center gap-2">
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm text-slate-800">{p?.nombre ?? "—"}</p>
                            <p className="text-[11px] text-slate-400">
                              {p ? `${gs(p.costo_promedio ?? 0)} por ${p.unidad_medida ?? "UNIDAD"}` : ""}
                            </p>
                          </div>
                          <input
                            type="number"
                            min={0}
                            step="0.01"
                            value={fi.cantidad}
                            onChange={(e) =>
                              setForm((f) => ({
                                ...f,
                                insumos: f.insumos.map((x, i) =>
                                  i === idx ? { ...x, cantidad: e.target.value } : x
                                ),
                              }))
                            }
                            className="h-9 w-20 rounded-lg border border-slate-200 px-2 text-right text-sm tabular-nums"
                            placeholder="Cant."
                          />
                          <input
                            value={fi.unidad_medida}
                            onChange={(e) =>
                              setForm((f) => ({
                                ...f,
                                insumos: f.insumos.map((x, i) =>
                                  i === idx ? { ...x, unidad_medida: e.target.value.toUpperCase() } : x
                                ),
                              }))
                            }
                            className="h-9 w-20 rounded-lg border border-slate-200 px-2 text-center text-xs uppercase"
                            placeholder="Unidad"
                          />
                          <input
                            type="number"
                            min={0}
                            max={99}
                            value={fi.merma_pct}
                            onChange={(e) =>
                              setForm((f) => ({
                                ...f,
                                insumos: f.insumos.map((x, i) =>
                                  i === idx ? { ...x, merma_pct: e.target.value } : x
                                ),
                              }))
                            }
                            className="h-9 w-16 rounded-lg border border-slate-200 px-2 text-right text-xs tabular-nums"
                            placeholder="% merma"
                            title="Cuánto se pierde al usarlo (derrame, resto en el envase)"
                          />
                          <button
                            type="button"
                            onClick={() =>
                              setForm((f) => ({ ...f, insumos: f.insumos.filter((_, i) => i !== idx) }))
                            }
                            className="rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-600"
                            aria-label="Quitar insumo"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}

                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    value={buscaInsumo}
                    onChange={(e) => setBuscaInsumo(e.target.value)}
                    placeholder="Buscar un producto para agregar…"
                    className={`${INPUT} pl-9`}
                  />
                  {buscaInsumo.trim() && (
                    <ul className="absolute left-0 right-0 top-full z-20 mt-1 max-h-52 overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-lg">
                      {insumosFiltrados.length === 0 ? (
                        <li className="px-3 py-2 text-xs text-slate-400">Sin resultados.</li>
                      ) : (
                        insumosFiltrados.map((p) => (
                          <li key={p.id}>
                            <button
                              type="button"
                              onClick={() => agregarInsumo(p)}
                              className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-slate-50"
                            >
                              <span className="min-w-0">
                                <span className="block truncate text-sm text-slate-800">{p.nombre}</span>
                                <span className="text-[11px] text-slate-400">
                                  {p.sku} · {gs(p.costo_promedio ?? 0)} por {p.unidad_medida ?? "UNIDAD"}
                                </span>
                              </span>
                              <Plus className="h-4 w-4 shrink-0 text-[#3F8E91]" />
                            </button>
                          </li>
                        ))
                      )}
                    </ul>
                  )}
                </div>
              </div>

              {/* ── Costo y precio ──────────────────────────────────────── */}
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className={LABEL}>Mano de obra (Gs.)</label>
                  <input
                    type="number"
                    min={0}
                    value={form.mano_obra}
                    onChange={(e) => setForm({ ...form, mano_obra: e.target.value })}
                    placeholder="0"
                    className={INPUT}
                  />
                  <p className="mt-1 text-[11px] text-slate-400">El trabajo, sin contar materiales.</p>
                </div>
                <div>
                  <label className={LABEL}>Precio de venta</label>
                  <div className="mb-2 inline-flex overflow-hidden rounded-lg border border-slate-200">
                    {(["manual", "margen"] as const).map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setForm({ ...form, modo_precio: m })}
                        className={`px-3 py-1.5 text-[11px] font-semibold transition-colors ${
                          form.modo_precio === m ? "bg-[#4FAEB2] text-white" : "bg-white text-slate-600"
                        }`}
                      >
                        {m === "manual" ? "Lo pongo yo" : "Costo + %"}
                      </button>
                    ))}
                  </div>
                  {form.modo_precio === "manual" ? (
                    <input
                      type="number"
                      min={0}
                      value={form.precio_venta}
                      onChange={(e) => setForm({ ...form, precio_venta: e.target.value })}
                      placeholder="0"
                      className={INPUT}
                    />
                  ) : (
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min={0}
                        max={1000}
                        value={form.margen_pct}
                        onChange={(e) => setForm({ ...form, margen_pct: e.target.value })}
                        className={`${INPUT} w-24`}
                      />
                      <span className="text-sm text-slate-500">% de ganancia</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Cuenta a la vista: si el margen queda flaco, se ve antes de guardar. */}
              <div className="rounded-xl bg-slate-50 p-3">
                <div className="flex justify-between text-xs text-slate-500">
                  <span>Costo estimado (mano de obra + insumos)</span>
                  <span className="tabular-nums">{gs(costoEstimado)}</span>
                </div>
                <div className="mt-1 flex justify-between text-sm font-bold">
                  <span className="text-slate-700">Precio</span>
                  <span className="tabular-nums text-slate-900">{gs(precioPrevisto)}</span>
                </div>
                <div className="mt-1 flex justify-between text-xs">
                  <span className="text-slate-500">Ganancia</span>
                  <span
                    className={`tabular-nums font-semibold ${
                      precioPrevisto - costoEstimado >= 0 ? "text-emerald-600" : "text-red-600"
                    }`}
                  >
                    {gs(precioPrevisto - costoEstimado)}
                    {precioPrevisto > 0 &&
                      ` · ${Math.round(((precioPrevisto - costoEstimado) / precioPrevisto) * 100)}%`}
                  </span>
                </div>
                <p className="mt-1.5 text-[11px] text-slate-400">
                  Estimado: el costo firme lo calcula el sistema al guardar, convirtiendo las unidades.
                </p>
              </div>

              {/* ── Intervalo ───────────────────────────────────────────── */}
              <div className="rounded-xl border border-[#4FAEB2]/30 bg-[#4FAEB2]/5 p-3">
                <p className="text-xs font-semibold text-slate-700">Cada cuánto se repite</p>
                <p className="mt-0.5 text-[11px] text-slate-500">
                  Con esto el sistema avisa a qué vehículos les toca. Vence por lo que ocurra primero.
                  Vacío = no genera aviso.
                </p>
                <div className="mt-2 grid grid-cols-2 gap-3">
                  <div>
                    <label className={LABEL}>Cada cuántos km</label>
                    <input
                      type="number"
                      min={1}
                      value={form.intervalo_km}
                      onChange={(e) => setForm({ ...form, intervalo_km: e.target.value })}
                      placeholder="5000"
                      className={INPUT}
                    />
                  </div>
                  <div>
                    <label className={LABEL}>Cada cuántos meses</label>
                    <input
                      type="number"
                      min={1}
                      max={120}
                      value={form.intervalo_meses}
                      onChange={(e) => setForm({ ...form, intervalo_meses: e.target.value })}
                      placeholder="6"
                      className={INPUT}
                    />
                  </div>
                </div>
              </div>

              {error && (
                <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  {error}
                </p>
              )}
            </div>

            <div className="flex gap-2 border-t border-slate-200 px-5 py-4">
              <button
                type="button"
                onClick={guardar}
                disabled={guardando}
                className="inline-flex items-center gap-2 rounded-xl bg-[#4FAEB2] px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#3F8E91] disabled:opacity-60"
              >
                {guardando && <Loader2 className="h-4 w-4 animate-spin" />}
                Guardar servicio
              </button>
              <button
                type="button"
                onClick={() => setEditando(null)}
                className="rounded-xl border border-slate-200 px-5 py-2.5 text-sm text-slate-600 hover:bg-slate-50"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
