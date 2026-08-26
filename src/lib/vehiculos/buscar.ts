/**
 * Busqueda de vehiculos para el mostrador.
 *
 * Una sola caja tiene que encontrar el auto por lo que sea que el cajero
 * recuerde: la chapa, "hilux", el nombre del cliente, el color, el telefono.
 * Y tiene que aguantar como se escribe en la practica: sin tildes, con
 * mayusculas mezcladas, con la patente separada de cualquier forma y con la
 * letra de al lado en el teclado.
 *
 * Se resuelve en el cliente a proposito: la lista de vehiculos ya esta cargada
 * en la pantalla de venta, y un ida y vuelta al servidor por cada tecla haria
 * el buscador mas lento justo cuando el auto esta esperando en la vereda.
 */
import type { Vehiculo } from "./types";

/** Minusculas y sin tildes: "Camión" y "camion" son la misma palabra. */
export function normalizar(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

/**
 * Patente comparable. Ademas de sacar espacios y guiones, unifica los pares que
 * se confunden al leer una chapa sucia o al tipear rapido: O/0, I/1, S/5, B/8.
 * Asi "ABO123" encuentra "AB0123".
 */
export function patenteClave(s: string): string {
  return s
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .replace(/O/g, "0")
    .replace(/I/g, "1")
    .replace(/S/g, "5")
    .replace(/B/g, "8");
}

/**
 * Distancia de edicion acotada: cuantas letras hay que cambiar para pasar de a
 * a b. Corta apenas supera `max`, que es lo unico que interesa saber.
 */
function distancia(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const fila = [i];
    let mejor = i;
    for (let j = 1; j <= b.length; j++) {
      const costo = a[i - 1] === b[j - 1] ? 0 : 1;
      fila[j] = Math.min(fila[j - 1] + 1, prev[j] + 1, prev[j - 1] + costo);
      if (fila[j] < mejor) mejor = fila[j];
    }
    // Si toda la fila ya supera el maximo, no hay forma de bajar despues.
    if (mejor > max) return max + 1;
    prev = fila;
  }
  return prev[b.length];
}

/** Cuantos errores se toleran segun el largo: en 4 letras uno, en 8 dos. */
function tolerancia(n: number): number {
  if (n <= 3) return 0;
  if (n <= 6) return 1;
  return 2;
}

/**
 * Puntaje de un termino contra un campo.
 *   200 el campo entero coincide · 120 empieza con el termino
 *   80 lo contiene · 45 se parece salvo un par de letras
 */
function puntajeCampo(termino: string, campo: string): number {
  if (!campo) return 0;
  if (campo === termino) return 200;
  if (campo.startsWith(termino)) return 120;
  if (campo.includes(termino)) return 80;
  // El tipeo aproximado solo vale contra palabras de largo parecido: si no,
  // "a" se pareceria a todo.
  if (termino.length >= 4) {
    const t = tolerancia(termino.length);
    if (t > 0) {
      for (const palabra of campo.split(/\s+/)) {
        if (Math.abs(palabra.length - termino.length) <= t && distancia(termino, palabra, t) <= t) {
          return 45;
        }
      }
    }
  }
  return 0;
}

/** Los campos por los que se busca, con su peso. La patente manda. */
function camposDe(v: Vehiculo): { texto: string; peso: number }[] {
  return [
    { texto: normalizar(v.marca ?? ""), peso: 1 },
    { texto: normalizar(v.modelo ?? ""), peso: 1 },
    { texto: normalizar(v.cliente_nombre ?? ""), peso: 0.9 },
    { texto: normalizar(v.color ?? ""), peso: 0.6 },
    { texto: normalizar(v.motor ?? ""), peso: 0.6 },
    { texto: normalizar(v.aceite_tipo ?? ""), peso: 0.5 },
    { texto: v.anio != null ? String(v.anio) : "", peso: 0.7 },
    { texto: normalizar(v.vin ?? ""), peso: 0.8 },
  ];
}

export interface ResultadoVehiculo {
  vehiculo: Vehiculo;
  puntaje: number;
}

/**
 * Busca vehiculos. Todos los terminos tienen que dar en algo (busqueda AND):
 * "hilux blanca" trae las Hilux blancas, no todo lo que sea Hilux o blanco.
 *
 * @param limite cuantos devolver como maximo.
 */
export function buscarVehiculos(
  vehiculos: Vehiculo[],
  consulta: string,
  limite = 20
): ResultadoVehiculo[] {
  const q = consulta.trim();
  if (!q) {
    // Sin texto: los ultimos actualizados primero, que son los que se estan
    // usando. Es mas util que el orden alfabetico para el mostrador.
    return [...vehiculos]
      .sort((a, b) => (b.km_actualizado_at ?? "").localeCompare(a.km_actualizado_at ?? ""))
      .slice(0, limite)
      .map((vehiculo) => ({ vehiculo, puntaje: 0 }));
  }

  const terminos = normalizar(q).split(/\s+/).filter(Boolean);
  const clave = patenteClave(q);

  const out: ResultadoVehiculo[] = [];
  for (const v of vehiculos) {
    const campos = camposDe(v);
    const pat = patenteClave(v.patente);

    let total = 0;
    let todosDieron = true;

    for (const t of terminos) {
      const tClave = patenteClave(t);
      // La patente se evalua con su propia normalizacion, no con la de texto.
      let mejor = tClave ? puntajeCampo(tClave, pat) * 3 : 0;
      for (const c of campos) {
        const p = puntajeCampo(t, c.texto) * c.peso;
        if (p > mejor) mejor = p;
      }
      if (mejor === 0) {
        todosDieron = false;
        break;
      }
      total += mejor;
    }
    if (!todosDieron) continue;

    // La consulta completa como patente pesa aparte: escribir "abc123" de un
    // tiron tiene que ganarle a que "abc" y "123" peguen sueltos en otros lados.
    if (clave.length >= 3) total += puntajeCampo(clave, pat) * 2;

    // Un auto de baja existe pero no deberia competir con los activos.
    if (!v.activo) total *= 0.3;

    if (total > 0) out.push({ vehiculo: v, puntaje: total });
  }

  return out
    .sort((a, b) => b.puntaje - a.puntaje || a.vehiculo.patente.localeCompare(b.vehiculo.patente))
    .slice(0, limite);
}
