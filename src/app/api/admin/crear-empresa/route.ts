import { NextResponse } from "next/server";

/**
 * Instancia dedicada monocliente (Leguizcard).
 * La creación de empresas queda deshabilitada: un repo + un deploy + un schema = una empresa.
 */
export async function POST() {
  return NextResponse.json(
    { error: "Creación de empresas deshabilitada en instancia dedicada monocliente (Leguizcard)." },
    { status: 410 }
  );
}
