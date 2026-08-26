import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import {
  ALLOWED_IMAGE_MIME,
  MAX_IMAGE_BYTES,
  VEHICULOS_IMAGENES_BUCKET,
  buildVehiculoImagenPath,
  ensureVehiculosImagenesBucket,
  pathBelongsToEmpresa,
  signVehiculoImagen,
} from "@/lib/vehiculos/imagen-storage";
import type { AppSupabaseClient } from "@/lib/supabase/schema";

/**
 * Foto del vehiculo — Storage de Supabase via PostgREST, sin pool PG.
 *
 * En la tabla se guarda el PATH, no la URL: el bucket es privado y la URL se
 * firma al mostrarla. Una URL guardada seria una URL vencida.
 */

async function fetchVehiculo(
  sb: AppSupabaseClient,
  empresaId: string,
  vehiculoId: string
): Promise<{ id: string; imagen_path: string | null } | null> {
  const { data, error } = await sb
    .from("vehiculos")
    .select("id, imagen_path")
    .eq("empresa_id", empresaId)
    .eq("id", vehiculoId)
    .maybeSingle();
  if (error) {
    console.error("[vehiculos imagen] fetchVehiculo", error.message);
    return null;
  }
  return (data as { id: string; imagen_path: string | null } | null) ?? null;
}

export async function GET(request: NextRequest, ctxParams: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctxParams.params;
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });

    const veh = await fetchVehiculo(ctx.supabase, ctx.auth.empresa_id, id);
    if (!veh) return NextResponse.json(errorResponse(API_ERRORS.NOT_FOUND), { status: 404 });

    const url = await signVehiculoImagen(ctx.supabase, veh.imagen_path, 3600);
    return NextResponse.json(successResponse({ imagen_path: veh.imagen_path, imagen_url: url }));
  } catch (err) {
    console.error("[/api/vehiculos/[id]/imagen GET]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo obtener la foto."), { status: 500 });
  }
}

export async function POST(request: NextRequest, ctxParams: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctxParams.params;
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const { supabase, auth } = ctx;
    const empresaId = auth.empresa_id;

    // 1) Que el vehiculo sea de esta empresa, antes de tocar Storage.
    const veh = await fetchVehiculo(supabase, empresaId, id);
    if (!veh) return NextResponse.json(errorResponse(API_ERRORS.NOT_FOUND), { status: 404 });

    // 2) Archivo
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json(errorResponse("Falta el archivo (campo 'file')."), { status: 400 });
    }
    if (!ALLOWED_IMAGE_MIME.has(file.type)) {
      return NextResponse.json(errorResponse("Formato no permitido. Usá JPG, PNG o WebP."), {
        status: 400,
      });
    }
    if (file.size > MAX_IMAGE_BYTES) {
      const mb = (MAX_IMAGE_BYTES / 1024 / 1024).toFixed(0);
      return NextResponse.json(errorResponse(`La foto es muy grande (máx. ${mb} MB).`), {
        status: 413,
      });
    }

    // 3) Bucket idempotente. Si falla el ensure pero el bucket ya existe, el
    //    upload igual anda; por eso no se corta acá.
    try {
      await ensureVehiculosImagenesBucket(supabase);
    } catch (e) {
      console.error("[vehiculos imagen] ensureBucket", e instanceof Error ? e.message : e);
    }

    // 4) La foto anterior se borra, para no dejar huerfanos ocupando espacio
    //    cuando cambia la extension (jpg -> png no se pisa solo).
    if (veh.imagen_path && pathBelongsToEmpresa(veh.imagen_path, empresaId)) {
      await supabase.storage.from(VEHICULOS_IMAGENES_BUCKET).remove([veh.imagen_path]);
    }

    const path = buildVehiculoImagenPath(empresaId, id, file.type);
    const buf = Buffer.from(await file.arrayBuffer());
    const up = await supabase.storage
      .from(VEHICULOS_IMAGENES_BUCKET)
      .upload(path, buf, { contentType: file.type, upsert: true });
    if (up.error) {
      console.error("[vehiculos imagen] upload", { empresaId, id, message: up.error.message });
      return NextResponse.json(errorResponse(`No se pudo subir la foto: ${up.error.message}`), {
        status: 500,
      });
    }

    const upd = await supabase
      .from("vehiculos")
      .update({ imagen_path: path })
      .eq("empresa_id", empresaId)
      .eq("id", id)
      .select("id")
      .maybeSingle();
    if (upd.error) {
      console.error("[vehiculos imagen] update", upd.error.message);
      return NextResponse.json(errorResponse("No se pudo asociar la foto al vehículo."), {
        status: 500,
      });
    }

    const url = await signVehiculoImagen(supabase, path, 3600);
    return NextResponse.json(successResponse({ imagen_path: path, imagen_url: url }));
  } catch (err) {
    console.error("[/api/vehiculos/[id]/imagen POST]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo subir la foto."), { status: 500 });
  }
}

export async function DELETE(request: NextRequest, ctxParams: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctxParams.params;
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const { supabase, auth } = ctx;
    const empresaId = auth.empresa_id;

    const veh = await fetchVehiculo(supabase, empresaId, id);
    if (!veh) return NextResponse.json(errorResponse(API_ERRORS.NOT_FOUND), { status: 404 });

    if (veh.imagen_path && pathBelongsToEmpresa(veh.imagen_path, empresaId)) {
      await supabase.storage.from(VEHICULOS_IMAGENES_BUCKET).remove([veh.imagen_path]);
    }
    await supabase
      .from("vehiculos")
      .update({ imagen_path: null })
      .eq("empresa_id", empresaId)
      .eq("id", id);

    return NextResponse.json(successResponse({ imagen_path: null, imagen_url: null }));
  } catch (err) {
    console.error("[/api/vehiculos/[id]/imagen DELETE]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo quitar la foto."), { status: 500 });
  }
}
