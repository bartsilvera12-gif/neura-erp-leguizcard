"use client";

/**
 * Servicios del lubricentro.
 *
 * Todo lo que define un servicio en una sola pantalla: la mano de obra, los
 * productos que consume, el precio y cada cuanto se repite. Antes esto vivia en
 * tres lugares (Inventario, Recetas, intervalos) y por eso quedaba a medias.
 *
 * El costo firme NO se calcula aca: lo devuelve el servidor a partir de la
 * receta. La cuenta que se ve mientras se edita usa la misma tabla de unidades
 * (`@/lib/servicios/unidades`) para que las dos digan lo mismo.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import PageHeader from "@/components/ui/PageHeader";
import {
  AlertTriangle,
  Boxes,
  Loader2,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Trash2,
  Wrench,
  X,
} from "lucide-react";
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
import {
  cantidadEnUnidadDelProducto,
  normalizar,
  unidadesCompatibles,
} from "@/lib/servicios/unidades";

const gs = (v: number) => `Gs. ${Math.round(v).toLocaleString("es-PY")}`;
const nro = (v: number) => v.toLocaleString("es-PY");

const INPUT =
  "w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition-colors placeholder:text-slate-300 focus:border-[#4FAEB2] focus:ring-2 focus:ring-[#4FAEB2]/15";
const LABEL = "mb-1 block text-xs font-medium text-slate-600";
const CELDA =
  "h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm text-slate-800 outline-none transition-colors focus:border-[#4FAEB2] focus:ring-2 focus:ring-[#4FAEB2]/15";

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

/** Cada cuánto se repite, en palabras. `null` = no genera aviso. */
function textoIntervalo(km: number | null, meses: number | null): string | null {
  const partes = [
    km ? `${nro(km)} km` : null,
    meses ? (meses === 1 ? "1 mes" : `${meses} meses`) : null,
  ].filter(Boolean);
  return partes.length ? `Cada ${partes.join(" o ")}` : null;
}

/** Etiqueta pequeña y neutra: dato al costado, no adorno. */
function Chip({
  children,
  tono = "gris",
  icono,
}: {
  children: React.ReactNode;
  tono?: "gris" | "teal" | "ambar" | "rojo";
  icono?: React.ReactNode;
}) {
  const tonos = {
    gris: "bg-slate-100 text-slate-600",
    teal: "bg-[#4FAEB2]/10 text-[#357C80]",
    ambar: "bg-amber-50 text-amber-700",
    rojo: "bg-red-50 text-red-700",
  } as const;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${tonos[tono]}`}
    >
      {icono}
      {children}
    </span>
  );
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
  const [busqueda, setBusqueda] = useState("");
  const [verDeBaja, setVerDeBaja] = useState(false);

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

  const bajas = useMemo(() => servicios.filter((s) => !s.activo).length, [servicios]);

  const visibles = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return servicios
      .filter((s) => verDeBaja || s.activo)
      .filter(
        (s) =>
          !q ||
          s.nombre.toLowerCase().includes(q) ||
          s.insumos.some((i) => i.insumo_nombre.toLowerCase().includes(q))
      );
  }, [servicios, busqueda, verDeBaja]);

  /**
   * Costo estimado mientras se edita. Es una PREVISUALIZACION: el numero firme
   * lo calcula el servidor al guardar. Convierte las unidades igual que él, así
   * que 7,5 L de un aceite que se compra por galón cuestan lo que cuestan.
   */
  const estimado = useMemo(() => {
    let insumos = 0;
    let incompatible = false;
    for (const f of form.insumos) {
      const p = porId.get(f.insumo_producto_id);
      if (!p) continue;
      const cant = cantidadEnUnidadDelProducto(
        Number(f.cantidad) || 0,
        f.unidad_medida,
        p.unidad_medida
      );
      if (cant == null) {
        incompatible = true;
        continue;
      }
      const merma = (Number(f.merma_pct) || 0) / 100;
      insumos += cant * (1 + merma) * (p.costo_promedio ?? 0);
    }
    const manoObra = Number(form.mano_obra) || 0;
    return { costo: manoObra + insumos, insumos, manoObra, incompatible };
  }, [form, porId]);

  const costoEstimado = estimado.costo;
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
          unidad_medida: normalizar(p.unidad_medida) || "UNIDAD",
          merma_pct: "",
        },
      ],
    }));
    setBuscaInsumo("");
  }

  function cambiarInsumo(idx: number, campo: keyof FilaInsumo, valor: string) {
    setForm((f) => ({
      ...f,
      insumos: f.insumos.map((x, i) => (i === idx ? { ...x, [campo]: valor } : x)),
    }));
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
    <div className="space-y-5">
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

      {/* ── Barra de busqueda ──────────────────────────────────────────────── */}
      {servicios.length > 0 && (
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-[240px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Buscar por servicio o por producto que consume…"
              className={`${INPUT} pl-9`}
            />
          </div>
          {bajas > 0 && (
            <button
              type="button"
              onClick={() => setVerDeBaja((v) => !v)}
              className={`rounded-xl border px-3 py-2 text-xs font-medium transition-colors ${
                verDeBaja
                  ? "border-[#4FAEB2] bg-[#4FAEB2]/10 text-[#357C80]"
                  : "border-slate-200 text-slate-500 hover:bg-slate-50"
              }`}
            >
              {verDeBaja ? "Ocultar los de baja" : `Ver ${bajas} de baja`}
            </button>
          )}
          <span className="text-xs tabular-nums text-slate-400">
            {visibles.length === servicios.length
              ? `${nro(servicios.length)} servicios`
              : `${nro(visibles.length)} de ${nro(servicios.length)}`}
          </span>
        </div>
      )}

      {cargando ? (
        <p className="py-16 text-center text-sm text-slate-400">Cargando servicios…</p>
      ) : servicios.length === 0 ? (
        <div className="rounded-2xl border-2 border-dashed border-slate-200 py-16 text-center">
          <Wrench className="mx-auto h-8 w-8 text-slate-300" />
          <p className="mt-3 text-sm font-medium text-slate-600">Todavía no hay servicios.</p>
          <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-slate-400">
            Un servicio junta la mano de obra y los productos que consume. Al venderlo, el stock de
            esos productos baja solo, y su intervalo dispara el aviso del próximo mantenimiento.
          </p>
        </div>
      ) : visibles.length === 0 ? (
        <p className="py-16 text-center text-sm text-slate-400">
          Ningún servicio coincide con “{busqueda.trim()}”.
        </p>
      ) : (
        <div className="space-y-3">
          {visibles.map((s) => {
            const intervalo = textoIntervalo(s.intervalo_km, s.intervalo_meses);
            return (
              <article
                key={s.id}
                className={`group rounded-2xl border bg-white shadow-sm transition-shadow hover:shadow-md ${
                  s.activo ? "border-slate-200" : "border-slate-200 bg-slate-50/60"
                }`}
              >
                {/* Grilla de tres columnas: el bloque de plata y los botones tienen
                    ancho propio, asi un nombre largo no los empuja abajo. */}
                <div className="grid gap-4 p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3
                        className={`text-sm font-bold ${s.activo ? "text-slate-900" : "text-slate-500"}`}
                      >
                        {s.nombre}
                      </h3>
                      {!s.activo && <Chip>De baja</Chip>}
                      {s.margen_pct != null && <Chip tono="teal">Precio = costo + {s.margen_pct}%</Chip>}
                    </div>

                    {/* Lo que consume, una pastilla por insumo. */}
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {s.insumos.length === 0 ? (
                        <Chip tono="ambar" icono={<AlertTriangle className="h-3 w-3" />}>
                          Sin insumos: no descuenta stock
                        </Chip>
                      ) : (
                        s.insumos.map((i) => (
                          <span
                            key={i.insumo_producto_id}
                            className="inline-flex max-w-full items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] text-slate-600"
                            title={i.insumo_nombre}
                          >
                            <span className="font-semibold tabular-nums text-slate-800">
                              {i.cantidad}
                              {i.unidad_medida ? ` ${i.unidad_medida}` : ""}
                            </span>
                            <span className="truncate">{i.insumo_nombre}</span>
                          </span>
                        ))
                      )}
                    </div>

                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      {intervalo ? (
                        <Chip icono={<RotateCcw className="h-3 w-3" />}>{intervalo}</Chip>
                      ) : (
                        <Chip tono="ambar" icono={<AlertTriangle className="h-3 w-3" />}>
                          Sin intervalo: no avisa el próximo mantenimiento
                        </Chip>
                      )}
                      {s.unidades_posibles != null && (
                        <Chip
                          tono={s.unidades_posibles === 0 ? "rojo" : "gris"}
                          icono={<Boxes className="h-3 w-3" />}
                        >
                          {s.unidades_posibles === 0
                            ? "Sin stock para hacerlo"
                            : `Alcanza para ${nro(s.unidades_posibles)}`}
                        </Chip>
                      )}
                      {s.tiene_unidad_incompatible && (
                        <Chip tono="rojo" icono={<AlertTriangle className="h-3 w-3" />}>
                          Unidad no convertible: no se costea ni se descuenta
                        </Chip>
                      )}
                    </div>
                  </div>

                  {/* Plata + acciones. */}
                  <div className="flex items-center gap-4 sm:justify-end">
                    <div className="text-right">
                      <p className="text-lg font-bold leading-none tabular-nums text-slate-900">
                        {gs(s.precio_venta)}
                      </p>
                      <p className="mt-1 text-[11px] tabular-nums text-slate-500">
                        costo {gs(s.costo_total)}
                      </p>
                      {s.margen_real != null && (
                        <span
                          className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums ${
                            s.margen_real >= 0
                              ? "bg-emerald-50 text-emerald-700"
                              : "bg-red-50 text-red-700"
                          }`}
                        >
                          {s.margen_real >= 0 ? "deja " : "pierde "}
                          {Math.abs(s.margen_real)}%
                        </span>
                      )}
                    </div>

                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        onClick={() => abrirEdicion(s)}
                        className="rounded-lg border border-slate-200 p-2 text-slate-500 transition-colors hover:border-[#4FAEB2] hover:text-[#357C80]"
                        title="Editar servicio"
                        aria-label={`Editar ${s.nombre}`}
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      {s.activo &&
                        (confirmarBaja === s.id ? (
                          <button
                            type="button"
                            onClick={() => darDeBaja(s.id)}
                            disabled={guardando}
                            className="rounded-lg bg-red-600 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-red-700 disabled:opacity-60"
                          >
                            Confirmar
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setConfirmarBaja(s.id)}
                            className="rounded-lg border border-slate-200 p-2 text-slate-400 transition-colors hover:border-red-300 hover:text-red-600"
                            title="Dar de baja"
                            aria-label={`Dar de baja ${s.nombre}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        ))}
                    </div>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {/* ── Editor ────────────────────────────────────────────────────────── */}
      {editando && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-slate-900/40 p-4 pt-[5vh] backdrop-blur-[2px]"
          onClick={() => setEditando(null)}
          role="presentation"
        >
          <div
            className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            {/* Cabecera */}
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-6 py-4">
              <div>
                <h2 className="text-base font-bold text-slate-900">
                  {editando === "nuevo" ? "Nuevo servicio" : "Editar servicio"}
                </h2>
                <p className="mt-0.5 text-xs text-slate-500">
                  Qué trabajo es, qué consume, a cuánto se vende y cada cuánto se repite.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setEditando(null)}
                className="shrink-0 rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
                aria-label="Cerrar"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-6 py-5">
              {/* 1 · Nombre */}
              <section>
                <label className={LABEL} htmlFor="svc-nombre">
                  Nombre del servicio
                </label>
                <input
                  id="svc-nombre"
                  autoFocus
                  value={form.nombre}
                  onChange={(e) => setForm({ ...form, nombre: e.target.value })}
                  placeholder="Ej: Cambio de aceite — Toyota Hilux"
                  className={INPUT}
                />
              </section>

              {/* 2 · Insumos */}
              <section>
                <div className="mb-2 flex items-baseline justify-between gap-3">
                  <h3 className="text-sm font-semibold text-slate-800">Productos que consume</h3>
                  <span className="text-[11px] text-slate-400">
                    Al vender el servicio, esto baja del stock.
                  </span>
                </div>

                <div className="overflow-hidden rounded-xl border border-slate-200">
                  {form.insumos.length > 0 && (
                    <>
                      {/* Encabezado de columnas: sin esto, tres campos numericos
                          seguidos no dicen que es cada uno. */}
                      <div className="grid grid-cols-[minmax(0,1fr)_5rem_7rem_5rem_2.5rem] items-center gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                        <span>Producto</span>
                        <span className="text-right">Cantidad</span>
                        <span>Unidad</span>
                        <span className="text-right">Merma %</span>
                        <span />
                      </div>

                      <ul className="divide-y divide-slate-100">
                        {form.insumos.map((fi, idx) => {
                          const p = porId.get(fi.insumo_producto_id);
                          const opciones = unidadesCompatibles(p?.unidad_medida);
                          const enUnidadProd = cantidadEnUnidadDelProducto(
                            Number(fi.cantidad) || 0,
                            fi.unidad_medida,
                            p?.unidad_medida
                          );
                          const merma = (Number(fi.merma_pct) || 0) / 100;
                          const sub =
                            enUnidadProd == null
                              ? null
                              : enUnidadProd * (1 + merma) * (p?.costo_promedio ?? 0);
                          return (
                            <li
                              key={fi.insumo_producto_id}
                              className="grid grid-cols-[minmax(0,1fr)_5rem_7rem_5rem_2.5rem] items-center gap-2 px-3 py-2.5"
                            >
                              <div className="min-w-0">
                                <p className="truncate text-sm text-slate-800" title={p?.nombre}>
                                  {p?.nombre ?? "—"}
                                </p>
                                <p className="text-[11px] text-slate-400">
                                  {p
                                    ? `${gs(p.costo_promedio ?? 0)} por ${normalizar(p.unidad_medida) || "UNIDAD"}`
                                    : ""}
                                  {sub != null && sub > 0 && (
                                    <span className="text-slate-500"> · cuesta {gs(sub)}</span>
                                  )}
                                </p>
                              </div>

                              <input
                                type="number"
                                min={0}
                                step="0.01"
                                value={fi.cantidad}
                                onChange={(e) => cambiarInsumo(idx, "cantidad", e.target.value)}
                                className={`${CELDA} text-right tabular-nums`}
                                aria-label={`Cantidad de ${p?.nombre ?? "insumo"}`}
                              />

                              {/* Un select, no texto libre: una unidad mal escrita
                                  no se puede convertir y el servicio pasa a
                                  costar cero sin avisar. */}
                              {opciones.length > 0 ? (
                                <select
                                  value={normalizar(fi.unidad_medida)}
                                  onChange={(e) => cambiarInsumo(idx, "unidad_medida", e.target.value)}
                                  className={CELDA}
                                  aria-label={`Unidad de ${p?.nombre ?? "insumo"}`}
                                >
                                  {!opciones.includes(normalizar(fi.unidad_medida)) && (
                                    <option value={normalizar(fi.unidad_medida)}>
                                      {normalizar(fi.unidad_medida) || "—"}
                                    </option>
                                  )}
                                  {opciones.map((u) => (
                                    <option key={u} value={u}>
                                      {u}
                                    </option>
                                  ))}
                                </select>
                              ) : (
                                <input
                                  value={fi.unidad_medida}
                                  onChange={(e) =>
                                    cambiarInsumo(idx, "unidad_medida", e.target.value.toUpperCase())
                                  }
                                  className={`${CELDA} uppercase`}
                                  aria-label={`Unidad de ${p?.nombre ?? "insumo"}`}
                                />
                              )}

                              <input
                                type="number"
                                min={0}
                                max={99}
                                value={fi.merma_pct}
                                onChange={(e) => cambiarInsumo(idx, "merma_pct", e.target.value)}
                                className={`${CELDA} text-right tabular-nums`}
                                placeholder="0"
                                title="Cuánto se pierde al usarlo (derrame, resto en el envase)"
                                aria-label={`Merma de ${p?.nombre ?? "insumo"}`}
                              />

                              <button
                                type="button"
                                onClick={() =>
                                  setForm((f) => ({
                                    ...f,
                                    insumos: f.insumos.filter((_, i) => i !== idx),
                                  }))
                                }
                                className="justify-self-center rounded-lg p-2 text-slate-300 transition-colors hover:bg-red-50 hover:text-red-600"
                                aria-label={`Quitar ${p?.nombre ?? "insumo"}`}
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    </>
                  )}

                  {/* Buscador, pegado al final de la lista. */}
                  <div className="relative border-t border-slate-200 bg-slate-50/60 p-2">
                    <Search className="pointer-events-none absolute left-5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <input
                      value={buscaInsumo}
                      onChange={(e) => setBuscaInsumo(e.target.value)}
                      placeholder={
                        form.insumos.length
                          ? "Agregar otro producto…"
                          : "Buscar el primer producto que consume…"
                      }
                      className={`${INPUT} border-transparent bg-transparent pl-9 focus:border-transparent focus:ring-0`}
                    />
                    {buscaInsumo.trim() && (
                      <ul className="absolute left-2 right-2 top-full z-20 mt-1 max-h-56 overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-lg">
                        {insumosFiltrados.length === 0 ? (
                          <li className="px-3 py-2 text-xs text-slate-400">Sin resultados.</li>
                        ) : (
                          insumosFiltrados.map((p) => (
                            <li key={p.id}>
                              <button
                                type="button"
                                onClick={() => agregarInsumo(p)}
                                className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left transition-colors hover:bg-slate-50"
                              >
                                <span className="min-w-0">
                                  <span className="block truncate text-sm text-slate-800">
                                    {p.nombre}
                                  </span>
                                  <span className="text-[11px] text-slate-400">
                                    {p.sku} · {gs(p.costo_promedio ?? 0)} por{" "}
                                    {normalizar(p.unidad_medida) || "UNIDAD"}
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

                {estimado.incompatible && (
                  <p className="mt-2 flex items-start gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-800">
                    <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
                    Hay un insumo con una unidad que no se puede convertir a la del producto. Así no
                    se costea ni se descuenta del stock: elegí una unidad de la misma familia.
                  </p>
                )}
              </section>

              {/* 3 · Plata */}
              <section className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className={LABEL} htmlFor="svc-mo">
                    Mano de obra (Gs.)
                  </label>
                  <input
                    id="svc-mo"
                    type="number"
                    min={0}
                    value={form.mano_obra}
                    onChange={(e) => setForm({ ...form, mano_obra: e.target.value })}
                    placeholder="0"
                    className={`${INPUT} tabular-nums`}
                  />
                  <p className="mt-1 text-[11px] text-slate-400">El trabajo, sin contar materiales.</p>
                </div>

                <div>
                  <span className={LABEL}>Precio de venta</span>
                  <div className="mb-2 inline-flex overflow-hidden rounded-lg border border-slate-200">
                    {(["manual", "margen"] as const).map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setForm({ ...form, modo_precio: m })}
                        className={`px-3 py-1.5 text-[11px] font-semibold transition-colors ${
                          form.modo_precio === m
                            ? "bg-[#4FAEB2] text-white"
                            : "bg-white text-slate-600 hover:bg-slate-50"
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
                      className={`${INPUT} tabular-nums`}
                      aria-label="Precio de venta"
                    />
                  ) : (
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min={0}
                        max={1000}
                        value={form.margen_pct}
                        onChange={(e) => setForm({ ...form, margen_pct: e.target.value })}
                        className={`${INPUT} w-24 tabular-nums`}
                        aria-label="Porcentaje de ganancia"
                      />
                      <span className="text-sm text-slate-500">% de ganancia</span>
                    </div>
                  )}
                </div>
              </section>

              {/* 4 · Intervalo */}
              <section className="rounded-xl border border-[#4FAEB2]/30 bg-[#4FAEB2]/5 p-4">
                <div className="flex items-center gap-2">
                  <RotateCcw className="h-4 w-4 text-[#357C80]" />
                  <h3 className="text-sm font-semibold text-slate-800">Cada cuánto se repite</h3>
                </div>
                <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
                  Con esto el sistema avisa a qué vehículos les toca. Vence por lo que ocurra
                  primero. Vacío = no genera aviso.
                </p>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className={LABEL} htmlFor="svc-km">
                      Cada cuántos km
                    </label>
                    <input
                      id="svc-km"
                      type="number"
                      min={1}
                      value={form.intervalo_km}
                      onChange={(e) => setForm({ ...form, intervalo_km: e.target.value })}
                      placeholder="5000"
                      className={`${INPUT} tabular-nums`}
                    />
                  </div>
                  <div>
                    <label className={LABEL} htmlFor="svc-meses">
                      Cada cuántos meses
                    </label>
                    <input
                      id="svc-meses"
                      type="number"
                      min={1}
                      max={120}
                      value={form.intervalo_meses}
                      onChange={(e) => setForm({ ...form, intervalo_meses: e.target.value })}
                      placeholder="6"
                      className={`${INPUT} tabular-nums`}
                    />
                  </div>
                </div>
              </section>

              {error && (
                <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  {error}
                </p>
              )}
            </div>

            {/* Pie: la cuenta y los botones juntos, siempre a la vista. */}
            <div className="border-t border-slate-200 bg-slate-50">
              <div className="grid grid-cols-3 divide-x divide-slate-200 border-b border-slate-200">
                <div className="px-4 py-2.5">
                  <p className="text-[10px] uppercase tracking-wide text-slate-400">Costo</p>
                  <p className="text-sm font-semibold tabular-nums text-slate-700">
                    {gs(costoEstimado)}
                  </p>
                  <p className="text-[10px] text-slate-400">
                    {gs(estimado.manoObra)} mano de obra + {gs(estimado.insumos)} insumos
                  </p>
                </div>
                <div className="px-4 py-2.5">
                  <p className="text-[10px] uppercase tracking-wide text-slate-400">Precio</p>
                  <p className="text-sm font-semibold tabular-nums text-slate-900">
                    {gs(precioPrevisto)}
                  </p>
                  <p className="text-[10px] text-slate-400">
                    {form.modo_precio === "margen" ? "calculado sobre el costo" : "puesto a mano"}
                  </p>
                </div>
                <div className="px-4 py-2.5">
                  <p className="text-[10px] uppercase tracking-wide text-slate-400">Ganancia</p>
                  <p
                    className={`text-sm font-semibold tabular-nums ${
                      precioPrevisto - costoEstimado >= 0 ? "text-emerald-600" : "text-red-600"
                    }`}
                  >
                    {gs(precioPrevisto - costoEstimado)}
                    {precioPrevisto > 0 &&
                      ` · ${Math.round(((precioPrevisto - costoEstimado) / precioPrevisto) * 100)}%`}
                  </p>
                  <p className="text-[10px] text-slate-400">
                    estimado; el firme lo calcula el sistema al guardar
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 px-6 py-4">
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
                  className="rounded-xl border border-slate-200 bg-white px-5 py-2.5 text-sm text-slate-600 transition-colors hover:bg-slate-50"
                >
                  Cancelar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
