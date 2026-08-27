"use client";

import { use, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AlertTriangle, Car, Droplet, Gauge, Loader2, Trash2 } from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import { FancySelect } from "@/components/ui/FancySelect";
import FotoVehiculo from "@/components/vehiculos/FotoVehiculo";
import {
  actualizarVehiculo,
  desactivarVehiculo,
  eliminarVehiculo,
  getVehiculo,
} from "@/lib/vehiculos/storage";
import { COMBUSTIBLES, COMBUSTIBLE_LABEL, type Combustible } from "@/lib/vehiculos/types";
import { getClientes, clienteNombre } from "@/lib/clientes/storage";
import type { Cliente } from "@/lib/clientes/types";

const INPUT =
  "w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm outline-none transition-all hover:border-[#4FAEB2]/60 focus:border-[#4FAEB2] focus:ring-2 focus:ring-[#4FAEB2]/20";
const LABEL = "mb-1 block text-xs font-medium text-slate-600";

const miles = (v: number) => Math.round(v).toLocaleString("es-PY");

function fecha(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}

/** Encabezado de cada bloque del formulario. */
function Bloque({
  icono,
  titulo,
  ayuda,
  children,
}: {
  icono: React.ReactNode;
  titulo: string;
  ayuda?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm ring-1 ring-[#4FAEB2]/10 sm:p-6">
      <div className="mb-4 flex items-start gap-2.5">
        <span className="mt-0.5 text-[#4FAEB2]">{icono}</span>
        <div>
          <h2 className="text-sm font-semibold text-slate-800">{titulo}</h2>
          {ayuda && <p className="mt-0.5 text-xs text-slate-500">{ayuda}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}

export default function EditarVehiculoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();

  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Cuántas ventas cuelgan del auto: define si se puede borrar o solo dar de baja. */
  const [visitas, setVisitas] = useState(0);
  const [activo, setActivo] = useState(true);

  const [patente, setPatente] = useState("");
  const [clienteId, setClienteId] = useState("");
  const [marca, setMarca] = useState("");
  const [modelo, setModelo] = useState("");
  const [anio, setAnio] = useState("");
  const [motor, setMotor] = useState("");
  const [combustible, setCombustible] = useState<Combustible | "">("");
  const [color, setColor] = useState("");
  const [vin, setVin] = useState("");
  const [km, setKm] = useState("");
  const [aceiteTipo, setAceiteTipo] = useState("");
  const [aceiteLitros, setAceiteLitros] = useState("");
  const [observaciones, setObservaciones] = useState("");
  const [imagenUrl, setImagenUrl] = useState<string | null>(null);

  /** Lectura guardada, para poder avisar si la nueva es menor. */
  const [kmGuardado, setKmGuardado] = useState<number | null>(null);
  const [kmFecha, setKmFecha] = useState<string | null>(null);

  const [confirmando, setConfirmando] = useState<null | "baja" | "borrar">(null);
  const [borrando, setBorrando] = useState(false);

  const cargar = useCallback(async () => {
    const [r, cs] = await Promise.all([getVehiculo(id), getClientes()]);
    setClientes(cs);
    if (r) {
      const v = r.vehiculo;
      setPatente(v.patente);
      setClienteId(v.cliente_id ?? "");
      setMarca(v.marca ?? "");
      setModelo(v.modelo ?? "");
      setAnio(v.anio != null ? String(v.anio) : "");
      setMotor(v.motor ?? "");
      setCombustible(v.combustible ?? "");
      setColor(v.color ?? "");
      setVin(v.vin ?? "");
      setKm(v.km_actual != null ? String(Math.round(v.km_actual)) : "");
      setKmGuardado(v.km_actual);
      setKmFecha(v.km_actualizado_at);
      setAceiteTipo(v.aceite_tipo ?? "");
      setAceiteLitros(v.aceite_litros != null ? String(v.aceite_litros) : "");
      setObservaciones(v.observaciones ?? "");
      setImagenUrl(v.imagen_url ?? null);
      setActivo(v.activo);
      setVisitas(r.ventasAsociadas);
    }
    setCargando(false);
  }, [id]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const kmNum = km.trim() === "" ? null : Number(km);
  /**
   * Bajar el odómetro es corregir un error de tipeo, no algo normal. Se permite
   * porque el que edita es una persona, pero se avisa: una venta NUNCA lo baja.
   */
  const kmBaja = kmNum != null && Number.isFinite(kmNum) && kmGuardado != null && kmNum < kmGuardado;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!patente.trim()) {
      setError("La patente es obligatoria.");
      return;
    }
    setGuardando(true);
    const r = await actualizarVehiculo(id, {
      patente: patente.trim(),
      cliente_id: clienteId || null,
      marca: marca.trim() || null,
      modelo: modelo.trim() || null,
      anio: anio ? Number(anio) : null,
      motor: motor.trim() || null,
      combustible: combustible || null,
      color: color.trim() || null,
      vin: vin.trim() || null,
      km_actual: km.trim() === "" ? null : Number(km),
      aceite_tipo: aceiteTipo.trim() || null,
      aceite_litros: aceiteLitros ? Number(aceiteLitros) : null,
      observaciones: observaciones.trim() || null,
    });
    setGuardando(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    router.push(`/vehiculos/${id}`);
  }

  async function darDeBaja() {
    setBorrando(true);
    setError(null);
    const ok = await desactivarVehiculo(id);
    setBorrando(false);
    if (!ok) {
      setError("No se pudo dar de baja el vehículo.");
      return;
    }
    router.push("/vehiculos");
  }

  async function borrarDefinitivo() {
    setBorrando(true);
    setError(null);
    const r = await eliminarVehiculo(id);
    setBorrando(false);
    if (!r.ok) {
      setError(r.error);
      setConfirmando(null);
      return;
    }
    router.push("/vehiculos");
  }

  if (cargando) {
    return <p className="py-16 text-center text-sm text-slate-400">Cargando vehículo…</p>;
  }

  const opcionesCliente = [
    { value: "", label: "Sin asignar", description: "El vehículo queda sin dueño" },
    ...clientes.map((c) => ({ value: c.id, label: clienteNombre(c) })),
  ];
  const opcionesCombustible = [
    { value: "", label: "Sin especificar" },
    ...COMBUSTIBLES.map((c) => ({ value: c, label: COMBUSTIBLE_LABEL[c] })),
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Zentra · Taller"
        title={`Editar ${patente}`}
        description="La patente identifica al auto y no puede repetirse."
        backHref={`/vehiculos/${id}`}
        backLabel="Volver a la ficha"
      />

      <form onSubmit={onSubmit} className="max-w-4xl space-y-5">
        {/* ── Identificación ─────────────────────────────────────────────── */}
        <Bloque icono={<Car className="h-4 w-4" />} titulo="El vehículo">
          <div className="flex flex-col gap-5 sm:flex-row">
            <div className="w-full shrink-0 sm:w-52">
              <FotoVehiculo
                vehiculoId={id}
                patente={patente}
                imagenUrl={imagenUrl}
                onCambio={setImagenUrl}
              />
              <p className="mt-2 text-[11px] text-slate-400">
                La foto se guarda al instante, sin esperar a &quot;Guardar cambios&quot;.
              </p>
            </div>

            <div className="grid flex-1 grid-cols-2 gap-4 sm:grid-cols-3">
              <div className="col-span-2 sm:col-span-1">
                <label className={LABEL} htmlFor="patente">
                  Patente <span className="text-red-500">*</span>
                </label>
                <input
                  id="patente"
                  value={patente}
                  onChange={(e) => setPatente(e.target.value.toUpperCase())}
                  className={`${INPUT} font-mono font-semibold uppercase tracking-wide`}
                  required
                />
              </div>

              <div className="col-span-2">
                <label className={LABEL}>Cliente</label>
                <FancySelect
                  options={opcionesCliente}
                  value={clienteId}
                  onChange={setClienteId}
                  ariaLabel="Cliente del vehículo"
                  placeholder="Sin asignar"
                />
              </div>

              <div>
                <label className={LABEL} htmlFor="marca">Marca</label>
                <input id="marca" value={marca} onChange={(e) => setMarca(e.target.value)} placeholder="Toyota" className={INPUT} />
              </div>
              <div>
                <label className={LABEL} htmlFor="modelo">Modelo</label>
                <input id="modelo" value={modelo} onChange={(e) => setModelo(e.target.value)} placeholder="Hilux" className={INPUT} />
              </div>
              <div>
                <label className={LABEL} htmlFor="anio">Año</label>
                <input id="anio" type="number" min={1900} max={2200} value={anio} onChange={(e) => setAnio(e.target.value)} placeholder="2019" className={INPUT} />
              </div>

              <div>
                <label className={LABEL} htmlFor="motor">Motor</label>
                <input id="motor" value={motor} onChange={(e) => setMotor(e.target.value)} placeholder="2.8 TDI" className={INPUT} />
              </div>
              <div>
                <label className={LABEL}>Combustible</label>
                <FancySelect
                  options={opcionesCombustible}
                  value={combustible}
                  onChange={(v) => setCombustible(v as Combustible | "")}
                  ariaLabel="Combustible"
                  placeholder="Sin especificar"
                />
              </div>
              <div>
                <label className={LABEL} htmlFor="color">Color</label>
                <input id="color" value={color} onChange={(e) => setColor(e.target.value)} placeholder="Blanco" className={INPUT} />
              </div>

              <div className="col-span-2 sm:col-span-3">
                <label className={LABEL} htmlFor="vin">Chasis / VIN</label>
                <input id="vin" value={vin} onChange={(e) => setVin(e.target.value)} className={`${INPUT} font-mono`} />
                <p className="mt-1 text-[11px] text-slate-400">
                  La patente se compara sin espacios ni guiones: &quot;ABC 123&quot; y &quot;abc-123&quot; son el mismo auto.
                </p>
              </div>
            </div>
          </div>
        </Bloque>

        {/* ── Kilometraje ────────────────────────────────────────────────── */}
        <Bloque
          icono={<Gauge className="h-4 w-4" />}
          titulo="Kilometraje"
          ayuda="Define cuándo toca el próximo mantenimiento. Las ventas lo van subiendo solas."
        >
          <div className="flex flex-wrap items-end gap-4">
            <div>
              <label className={LABEL} htmlFor="km">Odómetro actual</label>
              <input
                id="km"
                type="number"
                min={0}
                value={km}
                onChange={(e) => setKm(e.target.value)}
                placeholder="0"
                className={`${INPUT} w-44 tabular-nums ${kmBaja ? "border-amber-400" : ""}`}
              />
            </div>
            {kmGuardado != null && (
              <p className="pb-2 text-xs text-slate-500">
                Último registrado: <strong className="font-semibold text-slate-700">{miles(kmGuardado)} km</strong>
                {kmFecha && <span className="text-slate-400"> · {fecha(kmFecha)}</span>}
              </p>
            )}
          </div>
          {kmBaja && (
            <p className="mt-2 flex items-start gap-1.5 text-xs text-amber-700">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              Estás bajando el odómetro. Se permite para corregir un error de tipeo, pero revisá el
              número: una venta nunca lo baja por su cuenta.
            </p>
          )}
        </Bloque>

        {/* ── Aceite ─────────────────────────────────────────────────────── */}
        <Bloque
          icono={<Droplet className="h-4 w-4" />}
          titulo="Aceite que usa"
          ayuda="La especificación que pide el vehículo, no una marca puntual: sirve igual aunque cambien de proveedor."
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="sm:col-span-2">
              <label className={LABEL} htmlFor="aceite_tipo">Tipo</label>
              <input
                id="aceite_tipo"
                value={aceiteTipo}
                onChange={(e) => setAceiteTipo(e.target.value)}
                placeholder="Ej: 15W40 semisintético"
                className={INPUT}
              />
            </div>
            <div>
              <label className={LABEL} htmlFor="aceite_litros">Litros del cambio</label>
              <input
                id="aceite_litros"
                type="number"
                min={0}
                step="0.1"
                value={aceiteLitros}
                onChange={(e) => setAceiteLitros(e.target.value)}
                placeholder="7.5"
                className={`${INPUT} tabular-nums`}
              />
            </div>
          </div>
        </Bloque>

        {/* ── Observaciones ──────────────────────────────────────────────── */}
        <Bloque
          icono={<AlertTriangle className="h-4 w-4" />}
          titulo="Observaciones"
          ayuda="Lo que conviene recordar la próxima vez: una fuga, un ruido, algo que el cliente pidió."
        >
          <textarea
            value={observaciones}
            onChange={(e) => setObservaciones(e.target.value)}
            rows={3}
            className={INPUT}
          />
        </Bloque>

        {error && (
          <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
        )}

        <div className="flex flex-wrap gap-3">
          <button
            type="submit"
            disabled={guardando}
            className="inline-flex items-center gap-2 rounded-xl bg-[#4FAEB2] px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[#3F8E91] disabled:opacity-60"
          >
            {guardando && <Loader2 className="h-4 w-4 animate-spin" />}
            Guardar cambios
          </button>
          <Link
            href={`/vehiculos/${id}`}
            className="rounded-xl border border-slate-200 px-5 py-2.5 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50"
          >
            Cancelar
          </Link>
        </div>
      </form>

      {/* ── Baja / eliminación ────────────────────────────────────────────
          Separado del formulario a proposito: no es un campo mas, y mezclarlo
          con "Guardar" invita a un clic equivocado. */}
      <div className="max-w-4xl rounded-2xl border border-red-200 bg-red-50/40 p-5 sm:p-6">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-red-800">
          <Trash2 className="h-4 w-4" />
          Dar de baja o eliminar
        </h2>

        {visitas > 0 ? (
          <>
            <p className="mt-2 text-sm text-slate-700">
              Este vehículo tiene{" "}
              <strong className="font-semibold">
                {visitas} {visitas === 1 ? "atención registrada" : "atenciones registradas"}
              </strong>
              . No se puede eliminar: borrarlo dejaría esas ventas sin vehículo y se perdería el
              historial del auto para siempre.
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Darlo de baja lo saca de los listados y del buscador de la venta, pero conserva todo
              su historial. Es reversible.
            </p>
          </>
        ) : (
          <p className="mt-2 text-sm text-slate-700">
            Este vehículo no tiene ninguna atención registrada, así que se puede eliminar
            definitivamente. Si en cambio dejó de venir pero querés conservarlo, dalo de baja.
          </p>
        )}

        {confirmando === null ? (
          <div className="mt-4 flex flex-wrap gap-3">
            {activo && (
              <button
                type="button"
                onClick={() => setConfirmando("baja")}
                className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
              >
                Dar de baja
              </button>
            )}
            {visitas === 0 && (
              <button
                type="button"
                onClick={() => setConfirmando("borrar")}
                className="rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-red-700"
              >
                Eliminar definitivamente
              </button>
            )}
            {!activo && (
              <span className="self-center text-xs text-slate-500">
                Ya está dado de baja. Podés reactivarlo cambiando su estado desde el listado.
              </span>
            )}
          </div>
        ) : (
          <div className="mt-4 rounded-xl border border-red-300 bg-white p-4">
            <p className="flex items-start gap-2 text-sm font-medium text-red-800">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              {confirmando === "baja"
                ? `¿Dar de baja ${patente}? Sale de los listados pero conserva su historial, y se puede reactivar.`
                : `¿Eliminar ${patente} definitivamente? Esto no se puede deshacer.`}
            </p>
            <div className="mt-3 flex gap-3">
              <button
                type="button"
                onClick={confirmando === "baja" ? darDeBaja : borrarDefinitivo}
                disabled={borrando}
                className="inline-flex items-center gap-2 rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-red-700 disabled:opacity-60"
              >
                {borrando && <Loader2 className="h-4 w-4 animate-spin" />}
                Sí, {confirmando === "baja" ? "dar de baja" : "eliminar"}
              </button>
              <button
                type="button"
                onClick={() => setConfirmando(null)}
                className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50"
              >
                Cancelar
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
