/**
 * Vehiculos del cliente — base del seguimiento del lubricentro.
 *
 * Un lubricentro atiende AUTOS, no clientes: el historial de servicios y el
 * aviso de proximo cambio cuelgan del vehiculo. Un cliente puede tener varios.
 *
 * La patente es el identificador operativo y es unica por empresa, comparada de
 * forma normalizada (sin mayusculas/minusculas, espacios ni guiones) para que
 * "ABC 123" y "abc-123" no entren dos veces.
 */

export const COMBUSTIBLES = ["nafta", "diesel", "gnv", "electrico", "hibrido", "otro"] as const;
export type Combustible = (typeof COMBUSTIBLES)[number];

export const COMBUSTIBLE_LABEL: Record<Combustible, string> = {
  nafta: "Nafta",
  diesel: "Diésel",
  gnv: "GNV",
  electrico: "Eléctrico",
  hibrido: "Híbrido",
  otro: "Otro",
};

export interface Vehiculo {
  id: string;
  empresa_id: string;
  cliente_id: string | null;
  /** Nombre del cliente, resuelto por join. Solo lectura. */
  cliente_nombre: string | null;
  patente: string;
  marca: string | null;
  modelo: string | null;
  anio: number | null;
  motor: string | null;
  combustible: Combustible | null;
  vin: string | null;
  color: string | null;
  km_actual: number | null;
  km_actualizado_at: string | null;
  observaciones: string | null;
  activo: boolean;
  created_at: string;
  updated_at: string;
}

export interface NuevoVehiculoInput {
  cliente_id?: string | null;
  patente: string;
  marca?: string | null;
  modelo?: string | null;
  anio?: number | null;
  motor?: string | null;
  combustible?: Combustible | null;
  vin?: string | null;
  color?: string | null;
  km_actual?: number | null;
  observaciones?: string | null;
  activo?: boolean;
}

/** Una atencion del vehiculo: la venta que la registro. */
/** Una linea de la atencion: el servicio hecho, o el insumo que consumio. */
export interface ItemServicioVehiculo {
  producto_id: string | null;
  producto_nombre: string;
  sku: string | null;
  marca: string | null;
  cantidad: number;
  unidad_medida: string | null;
  presentacion_nombre: string | null;
  total_linea: number;
  es_servicio: boolean;
}

export interface ServicioVehiculo {
  venta_id: string;
  numero_control: string;
  fecha: string;
  estado: string;
  total: number;
  km_registrado: number | null;
  /** Km recorridos desde la visita anterior. NULL si falta alguna lectura. */
  km_recorridos: number | null;
  /** Lo que anoto el taller en la venta. */
  observaciones: string | null;
  items: ItemServicioVehiculo[];
}

/** Cuando toca el proximo de un servicio, para ESTE vehiculo. */
export interface EstadoServicioVehiculo {
  producto_id: string;
  servicio_nombre: string;
  intervalo_km: number | null;
  intervalo_meses: number | null;
  ultima_fecha: string;
  ultimo_km: number | null;
  proximo_km: number | null;
  proxima_fecha: string | null;
  km_restantes: number | null;
  dias_restantes: number | null;
  vencido: boolean;
}

/**
 * Normaliza una patente para comparar: mayusculas y sin nada que no sea
 * alfanumerico. Debe coincidir con el indice unico de la tabla
 * (`ux_vehiculos_empresa_patente`).
 */
export function normalizarPatente(patente: string): string {
  return patente.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** Formato de presentacion: se conserva tal cual la cargo el usuario. */
export function formatVehiculo(v: Pick<Vehiculo, "patente" | "marca" | "modelo">): string {
  const desc = [v.marca, v.modelo].filter(Boolean).join(" ");
  return desc ? `${v.patente} — ${desc}` : v.patente;
}

/**
 * Un servicio que le toca (o le tocaba) a un vehiculo.
 * Vence por kilometraje o por tiempo, lo que ocurra primero.
 */
export interface ProximoServicio {
  vehiculo_id: string;
  patente: string;
  marca: string | null;
  modelo: string | null;
  cliente_id: string | null;
  cliente_nombre: string | null;
  cliente_telefono: string | null;
  km_actual: number | null;
  producto_id: string;
  servicio_nombre: string;
  intervalo_km: number | null;
  intervalo_meses: number | null;
  /** Ultima vez que se le hizo este servicio. */
  ultima_fecha: string;
  ultimo_km: number | null;
  proximo_km: number | null;
  proxima_fecha: string | null;
  /** Negativo = ya se paso. */
  km_restantes: number | null;
  /** Negativo = ya se paso. */
  dias_restantes: number | null;
  vencido: boolean;
}
