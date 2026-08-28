import { NextRequest } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { traerTodo } from "@/lib/supabase/traer-todo";
import { buildXlsxBuffer, xlsxResponseHeaders, nowStamp } from "@/lib/excel/export";

/**
 * GET /api/gastos/export — los gastos administrativos, en Excel.
 *
 * Acepta ?desde= y ?hasta= (YYYY-MM-DD) para exportar un período. Sin filtros
 * salen todos: el contador normalmente pide un mes, pero el cierre de año pide
 * el año entero y partirlo en doce descargas no le sirve a nadie.
 *
 * La fecha va como texto YYYY-MM-DD y no como fecha de Excel: asi no depende de
 * la configuracion regional de la maquina que abra el archivo, que es como una
 * planilla termina mostrando meses y dias cambiados.
 */

interface Fila {
  fecha: string;
  categoria: string;
  descripcion: string;
  tipo: string;
  monto: number;
  recurrente: string;
  frecuencia: string;
  descuenta_caja: string;
}

export async function GET(request: NextRequest) {
  const ctx = await getTenantSupabaseFromAuth(request);
  if (!ctx) return new Response("Unauthorized", { status: 401 });
  const empresaId = ctx.auth.empresa_id;

  const sp = request.nextUrl.searchParams;
  const desde = (sp.get("desde") ?? "").trim();
  const hasta = (sp.get("hasta") ?? "").trim();

  try {
    const filas = await traerTodo<Record<string, unknown>>((d, h) => {
      let q = ctx.supabase
        .from("gastos")
        .select("fecha, categoria, descripcion, tipo, monto, recurrente, frecuencia, descuenta_caja")
        .eq("empresa_id", empresaId)
        .order("fecha", { ascending: false })
        .order("id", { ascending: false });
      if (desde) q = q.gte("fecha", desde);
      if (hasta) q = q.lte("fecha", hasta);
      return q.range(d, h) as unknown as PromiseLike<{
        data: Record<string, unknown>[] | null;
        error: { message: string } | null;
      }>;
    });

    const rows: Fila[] = filas.map((g) => ({
      fecha: String(g.fecha ?? "").slice(0, 10),
      categoria: String(g.categoria ?? ""),
      descripcion: String(g.descripcion ?? ""),
      tipo: String(g.tipo ?? ""),
      monto: Number(g.monto) || 0,
      recurrente: g.recurrente === true ? "SI" : "NO",
      frecuencia: String(g.frecuencia ?? ""),
      descuenta_caja: g.descuenta_caja === true ? "SI" : "NO",
    }));

    const buf = buildXlsxBuffer<Fila>(
      rows,
      [
        { header: "FECHA", value: (r) => r.fecha, width: 12 },
        { header: "CATEGORIA", value: (r) => r.categoria, width: 22 },
        { header: "DESCRIPCION", value: (r) => r.descripcion, width: 42 },
        { header: "TIPO", value: (r) => r.tipo, width: 14 },
        { header: "MONTO", value: (r) => r.monto, width: 16 },
        { header: "RECURRENTE", value: (r) => r.recurrente, width: 12 },
        { header: "FRECUENCIA", value: (r) => r.frecuencia, width: 14 },
        { header: "SALIO_DE_CAJA", value: (r) => r.descuenta_caja, width: 14 },
      ],
      { sheetName: "Gastos" }
    );

    // El nombre lleva el período cuando hay filtro: tres descargas del mismo
    // mes distinto en la carpeta de Descargas no se distinguen entre si.
    const periodo = desde || hasta ? `-${desde || "inicio"}_${hasta || "hoy"}` : "";
    return new Response(new Uint8Array(buf), {
      status: 200,
      headers: xlsxResponseHeaders(`gastos${periodo}-${nowStamp()}`),
    });
  } catch (err) {
    console.error("[/api/gastos/export]", err instanceof Error ? err.message : err);
    return new Response("No se pudo generar el Excel", { status: 500 });
  }
}
