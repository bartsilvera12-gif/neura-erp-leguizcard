/**
 * Servicios del lubricentro.
 *
 * Un servicio son tres cosas que hasta ahora vivian en tres lugares distintos:
 *   1. un producto con tipo_producto = 'servicio' (nombre, precio, intervalo)
 *   2. una receta con los insumos que consume
 *   3. la mano de obra, que es costo del taller y no sale de ningun producto
 *
 * Esta capa las junta: crear o editar un servicio es UNA operacion. Si la UI
 * tuviera que hacer tres llamadas, un fallo en la segunda dejaria un producto
 * sin receta — un servicio que no descuenta nada y cuesta cero.
 *
 * El costo NO se calcula aca: sale de fn_receta_costeo(), que resuelve la
 * conversion de unidades, la merma y el rendimiento. Reimplementarlo en
 * TypeScript es como el costo y el consumo terminan diciendo cosas distintas.
 */
import type { AppSupabaseClient } from "@/lib/supabase/schema";

export interface InsumoServicio {
  insumo_producto_id: string;
  insumo_nombre: string;
  cantidad: number;
  unidad_medida: string | null;
  /** FRACCION, no porcentaje: 0.05 = 5%. Asi lo define el CHECK de la tabla. */
  merma_pct: number;
  costo_promedio: number;
  stock_actual: number;
  subcosto: number;
  /** La unidad del insumo no es convertible a la de la receta. */
  unidad_incompatible: boolean;
}

export interface Servicio {
  id: string;
  nombre: string;
  sku: string;
  activo: boolean;
  precio_venta: number;
  /** Costo de mano de obra: el trabajo, no los materiales. */
  mano_obra: number;
  /** NULL = el precio se escribe a mano. Con valor, se calcula sobre el costo. */
  margen_pct: number | null;
  intervalo_km: number | null;
  intervalo_meses: number | null;
  receta_id: string | null;
  /** Costo de los insumos segun la receta. */
  costo_insumos: number;
  /** mano de obra + insumos. */
  costo_total: number;
  /** Ganancia sobre el precio, en porcentaje. NULL si no hay precio. */
  margen_real: number | null;
  /** Cuantos servicios se pueden hacer con el stock actual. NULL si no aplica. */
  unidades_posibles: number | null;
  /** Algun insumo tiene una unidad que no se puede convertir. */
  tiene_unidad_incompatible: boolean;
  insumos: InsumoServicio[];
}

export interface ServicioInput {
  nombre: string;
  sku?: string | null;
  precio_venta: number;
  mano_obra: number;
  margen_pct: number | null;
  intervalo_km: number | null;
  intervalo_meses: number | null;
  activo?: boolean;
  insumos: {
    insumo_producto_id: string;
    cantidad: number;
    unidad_medida: string | null;
    merma_pct: number;
  }[];
}

const COLS =
  "id, nombre, sku, activo, precio_venta, servicio_mano_obra, precio_margen_pct, " +
  "servicio_intervalo_km, servicio_intervalo_meses";

const num = (v: unknown): number => Number(v) || 0;

/** Precio calculado cuando el servicio usa margen; si no, el que esta guardado. */
export function precioDeServicio(costoTotal: number, margenPct: number | null, precioManual: number): number {
  if (margenPct == null) return precioManual;
  return Math.round(costoTotal * (1 + margenPct / 100));
}

async function armar(
  sb: AppSupabaseClient,
  fila: Record<string, unknown>,
  recetaPorProducto: Map<string, string>
): Promise<Servicio> {
  const id = String(fila.id);
  const recetaId = recetaPorProducto.get(id) ?? null;
  const manoObra = num(fila.servicio_mano_obra);

  let costoInsumos = 0;
  let unidadesPosibles: number | null = null;
  let insumos: InsumoServicio[] = [];

  if (recetaId) {
    const { data, error } = await sb.rpc("fn_receta_costeo", { p_receta_id: recetaId });
    if (error) throw new Error(error.message);
    const c = (data ?? {}) as Record<string, unknown>;
    costoInsumos = num(c.costo_total);
    unidadesPosibles = c.unidades_posibles == null ? null : num(c.unidades_posibles);
    insumos = ((c.items ?? []) as Record<string, unknown>[]).map((i) => ({
      insumo_producto_id: String(i.insumo_producto_id),
      insumo_nombre: String(i.insumo_nombre ?? ""),
      cantidad: num(i.cantidad),
      unidad_medida: (i.unidad_medida as string | null) ?? null,
      merma_pct: num(i.merma_pct),
      costo_promedio: num(i.costo_promedio),
      stock_actual: num(i.stock_actual),
      subcosto: num(i.subcosto),
      unidad_incompatible: i.unidad_incompatible === true,
    }));
  }

  const costoTotal = manoObra + costoInsumos;
  const margenPct = fila.precio_margen_pct == null ? null : num(fila.precio_margen_pct);
  const precio = precioDeServicio(costoTotal, margenPct, num(fila.precio_venta));

  return {
    id,
    nombre: String(fila.nombre ?? ""),
    sku: String(fila.sku ?? ""),
    activo: fila.activo !== false,
    precio_venta: precio,
    mano_obra: manoObra,
    margen_pct: margenPct,
    intervalo_km: fila.servicio_intervalo_km == null ? null : num(fila.servicio_intervalo_km),
    intervalo_meses: fila.servicio_intervalo_meses == null ? null : num(fila.servicio_intervalo_meses),
    receta_id: recetaId,
    costo_insumos: costoInsumos,
    costo_total: costoTotal,
    margen_real: precio > 0 ? Math.round(((precio - costoTotal) / precio) * 100) : null,
    unidades_posibles: unidadesPosibles,
    tiene_unidad_incompatible: insumos.some((i) => i.unidad_incompatible),
    insumos,
  };
}

async function mapaRecetas(sb: AppSupabaseClient, empresaId: string, productoIds: string[]) {
  const m = new Map<string, string>();
  if (!productoIds.length) return m;
  const { data, error } = await sb
    .from("recetas")
    .select("id, producto_id")
    .eq("empresa_id", empresaId)
    .in("producto_id", productoIds);
  if (error) throw new Error(error.message);
  for (const r of (data ?? []) as unknown as { id: string; producto_id: string }[]) {
    m.set(String(r.producto_id), String(r.id));
  }
  return m;
}

export async function listServicios(sb: AppSupabaseClient, empresaId: string): Promise<Servicio[]> {
  const { data, error } = await sb
    .from("productos")
    .select(COLS)
    .eq("empresa_id", empresaId)
    .eq("tipo_producto", "servicio")
    .order("nombre");
  if (error) throw new Error(error.message);
  const filas = (data ?? []) as unknown as Record<string, unknown>[];
  const recetas = await mapaRecetas(sb, empresaId, filas.map((f) => String(f.id)));
  return Promise.all(filas.map((f) => armar(sb, f, recetas)));
}

export async function getServicio(
  sb: AppSupabaseClient,
  empresaId: string,
  id: string
): Promise<Servicio | null> {
  const { data, error } = await sb
    .from("productos")
    .select(COLS)
    .eq("empresa_id", empresaId)
    .eq("id", id)
    .eq("tipo_producto", "servicio")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const fila = data as unknown as Record<string, unknown>;
  const recetas = await mapaRecetas(sb, empresaId, [id]);
  return armar(sb, fila, recetas);
}

/** Campos del producto que definen al servicio. */
function payloadProducto(input: ServicioInput) {
  return {
    nombre: input.nombre.trim(),
    tipo_producto: "servicio" as const,
    // Un servicio no tiene stock propio: lo que se consume son sus insumos.
    controla_stock: false,
    es_vendible: true,
    unidad_medida: "UNIDAD",
    precio_venta: input.precio_venta,
    servicio_mano_obra: input.mano_obra,
    precio_margen_pct: input.margen_pct,
    servicio_intervalo_km: input.intervalo_km,
    servicio_intervalo_meses: input.intervalo_meses,
    activo: input.activo !== false,
  };
}

/**
 * Reemplaza los insumos de la receta. Se borra y se vuelve a insertar en vez de
 * comparar item por item: la lista es corta y el diff seria mas codigo con mas
 * formas de salir mal que ganancia.
 */
async function guardarInsumos(
  sb: AppSupabaseClient,
  empresaId: string,
  recetaId: string,
  insumos: ServicioInput["insumos"]
) {
  const del = await sb.from("receta_items").delete().eq("receta_id", recetaId);
  if (del.error) throw new Error(del.error.message);
  if (!insumos.length) return;
  const ins = await sb.from("receta_items").insert(
    insumos.map((i, orden) => ({
      empresa_id: empresaId,
      receta_id: recetaId,
      insumo_producto_id: i.insumo_producto_id,
      cantidad: i.cantidad,
      unidad_medida: i.unidad_medida,
      merma_pct: i.merma_pct,
      orden,
    }))
  );
  if (ins.error) throw new Error(ins.error.message);
}

export async function crearServicio(
  sb: AppSupabaseClient,
  empresaId: string,
  input: ServicioInput
): Promise<Servicio> {
  const prod = await sb
    .from("productos")
    .insert({
      empresa_id: empresaId,
      ...payloadProducto(input),
      sku: input.sku?.trim() || `SRV-${Date.now().toString(36).toUpperCase()}`,
    })
    .select("id")
    .single();
  if (prod.error) throw new Error(prod.error.message);
  const productoId = String((prod.data as { id: string }).id);

  // La receta se crea siempre, aunque todavia no tenga insumos: asi editar el
  // servicio despues es agregar items y no descubrir que falta la receta.
  const rec = await sb
    .from("recetas")
    .insert({
      empresa_id: empresaId,
      producto_id: productoId,
      nombre: input.nombre.trim(),
      rendimiento_cantidad: 1,
      activa: true,
    })
    .select("id")
    .single();
  if (rec.error) throw new Error(rec.error.message);

  await guardarInsumos(sb, empresaId, String((rec.data as { id: string }).id), input.insumos);

  const creado = await getServicio(sb, empresaId, productoId);
  if (!creado) throw new Error("No se pudo leer el servicio recién creado.");
  return creado;
}

export async function actualizarServicio(
  sb: AppSupabaseClient,
  empresaId: string,
  id: string,
  input: ServicioInput
): Promise<Servicio | null> {
  const upd = await sb
    .from("productos")
    .update(payloadProducto(input))
    .eq("empresa_id", empresaId)
    .eq("id", id)
    .eq("tipo_producto", "servicio")
    .select("id")
    .maybeSingle();
  if (upd.error) throw new Error(upd.error.message);
  if (!upd.data) return null;

  const recetas = await mapaRecetas(sb, empresaId, [id]);
  let recetaId = recetas.get(id) ?? null;
  if (!recetaId) {
    // Un servicio viejo puede no tener receta todavia.
    const rec = await sb
      .from("recetas")
      .insert({
        empresa_id: empresaId,
        producto_id: id,
        nombre: input.nombre.trim(),
        rendimiento_cantidad: 1,
        activa: true,
      })
      .select("id")
      .single();
    if (rec.error) throw new Error(rec.error.message);
    recetaId = String((rec.data as { id: string }).id);
  }
  await guardarInsumos(sb, empresaId, recetaId, input.insumos);

  return getServicio(sb, empresaId, id);
}

/**
 * Baja logica. No se borra: las ventas historicas apuntan al producto y perder
 * el nombre arruinaria el historial de los vehiculos que recibieron ese
 * servicio.
 */
export async function desactivarServicio(
  sb: AppSupabaseClient,
  empresaId: string,
  id: string
): Promise<boolean> {
  const { data, error } = await sb
    .from("productos")
    .update({ activo: false })
    .eq("empresa_id", empresaId)
    .eq("id", id)
    .eq("tipo_producto", "servicio")
    .select("id")
    .maybeSingle();
  if (error) throw new Error(error.message);
  return !!data;
}
