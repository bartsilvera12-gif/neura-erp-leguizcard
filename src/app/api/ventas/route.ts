import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import type { Venta, LineaVenta, TipoIvaVenta } from "@/lib/ventas/types";

interface VentaRow {
  id: string;
  empresa_id: string;
  numero_control: string;
  moneda: string;
  tipo_cambio: number | string;
  subtotal: number | string;
  monto_iva: number | string;
  total: number | string;
  tipo_venta: string;
  plazo_dias: number | null;
  fecha: string;
  cliente_id: string | null;
  vehiculo_id: string | null;
  km_registrado: number | string | null;
  observaciones: string | null;
}

interface VentaItemRow {
  venta_id: string;
  producto_id: string;
  producto_nombre: string;
  sku: string;
  cantidad: number | string;
  precio_venta_original: number | string;
  precio_venta: number | string;
  tipo_iva: string;
  subtotal: number | string;
  monto_iva: number | string;
  total_linea: number | string;
}

function num(v: number | string): number {
  return typeof v === "number" ? v : Number(v);
}

function mapItems(rows: VentaItemRow[]): LineaVenta[] {
  return rows.map((r) => ({
    producto_id: r.producto_id,
    producto_nombre: r.producto_nombre,
    sku: r.sku,
    cantidad: num(r.cantidad),
    precio_venta_original: num(r.precio_venta_original),
    precio_venta: num(r.precio_venta),
    tipo_iva: r.tipo_iva as TipoIvaVenta,
    subtotal: num(r.subtotal),
    monto_iva: num(r.monto_iva),
    total_linea: num(r.total_linea),
  }));
}

/** GET /api/ventas — listado vía PostgREST (compatible Hostinger sin pool). */
export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const empresaId = ctx.auth.empresa_id;

    const ventasQ = await ctx.supabase
      .from("ventas")
      .select(
        "id, empresa_id, numero_control, moneda, tipo_cambio, subtotal, monto_iva, total, tipo_venta, plazo_dias, metodo_pago, fecha, cliente_id, vehiculo_id, km_registrado, observaciones"
      )
      .eq("empresa_id", empresaId)
      .order("fecha", { ascending: false })
      .limit(500);
    if (ventasQ.error) throw new Error(ventasQ.error.message);

    const itemsQ = await ctx.supabase
      .from("ventas_items")
      .select(
        "venta_id, producto_id, producto_nombre, sku, cantidad, precio_venta_original, precio_venta, tipo_iva, subtotal, monto_iva, total_linea"
      )
      .eq("empresa_id", empresaId);
    if (itemsQ.error) throw new Error(itemsQ.error.message);

    const ventasRows = (ventasQ.data ?? []) as VentaRow[];
    const itemsRows = (itemsQ.data ?? []) as VentaItemRow[];

    // Los nombres de cliente y vehiculo se resuelven aparte y se cruzan en JS,
    // igual que los items. Se piden solo los que aparecen en estas ventas, no
    // el padron completo.
    const idsCli = [...new Set(ventasRows.map((r) => r.cliente_id).filter(Boolean))] as string[];
    const idsVeh = [...new Set(ventasRows.map((r) => r.vehiculo_id).filter(Boolean))] as string[];

    const [cliQ, vehQ] = await Promise.all([
      idsCli.length
        ? ctx.supabase
            .from("clientes")
            .select("id, nombre, nombre_contacto, empresa, tipo_cliente")
            .eq("empresa_id", empresaId)
            .in("id", idsCli)
        : Promise.resolve({ data: [], error: null }),
      idsVeh.length
        ? ctx.supabase
            .from("vehiculos")
            .select("id, patente, marca, modelo")
            .eq("empresa_id", empresaId)
            .in("id", idsVeh)
        : Promise.resolve({ data: [], error: null }),
    ]);

    // Mismo criterio que clienteNombre(): razon social si es empresa, si no el
    // contacto, y la columna nombre como ultimo recurso.
    const nombreCli = new Map<string, string>();
    for (const c of (cliQ.data ?? []) as Record<string, unknown>[]) {
      const empresaNom = String(c.empresa ?? "").trim();
      const contacto = String(c.nombre_contacto ?? "").trim();
      const nombre = String(c.nombre ?? "").trim();
      const elegido =
        (c.tipo_cliente === "empresa" && empresaNom) || contacto || nombre || "";
      if (elegido) nombreCli.set(String(c.id), elegido);
    }

    const vehPorId = new Map<string, { patente: string; desc: string | null }>();
    for (const v of (vehQ.data ?? []) as Record<string, unknown>[]) {
      const desc = [v.marca, v.modelo].filter(Boolean).join(" ").trim();
      vehPorId.set(String(v.id), { patente: String(v.patente ?? ""), desc: desc || null });
    }

    const byVenta = new Map<string, VentaItemRow[]>();
    for (const row of itemsRows) {
      const list = byVenta.get(row.venta_id) ?? [];
      list.push(row);
      byVenta.set(row.venta_id, list);
    }

    const ventas: Venta[] = ventasRows.map((r) => {
      const lineRows = byVenta.get(r.id) ?? [];
      return {
        id: r.id,
        numero_control: r.numero_control,
        items: mapItems(lineRows),
        moneda: r.moneda === "USD" ? "USD" : "GS",
        tipo_cambio: num(r.tipo_cambio),
        subtotal: num(r.subtotal),
        monto_iva: num(r.monto_iva),
        total: num(r.total),
        tipo_venta: r.tipo_venta === "CREDITO" ? "CREDITO" : "CONTADO",
        plazo_dias: r.plazo_dias ?? undefined,
        metodo_pago: (r as unknown as { metodo_pago?: string }).metodo_pago === "tarjeta"
          ? "tarjeta"
          : (r as unknown as { metodo_pago?: string }).metodo_pago === "transferencia"
          ? "transferencia"
          : (r as unknown as { metodo_pago?: string }).metodo_pago === "efectivo"
          ? "efectivo"
          : undefined,
        fecha: r.fecha,
        cliente_id: r.cliente_id ?? null,
        cliente_nombre: r.cliente_id ? nombreCli.get(r.cliente_id) ?? null : null,
        vehiculo_id: r.vehiculo_id ?? null,
        vehiculo_patente: r.vehiculo_id ? vehPorId.get(r.vehiculo_id)?.patente ?? null : null,
        vehiculo_desc: r.vehiculo_id ? vehPorId.get(r.vehiculo_id)?.desc ?? null : null,
        km_registrado: r.km_registrado != null ? num(r.km_registrado) : null,
        observaciones: r.observaciones ?? null,
      };
    });

    return NextResponse.json(successResponse({ ventas }));
  } catch (err) {
    console.error("[/api/ventas GET]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudieron cargar las ventas."), { status: 500 });
  }
}
