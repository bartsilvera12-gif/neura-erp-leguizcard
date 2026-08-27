import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";

/**
 * GET /api/alertas — lo que necesita atencion ahora.
 *
 * Hoy trae reposicion de stock. La respuesta es una lista de alertas con un
 * `tipo`, para que sumar otra clase (mantenimientos vencidos, por ejemplo) no
 * obligue a cambiar ni la campanita ni este contrato.
 *
 * Cuenta y detalle salen del MISMO pedido: la campanita muestra el numero y el
 * panel muestra las filas, y si fueran dos consultas podrian discrepar.
 */

export interface AlertaStock {
  tipo: "stock";
  /** Critico = sin stock; el resto es reposicion normal. */
  nivel: "critico" | "aviso";
  producto_id: string;
  titulo: string;
  detalle: string;
  href: string;
}

/** Cuantas filas se devuelven. Arriba de esto, el panel invita al reporte. */
const LIMITE = 30;

export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const empresaId = ctx.auth.empresa_id;

    // Solo productos que controlan stock: un servicio o algo sin control no
    // tiene "faltante" que reponer.
    const { data, error } = await ctx.supabase
      .from("productos")
      .select("id, nombre, sku, stock_actual, stock_minimo, unidad_medida")
      .eq("empresa_id", empresaId)
      .eq("activo", true)
      .eq("controla_stock", true)
      .gt("stock_minimo", 0)
      .order("nombre");
    if (error) throw new Error(error.message);

    const filas = (data ?? []) as unknown as Record<string, unknown>[];

    const bajos = filas
      .map((p) => {
        const stock = Number(p.stock_actual) || 0;
        const minimo = Number(p.stock_minimo) || 0;
        return { p, stock, minimo, falta: minimo - stock };
      })
      // El filtro se hace acá y no en la consulta porque PostgREST no compara
      // dos columnas entre si.
      .filter((x) => x.falta > 0)
      // Primero lo que esta en cero, y dentro de eso lo que mas falta.
      .sort((a, b) => Number(a.stock > 0) - Number(b.stock > 0) || b.falta - a.falta);

    const alertas: AlertaStock[] = bajos.slice(0, LIMITE).map(({ p, stock, minimo, falta }) => {
      const unidad = String(p.unidad_medida ?? "").toUpperCase();
      const u = !unidad || unidad === "UNIDAD" ? "" : ` ${unidad === "LITRO" ? "L" : unidad}`;
      return {
        tipo: "stock",
        nivel: stock <= 0 ? "critico" : "aviso",
        producto_id: String(p.id),
        titulo: String(p.nombre ?? ""),
        detalle:
          stock <= 0
            ? `Sin stock · mínimo ${minimo}${u}`
            : `Quedan ${stock}${u} de ${minimo}${u} · faltan ${falta}${u}`,
        href: `/inventario/${String(p.id)}/editar`,
      };
    });

    return NextResponse.json(
      successResponse({
        total: bajos.length,
        criticos: bajos.filter((x) => x.stock <= 0).length,
        alertas,
      })
    );
  } catch (err) {
    console.error("[/api/alertas GET]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudieron cargar las alertas."), { status: 500 });
  }
}
