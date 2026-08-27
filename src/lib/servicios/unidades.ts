/**
 * Conversion de unidades, del lado de la pantalla.
 *
 * Es el espejo de `fn_unidad_familia` / `fn_unidad_factor` (migracion 0016).
 * El numero firme siempre lo calcula el servidor; esto existe para que la
 * cuenta que se ve MIENTRAS se edita sea la misma, y no la que salia antes:
 * 7,5 L de un aceite que se compra por galon se multiplicaban por el precio
 * del galon y el servicio aparecia perdiendo plata.
 *
 * Si se toca la tabla de alla, hay que tocar esta. Estan separadas porque una
 * corre en Postgres y la otra en el navegador, no porque digan cosas distintas.
 */

export type Familia = "peso" | "volumen" | "conteo";

/** Unidad normalizada -> [familia, cuanto vale en la base de su familia]. */
const TABLA: Record<string, [Familia, number]> = {
  // Peso, base gramo.
  G: ["peso", 1], GR: ["peso", 1], GRS: ["peso", 1],
  GRAMO: ["peso", 1], GRAMOS: ["peso", 1],
  KG: ["peso", 1000], KILO: ["peso", 1000], KILOS: ["peso", 1000],
  KILOGRAMO: ["peso", 1000],
  // Volumen, base mililitro.
  ML: ["volumen", 1], CC: ["volumen", 1],
  L: ["volumen", 1000], LT: ["volumen", 1000], LTS: ["volumen", 1000],
  LITRO: ["volumen", 1000], LITROS: ["volumen", 1000],
  // Galon estadounidense: el que se usa para aceite en Paraguay.
  GALON: ["volumen", 3785.41], GALONES: ["volumen", 3785.41], GL: ["volumen", 3785.41],
  // Conteo, base unidad.
  UNIDAD: ["conteo", 1], UNIDADES: ["conteo", 1],
  UNID: ["conteo", 1], U: ["conteo", 1], UN: ["conteo", 1],
};

export function normalizar(u: string | null | undefined): string {
  return (u ?? "").trim().toUpperCase();
}

export function familiaDe(u: string | null | undefined): Familia | null {
  return TABLA[normalizar(u)]?.[0] ?? null;
}

export function factorDe(u: string | null | undefined): number | null {
  return TABLA[normalizar(u)]?.[1] ?? null;
}

/** Las unidades que se pueden escribir para un insumo que se compra en `unidadProducto`. */
export function unidadesCompatibles(unidadProducto: string | null | undefined): string[] {
  const fam = familiaDe(unidadProducto);
  if (!fam) return [];
  // Una sola forma por unidad real: ofrecer L, LT, LTS y LITRO es ruido.
  const CANONICAS: Record<Familia, string[]> = {
    peso: ["G", "KG"],
    volumen: ["ML", "L", "GALON"],
    conteo: ["UNIDAD"],
  };
  const canon = CANONICAS[fam];
  const propia = normalizar(unidadProducto);
  return canon.includes(propia) ? canon : [propia, ...canon];
}

/**
 * Cuanto se consume del insumo, en la unidad en que el insumo se compra.
 * `null` = las unidades no se pueden convertir entre si: no se costea ni se
 * descuenta, y hay que avisarlo en pantalla en vez de mostrar un cero.
 */
export function cantidadEnUnidadDelProducto(
  cantidad: number,
  unidadEscrita: string | null | undefined,
  unidadProducto: string | null | undefined
): number | null {
  const uItem = normalizar(unidadEscrita) || normalizar(unidadProducto);
  const uProd = normalizar(unidadProducto);
  const fItem = factorDe(uItem);
  const fProd = factorDe(uProd);
  if (fItem == null || fProd == null || fProd <= 0) return null;
  if (familiaDe(uItem) !== familiaDe(uProd)) return null;
  return (cantidad * fItem) / fProd;
}
