import { NextRequest, NextResponse } from "next/server";
import { getUserAndEmpresa } from "@/lib/middleware/auth";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { createVentaTransaccionalPg } from "@/lib/ventas/server/create-venta-pg";
import { getAuthWithRol } from "@/lib/middleware/auth";
import type { CreateVentaItemInput } from "@/lib/ventas/server/create-venta-pg";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import type { Venta, LineaVenta } from "@/lib/ventas/types";

/**
 * Ajustes de insumos de una linea de servicio. Se queda con lo que tiene forma
 * de ajuste y descarta el resto: un ajuste mal formado no puede tumbar la venta
 * entera, y sin ajuste manda la receta, que es el comportamiento de siempre.
 */
function asInsumos(raw: unknown): { insumo_producto_id: string; cantidad: number }[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const out: { insumo_producto_id: string; cantidad: number }[] = [];
  for (const x of raw) {
    if (!x || typeof x !== "object") continue;
    const r = x as Record<string, unknown>;
    const id = String(r.insumo_producto_id ?? "");
    const cant = Number(r.cantidad);
    if (!id || !Number.isFinite(cant) || cant < 0) continue;
    out.push({ insumo_producto_id: id, cantidad: cant });
  }
  return out.length ? out : null;
}

function asItems(body: unknown): CreateVentaItemInput[] | null {
  if (!body || typeof body !== "object") return null;
  const raw = (body as { items?: unknown }).items;
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const out: CreateVentaItemInput[] = [];
  for (const x of raw) {
    if (!x || typeof x !== "object") return null;
    const r = x as Record<string, unknown>;
    const tipoIva = r.tipo_iva;
    if (tipoIva !== "EXENTA" && tipoIva !== "5%" && tipoIva !== "10%") return null;
    const vehLinea = r.vehiculo_id;
    out.push({
      producto_id: String(r.producto_id ?? ""),
      vehiculo_id:
        vehLinea === null || vehLinea === undefined || vehLinea === "" ? null : String(vehLinea),
      producto_nombre: String(r.producto_nombre ?? ""),
      sku: String(r.sku ?? ""),
      cantidad: Number(r.cantidad),
      precio_venta_original: Number(r.precio_venta_original),
      precio_venta: Number(r.precio_venta),
      tipo_iva: tipoIva,
      subtotal: Number(r.subtotal),
      monto_iva: Number(r.monto_iva),
      total_linea: Number(r.total_linea),
      insumos: asInsumos(r.insumos),
    });
  }
  if (out.some((i) => !(i.cantidad > 0))) return null;
  // Toda línea tiene que apuntar a un producto del catálogo.
  if (out.some((i) => !i.producto_id)) return null;
  return out;
}

function toVentaResponse(
  items: CreateVentaItemInput[],
  meta: {
    id: string;
    numero_control: string;
    fechaIso: string;
    moneda: Venta["moneda"];
    tipo_cambio: number;
    tipo_venta: Venta["tipo_venta"];
    plazo_dias?: number;
    metodo_pago?: Venta["metodo_pago"];
    subtotal: number;
    monto_iva: number;
    total: number;
  }
): Venta {
  const lineas: LineaVenta[] = items.map((i) => ({
    producto_id: i.producto_id,
    producto_nombre: i.producto_nombre,
    sku: i.sku,
    cantidad: i.cantidad,
    precio_venta_original: i.precio_venta_original,
    precio_venta: i.precio_venta,
    tipo_iva: i.tipo_iva,
    subtotal: i.subtotal,
    monto_iva: i.monto_iva,
    total_linea: i.total_linea,
  }));
  return {
    id: meta.id,
    numero_control: meta.numero_control,
    items: lineas,
    moneda: meta.moneda,
    tipo_cambio: meta.tipo_cambio,
    subtotal: meta.subtotal,
    monto_iva: meta.monto_iva,
    total: meta.total,
    tipo_venta: meta.tipo_venta,
    plazo_dias: meta.plazo_dias,
    metodo_pago: meta.metodo_pago,
    fecha: meta.fechaIso,
  };
}

/**
 * POST /api/ventas/create — venta + ítems + stock + movimientos (una transacción Postgres).
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await getUserAndEmpresa(request);
    if (!auth) {
      return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(errorResponse("JSON inválido."), { status: 400 });
    }

    const items = asItems(body);
    if (!items) {
      return NextResponse.json(errorResponse("Payload inválido: items requeridos."), { status: 400 });
    }

    const o = body as Record<string, unknown>;
    const moneda = o.moneda === "USD" ? "USD" : "GS";
    const tipoCambio = Number(o.tipo_cambio) || 1;
    const tipoVenta = o.tipo_venta === "CREDITO" ? "CREDITO" : "CONTADO";
    const plazoDias =
      tipoVenta === "CREDITO" && o.plazo_dias != null && String(o.plazo_dias).trim() !== ""
        ? parseInt(String(o.plazo_dias), 10)
        : null;
    const metodoPago: "efectivo" | "tarjeta" | "transferencia" =
      o.metodo_pago === "tarjeta" || o.metodo_pago === "transferencia" ? o.metodo_pago : "efectivo";
    const clienteRaw = o.cliente_id;
    const clienteId =
      clienteRaw === null || clienteRaw === undefined || clienteRaw === ""
        ? null
        : String(clienteRaw);
    const observaciones =
      o.observaciones === null || o.observaciones === undefined
        ? null
        : String(o.observaciones).slice(0, 4000);

    // Lubricentro: los vehículos atendidos, cada uno con su odómetro. Una venta
    // puede cubrir varios (un cliente con flota) o ninguno (venta de mostrador).
    const vehiculos: { vehiculo_id: string; km_registrado: number | null }[] = [];
    const vehRaw = o.vehiculos;
    if (vehRaw !== undefined && vehRaw !== null) {
      if (!Array.isArray(vehRaw)) {
        return NextResponse.json(errorResponse("Vehículos inválidos."), { status: 400 });
      }
      for (const x of vehRaw) {
        if (!x || typeof x !== "object") {
          return NextResponse.json(errorResponse("Vehículos inválidos."), { status: 400 });
        }
        const rv = x as Record<string, unknown>;
        const vid = String(rv.vehiculo_id ?? "");
        if (!vid) {
          return NextResponse.json(errorResponse("Falta el vehículo."), { status: 400 });
        }
        const kmRaw = rv.km_registrado;
        const km = kmRaw === null || kmRaw === undefined || kmRaw === "" ? null : Number(kmRaw);
        if (km != null && (!Number.isFinite(km) || km < 0)) {
          return NextResponse.json(errorResponse("Kilometraje inválido."), { status: 400 });
        }
        // El mismo auto dos veces en una venta seria ambiguo: con que km entro.
        if (vehiculos.some((v) => v.vehiculo_id === vid)) {
          return NextResponse.json(
            errorResponse("Un vehículo no puede repetirse en la misma venta."),
            { status: 400 }
          );
        }
        vehiculos.push({ vehiculo_id: vid, km_registrado: km });
      }
    }

    // Una linea no puede apuntar a un auto que no esta en la venta: quedaria
    // colgada del vehiculo equivocado en su historial.
    const idsVeh = new Set(vehiculos.map((v) => v.vehiculo_id));
    if (items.some((i) => i.vehiculo_id && !idsVeh.has(i.vehiculo_id))) {
      return NextResponse.json(
        errorResponse("Hay ítems asignados a un vehículo que no está en la venta."),
        { status: 400 }
      );
    }

    // Pedido de cocina (modalidad obligatoria; comportamiento heredado del baseline)
    const pedidoRaw = (o.pedido_cocina ?? null) as Record<string, unknown> | null;
    type PedidoCocinaParsed = {
      modalidad: "local" | "delivery" | "carry_out";
      mesa: string | null;
      cliente_nombre: string | null;
      cliente_telefono: string | null;
      direccion_entrega: string | null;
      observacion: string | null;
    };
    let pedidoCocina: PedidoCocinaParsed | null = null;
    if (pedidoRaw && typeof pedidoRaw === "object") {
      const m = pedidoRaw.modalidad;
      if (m !== "local" && m !== "delivery" && m !== "carry_out") {
        return NextResponse.json(
          errorResponse("Modalidad de pedido inválida (local | delivery | carry_out)."),
          { status: 400 }
        );
      }
      const trim = (v: unknown) => (typeof v === "string" ? v.trim() : "");
      const mesa = trim(pedidoRaw.mesa);
      const cliNombre = trim(pedidoRaw.cliente_nombre);
      const cliTel = trim(pedidoRaw.cliente_telefono);
      const direccion = trim(pedidoRaw.direccion_entrega);
      const obs = trim(pedidoRaw.observacion);
      if (m === "delivery" && (cliTel.length === 0 || direccion.length === 0)) {
        return NextResponse.json(
          errorResponse("Teléfono y dirección requeridos para Delivery."),
          { status: 400 }
        );
      }
      pedidoCocina = {
        modalidad: m,
        mesa: mesa || null,
        cliente_nombre: cliNombre || null,
        cliente_telefono: cliTel || null,
        direccion_entrega: direccion || null,
        observacion: obs || null,
      };
    }

    const subtotalDeclarado = Number(o.subtotal);
    const montoIvaDeclarado = Number(o.monto_iva);
    const totalDeclarado = Number(o.total);

    if ([subtotalDeclarado, montoIvaDeclarado, totalDeclarado].some((n) => Number.isNaN(n))) {
      return NextResponse.json(errorResponse("Totales inválidos."), { status: 400 });
    }

    if (moneda === "USD" && tipoCambio <= 0) {
      return NextResponse.json(errorResponse("Tipo de cambio inválido para USD."), { status: 400 });
    }

    const schema = await fetchDataSchemaForEmpresaId(auth.empresa_id);
    const authRol = await getAuthWithRol(request);

    const { ventaId, numeroControl, fechaIso } = await createVentaTransaccionalPg({
      schema,
      empresaId: auth.empresa_id,
      clienteId,
      observaciones,
      moneda,
      tipoCambio,
      tipoVenta,
      plazoDias: Number.isFinite(plazoDias as number) ? plazoDias : null,
      metodoPago,
      items,
      subtotalDeclarado,
      montoIvaDeclarado,
      totalDeclarado,
      pedidoCocina,
      // Auditoría de stock: todo movimiento queda con el usuario que lo generó.
      createdBy: auth.usuarioCatalogId ?? auth.user?.id ?? null,
      usuarioNombre: authRol?.nombre?.trim() || auth.user?.email || null,
      cajaId: typeof o.caja_id === "string" && o.caja_id.trim() ? o.caja_id.trim() : null,
      vehiculos,
    });

    // El odómetro de cada vehículo avanza con la venta. Best-effort: si falla,
    // la venta ya está registrada y no se la tira por esto.
    const conKm = vehiculos.filter((v) => v.km_registrado != null);
    if (conKm.length) {
      try {
        const { actualizarKmSiAvanza } = await import("@/lib/vehiculos/server/vehiculos-pg");
        for (const v of conKm) {
          await actualizarKmSiAvanza(schema, auth.empresa_id, v.vehiculo_id, v.km_registrado!);
        }
      } catch (e) {
        console.warn("[/api/ventas/create] km vehículo:", e instanceof Error ? e.message : e);
      }
    }

    let sub = 0;
    let iv = 0;
    let tot = 0;
    for (const it of items) {
      sub += it.subtotal;
      iv += it.monto_iva;
      tot += it.total_linea;
    }

    const venta = toVentaResponse(items, {
      id: ventaId,
      numero_control: numeroControl,
      fechaIso,
      moneda,
      tipo_cambio: tipoCambio,
      tipo_venta: tipoVenta,
      plazo_dias: tipoVenta === "CREDITO" ? plazoDias ?? undefined : undefined,
      metodo_pago: metodoPago,
      subtotal: sub,
      monto_iva: iv,
      total: tot,
    });

    return NextResponse.json(successResponse({ venta }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error al crear la venta.";
    const status =
      msg.includes("Stock insuficiente") ||
      msg.includes("no existen") ||
      msg.includes("Cliente no encontrado") ||
      msg.includes("Totales no coinciden") ||
      msg.includes("al menos un")
        ? 400
        : 500;
    return NextResponse.json(errorResponse(msg), { status });
  }
}
