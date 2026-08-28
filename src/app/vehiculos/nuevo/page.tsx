"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import { crearVehiculo } from "@/lib/vehiculos/storage";
import { COMBUSTIBLES, COMBUSTIBLE_LABEL, type Combustible } from "@/lib/vehiculos/types";
import { getClientes, clienteNombre } from "@/lib/clientes/storage";
import type { Cliente } from "@/lib/clientes/types";

const INPUT =
  "w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm outline-none transition-colors focus:border-[#4FAEB2]";
const LABEL = "mb-1 block text-sm font-medium text-slate-700";

export default function NuevoVehiculoPage() {
  const router = useRouter();
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
  // Excepciones de ESTE auto. Vacío = manda lo que diga el servicio.
  const [intervaloKm, setIntervaloKm] = useState("");
  const [intervaloMeses, setIntervaloMeses] = useState("");
  const [avisarDias, setAvisarDias] = useState("");
  const [observaciones, setObservaciones] = useState("");

  useEffect(() => {
    let cancel = false;
    getClientes().then((rows) => {
      if (!cancel) setClientes(rows);
    });
    return () => {
      cancel = true;
    };
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!patente.trim()) {
      setError("La patente es obligatoria.");
      return;
    }
    setGuardando(true);
    const r = await crearVehiculo({
      patente: patente.trim(),
      cliente_id: clienteId || null,
      marca: marca.trim() || null,
      modelo: modelo.trim() || null,
      anio: anio ? Number(anio) : null,
      motor: motor.trim() || null,
      combustible: combustible || null,
      color: color.trim() || null,
      vin: vin.trim() || null,
      km_actual: km ? Number(km) : null,
      aceite_tipo: aceiteTipo.trim() || null,
      aceite_litros: aceiteLitros ? Number(aceiteLitros) : null,
      intervalo_km: intervaloKm ? Number(intervaloKm) : null,
      intervalo_meses: intervaloMeses ? Number(intervaloMeses) : null,
      avisar_inactivo_dias: avisarDias === "" ? null : Number(avisarDias),
      observaciones: observaciones.trim() || null,
    });
    setGuardando(false);

    if (!r.ok) {
      setError(r.error);
      return;
    }
    router.push(`/vehiculos/${r.vehiculo.id}`);
  }

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Zentra · Taller"
        title="Nuevo vehículo"
        description="La patente identifica al auto y no puede repetirse."
        backHref="/vehiculos"
        backLabel="Volver a vehículos"
      />

      <form onSubmit={onSubmit} className="max-w-3xl space-y-6">
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm ring-1 ring-[#4FAEB2]/15 sm:p-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className={LABEL} htmlFor="patente">
                Patente <span className="text-red-500">*</span>
              </label>
              <input
                id="patente"
                value={patente}
                onChange={(e) => setPatente(e.target.value.toUpperCase())}
                placeholder="ABC 123"
                className={`${INPUT} font-mono uppercase`}
                autoFocus
                required
              />
              <p className="mt-1 text-xs text-slate-400">
                Se compara sin espacios ni guiones: &quot;ABC 123&quot; y &quot;abc-123&quot; son el mismo auto.
              </p>
            </div>

            <div>
              <label className={LABEL} htmlFor="cliente">
                Cliente
              </label>
              <select
                id="cliente"
                value={clienteId}
                onChange={(e) => setClienteId(e.target.value)}
                className={INPUT}
              >
                <option value="">Sin asignar</option>
                {clientes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {clienteNombre(c)}
                  </option>
                ))}
              </select>
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
              <label className={LABEL} htmlFor="combustible">Combustible</label>
              <select
                id="combustible"
                value={combustible}
                onChange={(e) => setCombustible(e.target.value as Combustible | "")}
                className={INPUT}
              >
                <option value="">Sin especificar</option>
                {COMBUSTIBLES.map((c) => (
                  <option key={c} value={c}>
                    {COMBUSTIBLE_LABEL[c]}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className={LABEL} htmlFor="motor">Motor</label>
              <input id="motor" value={motor} onChange={(e) => setMotor(e.target.value)} placeholder="2.8 TDI" className={INPUT} />
            </div>

            <div>
              <label className={LABEL} htmlFor="color">Color</label>
              <input id="color" value={color} onChange={(e) => setColor(e.target.value)} className={INPUT} />
            </div>

            <div>
              <label className={LABEL} htmlFor="km">Kilometraje actual</label>
              <input id="km" type="number" min={0} value={km} onChange={(e) => setKm(e.target.value)} placeholder="85000" className={INPUT} />
            </div>

            <div>
              <label className={LABEL} htmlFor="vin">Chasis / VIN</label>
              <input id="vin" value={vin} onChange={(e) => setVin(e.target.value)} className={`${INPUT} font-mono`} />
            </div>

            {/* Que aceite lleva: lo primero que pregunta el mecanico cuando el
                auto entra, y lo que hoy vive en el cuaderno o en su memoria. */}
            <div className="sm:col-span-2 rounded-xl border border-[#4FAEB2]/30 bg-[#4FAEB2]/5 p-4">
              <p className="text-sm font-semibold text-slate-700">Aceite que usa</p>
              <p className="mt-0.5 text-xs text-slate-500">
                La especificación que pide el vehículo, no una marca puntual: sirve igual aunque
                cambien de proveedor.
              </p>
              <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
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
                    placeholder="7"
                    className={INPUT}
                  />
                </div>
              </div>
            </div>

            {/* ── Mantenimiento de ESTE auto ────────────────────────────────
                El servicio ya trae su intervalo ("cambio de aceite: cada 5.000
                km"). Acá se lo pisa cuando este auto va distinto: la misma
                camioneta haciendo taxi va cada 5.000 y la particular aguanta
                10.000. Vacío = manda el del servicio. */}
            <div className="sm:col-span-2 rounded-xl border border-slate-200 p-4">
              <p className="text-sm font-semibold text-slate-700">Mantenimiento y avisos</p>
              <p className="mt-0.5 text-xs leading-relaxed text-slate-500">
                Solo si este auto va distinto a lo normal. Vacío = usa lo que dice cada servicio.
              </p>
              <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div>
                  <label className={LABEL} htmlFor="intervalo_km">Cada cuántos km</label>
                  <input
                    id="intervalo_km"
                    type="number"
                    min={0}
                    step="500"
                    value={intervaloKm}
                    onChange={(e) => setIntervaloKm(e.target.value)}
                    placeholder="5000"
                    className={INPUT}
                  />
                </div>
                <div>
                  <label className={LABEL} htmlFor="intervalo_meses">Cada cuántos meses</label>
                  <input
                    id="intervalo_meses"
                    type="number"
                    min={0}
                    max={120}
                    value={intervaloMeses}
                    onChange={(e) => setIntervaloMeses(e.target.value)}
                    placeholder="6"
                    className={INPUT}
                  />
                </div>
                <div>
                  <label className={LABEL} htmlFor="avisar_dias">Avisar si no viene en</label>
                  <select
                    id="avisar_dias"
                    value={avisarDias}
                    onChange={(e) => setAvisarDias(e.target.value)}
                    className={INPUT}
                  >
                    <option value="">90 días (por defecto)</option>
                    <option value="15">15 días</option>
                    <option value="30">1 mes</option>
                    <option value="60">2 meses</option>
                    <option value="90">3 meses</option>
                    <option value="120">4 meses</option>
                    <option value="180">6 meses</option>
                    <option value="365">1 año</option>
                    <option value="0">No avisar por este auto</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="sm:col-span-2">
              <label className={LABEL} htmlFor="obs">Observaciones</label>
              <textarea id="obs" value={observaciones} onChange={(e) => setObservaciones(e.target.value)} rows={3} className={INPUT} />
            </div>
          </div>
        </div>

        {error && (
          <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
        )}

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={guardando}
            className="inline-flex items-center gap-2 rounded-xl bg-[#4FAEB2] px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[#3F8E91] disabled:opacity-60"
          >
            {guardando && <Loader2 className="h-4 w-4 animate-spin" />}
            Guardar vehículo
          </button>
          <button
            type="button"
            onClick={() => router.push("/vehiculos")}
            className="rounded-xl border border-slate-200 px-5 py-2.5 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50"
          >
            Cancelar
          </button>
        </div>
      </form>
    </div>
  );
}
