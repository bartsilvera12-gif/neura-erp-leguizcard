import type { AppSupabaseClient } from "@/lib/supabase/schema";
import { calcMontoIvaIncluido, type IvaTipoPresupuesto, type CondicionPresupuesto } from "@/lib/presupuestos/types";

/** Item crudo que llega del cliente; los totales se recalculan en el server. */
export interface PresupuestoItemInput {
  producto_id: string | null;
  producto_nombre: string;
  sku: string | null;
  cantidad: number;
  unidad_medida: string | null;
  precio_unitario: number;
  iva_tipo: IvaTipoPresupuesto;
  descuento: number;
  /**
   * Costo estimado por unidad (repuestos + mano de obra), para ver el margen del
   * trabajo antes de cerrarlo. Es interno: no se muestra en el PDF del cliente.
   */
  costo_unitario?: number | null;
}

export interface CrearPresupuestoInput {
  cliente_id: string | null;
  cliente_nombre: string;
  cliente_ruc: string | null;
  cliente_telefono: string | null;
  cliente_direccion: string | null;
  moneda: string;
  validez_dias: number | null;
  condicion: CondicionPresupuesto;
  forma_pago: string | null;
  plazo_entrega: string | null;
  observaciones: string | null;
  items: PresupuestoItemInput[];
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Calcula los totales de un ítem (precio IVA-incluido, descuento absoluto por línea). */
export function calcularItem(it: PresupuestoItemInput) {
  const cantidad = Number(it.cantidad) || 0;
  const precio = Number(it.precio_unitario) || 0;
  const descuento = Math.max(0, Number(it.descuento) || 0);
  const bruto = precio * cantidad;
  const total = Math.max(0, bruto - descuento);
  const montoIva = round2(calcMontoIvaIncluido(it.iva_tipo, total));
  const subtotal = round2(total - montoIva);
  return {
    cantidad,
    precio_unitario: precio,
    descuento: round2(descuento),
    subtotal,
    monto_iva: montoIva,
    total: round2(total),
  };
}

/**
 * Corrige precio, cantidad y descuento de los items de un presupuesto, y
 * recalcula sus totales.
 *
 * Solo toca los items que llegan, por id: lo que no viene queda como estaba.
 * Un presupuesto ya convertido no se toca — cambiarle el precio despues de
 * haberlo pasado a caja dejaria el pedido diciendo una cosa y el presupuesto
 * otra.
 */
export async function actualizarItemsPresupuesto(
  sb: AppSupabaseClient,
  empresaId: string,
  presupuestoId: string,
  cambios: { id: string; precio_unitario?: number; cantidad?: number; descuento?: number }[]
): Promise<void> {
  const pq = await sb
    .from("presupuestos")
    .select("estado")
    .eq("empresa_id", empresaId)
    .eq("id", presupuestoId)
    .maybeSingle();
  if (pq.error) throw new Error(pq.error.message);
  if (!pq.data) throw new Error("Presupuesto no encontrado.");
  if ((pq.data as { estado: string }).estado === "convertido") {
    throw new Error("El presupuesto ya pasó a caja: no se pueden cambiar sus precios.");
  }

  const itq = await sb
    .from("presupuesto_items")
    .select("id, cantidad, precio_unitario, descuento, iva_tipo")
    .eq("empresa_id", empresaId)
    .eq("presupuesto_id", presupuestoId);
  if (itq.error) throw new Error(itq.error.message);
  const items = (itq.data ?? []) as unknown as Record<string, unknown>[];
  if (!items.length) throw new Error("El presupuesto no tiene ítems.");

  const porId = new Map(cambios.map((c) => [c.id, c]));

  let subtotal = 0;
  let montoIva = 0;
  let total = 0;
  let descuentoTotal = 0;

  for (const it of items) {
    const id = String(it.id);
    const c = porId.get(id);
    const calc = calcularItem({
      producto_id: "",
      producto_nombre: "",
      sku: null,
      unidad_medida: null,
      cantidad: c?.cantidad ?? Number(it.cantidad),
      precio_unitario: c?.precio_unitario ?? Number(it.precio_unitario),
      descuento: c?.descuento ?? Number(it.descuento),
      iva_tipo: it.iva_tipo as PresupuestoItemInput["iva_tipo"],
    });

    subtotal += calc.subtotal;
    montoIva += calc.monto_iva;
    total += calc.total;
    descuentoTotal += calc.descuento;

    // Solo se escribe lo que cambio: un UPDATE por item que no se toco es
    // ruido en la base y en cualquier auditoria futura.
    if (!c) continue;
    const upd = await sb
      .from("presupuesto_items")
      .update({
        cantidad: calc.cantidad,
        precio_unitario: calc.precio_unitario,
        descuento: calc.descuento,
        subtotal: calc.subtotal,
        monto_iva: calc.monto_iva,
        total: calc.total,
      })
      .eq("empresa_id", empresaId)
      .eq("presupuesto_id", presupuestoId)
      .eq("id", id);
    if (upd.error) throw new Error(upd.error.message);
  }

  const updP = await sb
    .from("presupuestos")
    .update({
      subtotal: round2(subtotal),
      monto_iva: round2(montoIva),
      total: round2(total),
      descuento_total: round2(descuentoTotal),
      updated_at: new Date().toISOString(),
    })
    .eq("empresa_id", empresaId)
    .eq("id", presupuestoId);
  if (updP.error) throw new Error(updP.error.message);
}

/** Próximo número de control PRE-XXXXXX (best-effort, puede haber carrera multi-usuario). */
export async function siguienteNumeroControl(
  sb: AppSupabaseClient,
  empresaId: string
): Promise<string> {
  const { data, error } = await sb
    .from("presupuestos")
    .select("numero_control")
    .eq("empresa_id", empresaId)
    .like("numero_control", "PRE-%")
    .order("numero_control", { ascending: false })
    .limit(1);
  if (error) throw new Error(error.message);
  let next = 1;
  const last = (data?.[0] as { numero_control?: string } | undefined)?.numero_control;
  if (last) {
    const m = last.match(/^PRE-(\d+)$/);
    if (m) next = parseInt(m[1], 10) + 1;
  }
  return `PRE-${String(next).padStart(6, "0")}`;
}

/**
 * Crea un presupuesto + ítems. Recalcula TODOS los totales en el server (no confía en
 * los del cliente). NO toca stock. Rollback best-effort si falla la inserción de ítems.
 */
export async function crearPresupuesto(
  sb: AppSupabaseClient,
  empresaId: string,
  input: CrearPresupuestoInput
): Promise<{ id: string; numero_control: string }> {
  if (!input.items || input.items.length === 0) {
    throw new Error("El presupuesto debe tener al menos un ítem.");
  }
  if (!input.cliente_nombre || !input.cliente_nombre.trim()) {
    throw new Error("El nombre del cliente es obligatorio.");
  }

  // Recalcular ítems y totales del presupuesto.
  const calculados = input.items.map((it) => ({ raw: it, calc: calcularItem(it) }));
  let subtotal = 0;
  let montoIva = 0;
  let descuentoTotal = 0;
  let total = 0;
  for (const { calc } of calculados) {
    subtotal += calc.subtotal;
    montoIva += calc.monto_iva;
    descuentoTotal += calc.descuento;
    total += calc.total;
  }

  const numero = await siguienteNumeroControl(sb, empresaId);
  const fechaIso = new Date().toISOString();
  let vencimiento: string | null = null;
  if (input.validez_dias && input.validez_dias > 0) {
    const d = new Date();
    d.setDate(d.getDate() + input.validez_dias);
    vencimiento = d.toISOString().slice(0, 10);
  }

  const ins = await sb
    .from("presupuestos")
    .insert({
      empresa_id: empresaId,
      cliente_id: input.cliente_id,
      cliente_nombre: input.cliente_nombre.trim(),
      cliente_ruc: input.cliente_ruc?.trim() || null,
      cliente_telefono: input.cliente_telefono?.trim() || null,
      cliente_direccion: input.cliente_direccion?.trim() || null,
      numero_control: numero,
      estado: "creado",
      moneda: input.moneda || "PYG",
      subtotal: round2(subtotal),
      monto_iva: round2(montoIva),
      descuento_total: round2(descuentoTotal),
      total: round2(total),
      validez_dias: input.validez_dias ?? null,
      fecha: fechaIso,
      fecha_vencimiento: vencimiento,
      condicion: input.condicion === "credito" ? "credito" : "contado",
      forma_pago: input.forma_pago?.trim() || null,
      plazo_entrega: input.plazo_entrega?.trim() || null,
      observaciones: input.observaciones?.trim() || null,
    })
    .select("id, numero_control")
    .single();
  if (ins.error) throw new Error(ins.error.message);
  const presupuestoId = String((ins.data as { id: string }).id);

  const itemsRows = calculados.map(({ raw, calc }) => ({
    empresa_id: empresaId,
    presupuesto_id: presupuestoId,
    producto_id: raw.producto_id,
    producto_nombre: raw.producto_nombre,
    sku: raw.sku,
    cantidad: calc.cantidad,
    unidad_medida: raw.unidad_medida,
    precio_unitario: calc.precio_unitario,
    iva_tipo: raw.iva_tipo,
    subtotal: calc.subtotal,
    monto_iva: calc.monto_iva,
    descuento: calc.descuento,
    total: calc.total,
    costo_unitario:
      raw.costo_unitario == null || !Number.isFinite(Number(raw.costo_unitario))
        ? null
        : Math.max(0, Number(raw.costo_unitario)),
  }));
  const insItems = await sb.from("presupuesto_items").insert(itemsRows);
  if (insItems.error) {
    // Rollback best-effort de la cabecera para no dejar un presupuesto sin ítems.
    try {
      await sb.from("presupuestos").delete().eq("id", presupuestoId).eq("empresa_id", empresaId);
    } catch {}
    throw new Error(insItems.error.message);
  }

  return { id: presupuestoId, numero_control: numero };
}

/**
 * Convierte un presupuesto APROBADO en un pedido (proyecto tipo 'pedido', estado inicial 'nuevo').
 * NO descuenta stock (el pedido aún no está confirmado). Evita doble conversión.
 * Devuelve el id del proyecto/pedido creado.
 */
export async function convertirEnPedido(
  sb: AppSupabaseClient,
  empresaId: string,
  presupuestoId: string
): Promise<{ pedido_id: string }> {
  // Cargar presupuesto + ítems.
  const pq = await sb
    .from("presupuestos")
    .select("*")
    .eq("empresa_id", empresaId)
    .eq("id", presupuestoId)
    .maybeSingle();
  if (pq.error) throw new Error(pq.error.message);
  if (!pq.data) throw new Error("Presupuesto no encontrado.");
  const p = pq.data as Record<string, unknown>;

  if (p.estado === "convertido" || p.convertido_pedido_id) {
    throw new Error("Este presupuesto ya fue convertido en pedido.");
  }
  if (p.estado !== "aprobado") {
    throw new Error("Solo se puede convertir un presupuesto en estado 'aprobado'.");
  }

  const itq = await sb
    .from("presupuesto_items")
    .select("*")
    .eq("empresa_id", empresaId)
    .eq("presupuesto_id", presupuestoId);
  if (itq.error) throw new Error(itq.error.message);
  const items = (itq.data ?? []) as Record<string, unknown>[];

  // Resolver tipo 'pedido' + estado inicial 'nuevo'.
  const tipoQ = await sb
    .from("proyecto_tipos")
    .select("id")
    .eq("empresa_id", empresaId)
    .eq("codigo", "pedido")
    .eq("activo", true)
    .limit(1)
    .maybeSingle();
  if (tipoQ.error) throw new Error(tipoQ.error.message);
  if (!tipoQ.data) throw new Error("Tipo de proyecto 'pedido' no configurado para esta empresa.");
  const tipoId = (tipoQ.data as { id: string }).id;

  const estadoQ = await sb
    .from("proyecto_estados")
    .select("id")
    .eq("empresa_id", empresaId)
    .eq("codigo", "nuevo")
    .eq("activo", true)
    .limit(1)
    .maybeSingle();
  if (estadoQ.error) throw new Error(estadoQ.error.message);
  if (!estadoQ.data) throw new Error("Estado 'nuevo' no configurado para esta empresa.");
  const estadoId = (estadoQ.data as { id: string }).id;

  const fechaIso = new Date().toISOString();
  const itemsSnapshot = items.map((it) => ({
    producto_id: it.producto_id,
    producto_nombre: it.producto_nombre,
    sku: it.sku,
    cantidad: Number(it.cantidad),
    precio_venta: Number(it.precio_unitario),
    total_linea: Number(it.total),
  }));

  const titulo = `Pedido desde ${String(p.numero_control)} · ${String(p.cliente_nombre)}`.slice(0, 200);

  const insProy = await sb
    .from("proyectos")
    .insert({
      empresa_id: empresaId,
      cliente_id: p.cliente_id ?? null,
      tipo_id: tipoId,
      estado_id: estadoId,
      titulo,
      prioridad: "normal",
      monto_vendido: Number(p.total) || 0,
      fecha_ingreso: fechaIso,
      observaciones_comerciales: p.observaciones ?? null,
      brief_data: {
        origen: "presupuesto",
        presupuesto_id: presupuestoId,
        numero_presupuesto: p.numero_control,
        cliente_nombre: p.cliente_nombre,
        cliente_ruc: p.cliente_ruc,
        cliente_telefono: p.cliente_telefono,
        cliente_direccion: p.cliente_direccion,
        forma_pago: p.forma_pago,
        plazo_entrega: p.plazo_entrega,
        observaciones: p.observaciones,
        items: itemsSnapshot,
        total: Number(p.total) || 0,
      },
      metadata: {
        source: "presupuesto",
        presupuesto_id: presupuestoId,
        numero_presupuesto: p.numero_control,
        // Con esto el pedido cae en la cola de caja (Ventas > Pedidos
        // pendientes), que es la que lo abre en el carrito para cobrarlo.
        // Sin esta marca el pedido se creaba y no lo veia nadie: el
        // presupuesto aprobado quedaba a mitad de camino.
        facturacion_estado: "pendiente_caja",
      },
    })
    .select("id")
    .single();
  if (insProy.error) throw new Error(insProy.error.message);
  const pedidoId = String((insProy.data as { id: string }).id);

  // Marcar presupuesto como convertido (idempotencia: si otro proceso ya lo marcó, no duplica pedido relevante).
  const upd = await sb
    .from("presupuestos")
    .update({ estado: "convertido", convertido_pedido_id: pedidoId, updated_at: fechaIso })
    .eq("empresa_id", empresaId)
    .eq("id", presupuestoId);
  if (upd.error) {
    // Rollback del proyecto creado para no dejar un pedido huérfano sin marca de conversión.
    try {
      await sb.from("proyectos").delete().eq("id", pedidoId).eq("empresa_id", empresaId);
    } catch {}
    throw new Error(upd.error.message);
  }

  return { pedido_id: pedidoId };
}
