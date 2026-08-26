"use client";

/**
 * Foto del vehiculo: mostrar, subir y quitar.
 *
 * Una sola foto por auto, la de portada. Sirve para confirmar de un vistazo que
 * se agarro el vehiculo correcto cuando hay patentes parecidas o el mismo
 * modelo repetido.
 *
 * La URL que recibe es FIRMADA y vence: no se cachea ni se guarda, se usa y se
 * descarta. Cuando la ficha se recarga viene una nueva.
 */

import { useRef, useState } from "react";
import Image from "next/image";
import { Camera, Loader2, Trash2 } from "lucide-react";
import { quitarImagenVehiculo, subirImagenVehiculo } from "@/lib/vehiculos/storage";

export default function FotoVehiculo({
  vehiculoId,
  patente,
  imagenUrl,
  onCambio,
}: {
  vehiculoId: string;
  patente: string;
  imagenUrl: string | null | undefined;
  /** Avisa a la ficha la URL nueva (o null) para que refresque sin recargar. */
  onCambio: (url: string | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [trabajando, setTrabajando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmarBorrado, setConfirmarBorrado] = useState(false);

  async function onArchivo(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // El input se limpia siempre: sin esto, elegir el mismo archivo dos veces
    // seguidas no dispara onChange y parece que no pasa nada.
    e.target.value = "";
    if (!file) return;

    setError(null);
    setTrabajando(true);
    const r = await subirImagenVehiculo(vehiculoId, file);
    setTrabajando(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    onCambio(r.imagen_url);
  }

  async function borrar() {
    setError(null);
    setTrabajando(true);
    const r = await quitarImagenVehiculo(vehiculoId);
    setTrabajando(false);
    setConfirmarBorrado(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    onCambio(null);
  }

  return (
    <div>
      <div className="group relative aspect-[4/3] w-full overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
        {imagenUrl ? (
          <Image
            src={imagenUrl}
            alt={`Foto de ${patente}`}
            fill
            sizes="(max-width: 640px) 100vw, 320px"
            className="object-cover"
            // Las URL firmadas son de un host externo y con vencimiento: el
            // optimizador de Next no las puede procesar.
            unoptimized
          />
        ) : (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={trabajando}
            className="flex h-full w-full flex-col items-center justify-center gap-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-[#3F8E91] disabled:opacity-60"
          >
            {trabajando ? (
              <Loader2 className="h-6 w-6 animate-spin" />
            ) : (
              <>
                <Camera className="h-7 w-7" />
                <span className="text-xs font-medium">Agregar foto</span>
              </>
            )}
          </button>
        )}

        {imagenUrl && trabajando && (
          <div className="absolute inset-0 flex items-center justify-center bg-white/70">
            <Loader2 className="h-6 w-6 animate-spin text-[#3F8E91]" />
          </div>
        )}
      </div>

      {imagenUrl && (
        <div className="mt-2 flex gap-2">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={trabajando}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:border-[#4FAEB2] hover:text-[#3F8E91] disabled:opacity-60"
          >
            <Camera className="h-3.5 w-3.5" />
            Cambiar
          </button>
          {confirmarBorrado ? (
            <>
              <button
                type="button"
                onClick={borrar}
                disabled={trabajando}
                className="rounded-lg bg-red-600 px-2.5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-red-700 disabled:opacity-60"
              >
                Sí, quitar
              </button>
              <button
                type="button"
                onClick={() => setConfirmarBorrado(false)}
                className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs text-slate-500 hover:bg-slate-50"
              >
                Cancelar
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmarBorrado(true)}
              disabled={trabajando}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-500 transition-colors hover:border-red-300 hover:text-red-600 disabled:opacity-60"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Quitar
            </button>
          )}
        </div>
      )}

      {error && <p className="mt-1.5 text-xs text-red-600">{error}</p>}

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        onChange={onArchivo}
        className="hidden"
      />
    </div>
  );
}
