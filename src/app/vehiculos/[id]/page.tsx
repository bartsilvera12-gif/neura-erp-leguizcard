"use client";

import Link from "next/link";
import { use, useCallback, useEffect, useState } from "react";
import { AlertTriangle, Car, CalendarClock, Gauge, Loader2, Wrench } from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import { actualizarVehiculo, getVehiculo } from "@/lib/vehiculos/storage";
import {
  COMBUSTIBLE_LABEL,
  type EstadoServicioVehiculo,
  type ItemServicioVehiculo,
  type ServicioVehiculo,
  type Vehiculo,
} from "@/lib/vehiculos/types";

function gs(v: number): string {
  return `Gs. ${Math.round(v).toLocaleString("es-PY")}`;
}
function km(v: number | null): string {
  return v == null ? "—" : `${Math.round(v).toLocaleString("es-PY")} km`;
}
function fecha(iso: string): string {
  try {
    const d = new Date(iso);
    return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
  } catch {
    return iso;
  }
}

const miles = (v: number) => Math.round(v).toLocaleString("es-PY");

/**
 * Cantidad legible de una linea: "4 L", "1 filtro". La unidad UNIDAD no se
 * escribe (decir "1 UNIDAD" no agrega nada); los litros si, porque son el dato
 * que el cliente pregunta.
 */
function cantidadItem(i: ItemServicioVehiculo): string {
  const n = i.cantidad % 1 === 0 ? String(i.cantidad) : i.cantidad.toFixed(2);
  const u = (i.unidad_medida ?? "").toUpperCase();
  if (i.presentacion_nombre) return `${n} × ${i.presentacion_nombre}`;
  if (!u || u === "UNIDAD") return n;
  return `${n} ${u === "LITRO" ? "L" : u}`;
}

type Urgencia = "vencido" | "cerca" | "ok";

/**
 * Traduce el estado de un servicio a la frase que el dueño le dice al cliente
 * por telefono. Vence por lo que ocurra primero: si controla km y tiempo, se
 * muestran los dos y el cliente se guia por el que llegue antes.
 */
function resumenProximo(p: EstadoServicioVehiculo): { texto: string; urgencia: Urgencia } {
  if (p.vencido) {
    const partes: string[] = [];
    if (p.km_restantes != null && p.km_restantes <= 0) {
      partes.push(`${miles(Math.abs(p.km_restantes))} km pasados`);
    }
    if (p.dias_restantes != null && p.dias_restantes <= 0) {
      partes.push(`${Math.abs(p.dias_restantes)} días pasados`);
    }
    return { texto: partes.length ? partes.join(" · ") : "Ya corresponde", urgencia: "vencido" };
  }
  const partes: string[] = [];
  if (p.km_restantes != null) partes.push(`faltan ${miles(p.km_restantes)} km`);
  if (p.dias_restantes != null) partes.push(`faltan ${p.dias_restantes} días`);
  // "Cerca" = último 10% del intervalo de km, o dentro de los 30 días.
  const cerca =
    (p.km_restantes != null && p.intervalo_km != null && p.km_restantes <= p.intervalo_km * 0.1) ||
    (p.dias_restantes != null && p.dias_restantes <= 30);
  if (!partes.length) {
    return { texto: "Falta la lectura del odómetro para calcularlo", urgencia: "ok" };
  }
  return { texto: partes.join(" · "), urgencia: cerca ? "cerca" : "ok" };
}

const TONO: Record<Urgencia, { caja: string; texto: string; chip: string }> = {
  vencido: {
    caja: "border-red-200 bg-red-50/60",
    texto: "text-red-700",
    chip: "bg-red-100 text-red-700",
  },
  cerca: {
    caja: "border-amber-200 bg-amber-50/60",
    texto: "text-amber-700",
    chip: "bg-amber-100 text-amber-700",
  },
  ok: {
    caja: "border-slate-200 bg-white",
    texto: "text-slate-700",
    chip: "bg-slate-100 text-slate-600",
  },
};

function Dato({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className="mt-0.5 text-sm text-slate-800">{value ?? "—"}</dd>
    </div>
  );
}

export default function VehiculoDetallePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [vehiculo, setVehiculo] = useState<Vehiculo | null>(null);
  const [servicios, setServicios] = useState<ServicioVehiculo[]>([]);
  const [proximos, setProximos] = useState<EstadoServicioVehiculo[]>([]);
  const [cargando, setCargando] = useState(true);

  const [nuevoKm, setNuevoKm] = useState("");
  const [guardandoKm, setGuardandoKm] = useState(false);
  const [errorKm, setErrorKm] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    const r = await getVehiculo(id);
    if (r) {
      setVehiculo(r.vehiculo);
      setServicios(r.servicios);
      setProximos(r.proximos);
    }
    setCargando(false);
  }, [id]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  async function guardarKm(e: React.FormEvent) {
    e.preventDefault();
    setErrorKm(null);
    const v = Number(nuevoKm);
    if (!Number.isFinite(v) || v < 0) {
      setErrorKm("Kilometraje inválido.");
      return;
    }
    setGuardandoKm(true);
    const r = await actualizarVehiculo(id, { km_actual: v });
    setGuardandoKm(false);
    if (!r.ok) {
      setErrorKm(r.error);
      return;
    }
    setVehiculo(r.vehiculo);
    setNuevoKm("");
  }

  if (cargando) {
    return <p className="py-16 text-center text-sm text-slate-400">Cargando vehículo…</p>;
  }
  if (!vehiculo) {
    return (
      <div className="py-16 text-center">
        <p className="text-sm font-medium text-slate-600">Vehículo no encontrado.</p>
        <Link href="/vehiculos" className="mt-2 inline-block text-sm text-[#3F8E91] hover:underline">
          Volver a vehículos
        </Link>
      </div>
    );
  }

  const desc = [vehiculo.marca, vehiculo.modelo].filter(Boolean).join(" ");

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Zentra · Taller"
        title={vehiculo.patente}
        description={desc ? `${desc}${vehiculo.anio ? ` · ${vehiculo.anio}` : ""}` : "Sin marca ni modelo cargados"}
        backHref="/vehiculos"
        backLabel="Volver a vehículos"
      />

      {/* ── Proximo servicio ──────────────────────────────────────────────
          Va primero a proposito: es lo que se mira cuando el cliente llama y
          pregunta cuanto le falta. */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm ring-1 ring-[#4FAEB2]/15 sm:p-6">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-800">
          <CalendarClock className="h-4 w-4 text-[#4FAEB2]" />
          Próximo servicio
        </h2>

        {proximos.length === 0 ? (
          <p className="mt-3 text-sm text-slate-400">
            Todavía no se puede calcular. Aparece cuando el vehículo recibe un servicio que
            tenga configurado su intervalo de kilómetros o de meses.
          </p>
        ) : (
          <ul className="mt-4 grid gap-3 sm:grid-cols-2">
            {proximos.map((p) => {
              const { texto, urgencia } = resumenProximo(p);
              const tono = TONO[urgencia];
              return (
                <li key={p.producto_id} className={`rounded-lg border px-4 py-3 ${tono.caja}`}>
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-semibold text-slate-900">{p.servicio_nombre}</p>
                    {urgencia === "vencido" && (
                      <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${tono.chip}`}>
                        <AlertTriangle className="h-3 w-3" />
                        Vencido
                      </span>
                    )}
                  </div>

                  <p className={`mt-1 text-base font-bold ${tono.texto}`}>{texto}</p>

                  {/* El "a los X km o el DD/MM" es el dato que se le dicta al cliente. */}
                  <p className="mt-1.5 text-xs text-slate-500">
                    Corresponde
                    {p.proximo_km != null && <> a los <strong className="font-semibold text-slate-700">{miles(p.proximo_km)} km</strong></>}
                    {p.proximo_km != null && p.proxima_fecha != null && " o"}
                    {p.proxima_fecha != null && <> el <strong className="font-semibold text-slate-700">{fecha(p.proxima_fecha)}</strong></>}
                    {p.proximo_km != null && p.proxima_fecha != null && (
                      <span className="text-slate-400"> — lo que ocurra primero</span>
                    )}
                  </p>

                  <p className="mt-2 border-t border-slate-200/70 pt-2 text-[11px] text-slate-400">
                    Último: {fecha(p.ultima_fecha)}
                    {p.ultimo_km != null && ` · a los ${miles(p.ultimo_km)} km`}
                    {p.intervalo_km != null && ` · cada ${miles(p.intervalo_km)} km`}
                    {p.intervalo_meses != null && ` · cada ${p.intervalo_meses} meses`}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Ficha */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm ring-1 ring-[#4FAEB2]/15 lg:col-span-2">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-800">
            <Car className="h-4 w-4 text-[#4FAEB2]" />
            Ficha del vehículo
          </h2>
          <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
            <Dato
              label="Cliente"
              value={
                vehiculo.cliente_id && vehiculo.cliente_nombre ? (
                  <Link href={`/clientes/${vehiculo.cliente_id}`} className="text-[#3F8E91] hover:underline">
                    {vehiculo.cliente_nombre}
                  </Link>
                ) : (
                  "Sin asignar"
                )
              }
            />
            <Dato label="Marca" value={vehiculo.marca} />
            <Dato label="Modelo" value={vehiculo.modelo} />
            <Dato label="Año" value={vehiculo.anio} />
            <Dato label="Motor" value={vehiculo.motor} />
            <Dato
              label="Combustible"
              value={vehiculo.combustible ? COMBUSTIBLE_LABEL[vehiculo.combustible] : null}
            />
            <Dato label="Color" value={vehiculo.color} />
            <Dato label="Chasis / VIN" value={vehiculo.vin ? <span className="font-mono text-xs">{vehiculo.vin}</span> : null} />
            <Dato
              label="Estado"
              value={vehiculo.activo ? "Activo" : <span className="text-slate-500">De baja</span>}
            />
          </dl>
          {vehiculo.observaciones && (
            <div className="mt-4 rounded-lg bg-slate-50 px-3 py-2">
              <p className="text-[11px] uppercase tracking-wide text-slate-400">Observaciones</p>
              <p className="mt-0.5 whitespace-pre-line text-sm text-slate-700">{vehiculo.observaciones}</p>
            </div>
          )}
        </div>

        {/* Kilometraje */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm ring-1 ring-[#4FAEB2]/15">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-800">
            <Gauge className="h-4 w-4 text-[#4FAEB2]" />
            Kilometraje
          </h2>
          <p className="mt-3 font-mono text-2xl font-bold text-slate-900">{km(vehiculo.km_actual)}</p>
          {vehiculo.km_actualizado_at && (
            <p className="mt-1 text-xs text-slate-400">Actualizado el {fecha(vehiculo.km_actualizado_at)}</p>
          )}

          <form onSubmit={guardarKm} className="mt-4 space-y-2">
            <label className="block text-xs font-medium text-slate-600" htmlFor="km">
              Registrar nueva lectura
            </label>
            <div className="flex gap-2">
              <input
                id="km"
                type="number"
                min={0}
                value={nuevoKm}
                onChange={(e) => setNuevoKm(e.target.value)}
                placeholder={vehiculo.km_actual != null ? String(Math.round(vehiculo.km_actual)) : "0"}
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none transition-colors focus:border-[#4FAEB2]"
              />
              <button
                type="submit"
                disabled={guardandoKm || !nuevoKm}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-[#4FAEB2] px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#3F8E91] disabled:opacity-50"
              >
                {guardandoKm && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Guardar
              </button>
            </div>
            {errorKm && <p className="text-xs text-red-600">{errorKm}</p>}
            <p className="text-[11px] text-slate-400">El odómetro no puede retroceder.</p>
          </form>
        </div>
      </div>

      {/* Historial de servicios */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm ring-1 ring-[#4FAEB2]/15 sm:p-6">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-800">
          <Wrench className="h-4 w-4 text-[#4FAEB2]" />
          Historial de servicios
          <span className="text-xs font-normal text-slate-400">({servicios.length})</span>
        </h2>

        {servicios.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-400">
            Todavía no hay servicios registrados para este vehículo.
          </p>
        ) : (
          <ul className="mt-4 space-y-3">
            {servicios.map((s) => (
              <li
                key={s.venta_id}
                className="rounded-lg border border-slate-100 px-4 py-3 transition-colors hover:bg-slate-50/60"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div className="flex flex-wrap items-baseline gap-3">
                    <span className="font-mono text-sm font-semibold text-slate-800">{s.numero_control}</span>
                    <span className="text-xs text-slate-500">{fecha(s.fecha)}</span>
                    {s.km_registrado != null && (
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 font-mono text-[11px] text-slate-600">
                        {km(s.km_registrado)}
                      </span>
                    )}
                    {/* Cuanto anduvo desde la visita anterior: dice si el auto se
                        usa mucho o poco, y con eso se estima cuando vuelve. */}
                    {s.km_recorridos != null && s.km_recorridos > 0 && (
                      <span className="rounded-full bg-[#4FAEB2]/10 px-2 py-0.5 font-mono text-[11px] text-[#3F8E91]">
                        +{miles(s.km_recorridos)} km desde la anterior
                      </span>
                    )}
                    {s.estado === "anulada" && (
                      <span className="rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-medium text-red-600">
                        Anulada
                      </span>
                    )}
                  </div>
                  <span className="font-mono text-sm font-semibold text-slate-900">{gs(s.total)}</span>
                </div>

                {s.items.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {s.items.map((i, k) => (
                      <li key={k} className="flex items-baseline justify-between gap-3 text-xs">
                        <span className="min-w-0 text-slate-600">
                          {/* El servicio se destaca; los insumos van debajo, que es
                              como se lee: "cambio de aceite" y con que se hizo. */}
                          {i.es_servicio ? (
                            <span className="font-semibold text-slate-800">{i.producto_nombre}</span>
                          ) : (
                            <>
                              <span className="text-slate-400">· </span>
                              {i.producto_nombre}
                              {i.marca && <span className="text-slate-400"> · {i.marca}</span>}
                            </>
                          )}
                        </span>
                        <span className="shrink-0 font-mono text-slate-500">{cantidadItem(i)}</span>
                      </li>
                    ))}
                  </ul>
                )}

                {/* Lo que anoto el taller: "el filtro de aire estaba muy sucio". */}
                {s.observaciones && (
                  <p className="mt-2 rounded-md bg-amber-50/70 px-2.5 py-1.5 text-xs text-amber-900">
                    {s.observaciones}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
