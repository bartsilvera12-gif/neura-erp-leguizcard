/**
 * Trae TODAS las filas de una consulta PostgREST, sin tope.
 *
 * PostgREST nunca devuelve todo de una: el servidor tiene su propio techo
 * (`db-max-rows`) y recorta en silencio, sin error. Por eso no alcanza con
 * sacar el `.limit()` de la consulta: hay que pedir por tramos con `range`
 * hasta que un tramo vuelva vacio.
 *
 * Se recibe una FUNCION que arma la consulta, no la consulta ya armada: el
 * builder de supabase-js se consume al esperarlo, asi que cada tramo necesita
 * uno nuevo.
 *
 *   const filas = await traerTodo<Fila>((desde, hasta) =>
 *     sb.from("ventas").select(COLS).eq("empresa_id", id).order("fecha").range(desde, hasta)
 *   );
 *
 * El orden tiene que ser DETERMINISTA (incluir algo unico, o al menos estable)
 * o dos tramos pueden traer la misma fila y perderse otra.
 */

type Tramo<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>;

/** Cuantas filas por viaje. Si el servidor da menos, se avanza por lo que dio. */
const LOTE = 1000;

export async function traerTodo<T>(
  pedir: (desde: number, hasta: number) => Tramo<T>,
  lote: number = LOTE
): Promise<T[]> {
  const todo: T[] = [];

  for (;;) {
    const { data, error } = await pedir(todo.length, todo.length + lote - 1);
    if (error) throw new Error(error.message);
    const filas = data ?? [];
    // Se avanza por lo que REALMENTE vino, no por lo que se pidio: si el techo
    // del servidor es menor al lote, recorta el tramo y avanzar de a `lote`
    // saltearia las filas del medio sin que nadie se entere.
    todo.push(...filas);
    if (filas.length === 0) return todo;
  }
}
