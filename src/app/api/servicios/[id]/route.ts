import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import {
  actualizarServicio,
  desactivarServicio,
  getServicio,
} from "@/lib/servicios/servicios-pg";
import { parseServicio } from "../route";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: Ctx) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const { id } = await params;
    const servicio = await getServicio(ctx.supabase, ctx.auth.empresa_id, id);
    if (!servicio) return NextResponse.json(errorResponse("Servicio no encontrado."), { status: 404 });
    return NextResponse.json(successResponse({ servicio }));
  } catch (err) {
    console.error("[/api/servicios/[id] GET]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo cargar el servicio."), { status: 500 });
  }
}

export async function PATCH(request: NextRequest, { params }: Ctx) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const { id } = await params;
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const input = parseServicio(body);
    if (typeof input === "string") {
      return NextResponse.json(errorResponse(input), { status: 400 });
    }
    const servicio = await actualizarServicio(ctx.supabase, ctx.auth.empresa_id, id, input);
    if (!servicio) return NextResponse.json(errorResponse("Servicio no encontrado."), { status: 404 });
    return NextResponse.json(successResponse({ servicio }));
  } catch (err) {
    console.error("[/api/servicios/[id] PATCH]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo guardar el servicio."), { status: 500 });
  }
}

/** Baja logica: las ventas historicas apuntan al producto. */
export async function DELETE(request: NextRequest, { params }: Ctx) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const { id } = await params;
    const ok = await desactivarServicio(ctx.supabase, ctx.auth.empresa_id, id);
    if (!ok) return NextResponse.json(errorResponse("Servicio no encontrado."), { status: 404 });
    return NextResponse.json(successResponse({ desactivado: true }));
  } catch (err) {
    console.error("[/api/servicios/[id] DELETE]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo dar de baja el servicio."), { status: 500 });
  }
}
