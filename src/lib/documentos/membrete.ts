/**
 * Membrete (encabezado) común para todos los documentos imprimibles del ERP.
 * Devuelve HTML con estilos inline para no depender del CSS de cada endpoint.
 *
 * SOLO presentación: no toca datos de negocio.
 */

export const EMPRESA_DOC = {
  // El nombre sale del logo que entrego el cliente: LEGUIZCAR, sin D. El schema
  // y el dominio siguen siendo "leguizcard" — son infraestructura y no se tocan.
  nombre: "LEGUIZCAR",
  actividad: ["Clínica de automóviles"],
  telefono: "",
  email: "",
  direccion: [] as string[],
  /**
   * Logo para documentos A4 (presupuestos, ordenes de compra, extractos).
   * Negro sobre fondo transparente: la mayoria se imprime en blanco y negro y
   * el naranja de marca saldria gris lavado.
   */
  logoUrl: "/brand/leguizcar-logo-doc.png",
  /**
   * Logo para ticket termico. Es un archivo APARTE y no un resize del anterior:
   * el cabezal termico no imprime medios tonos, asi que va en blanco y negro
   * puro y al ancho real del papel (384 px). Mandarle el PNG con antialias del
   * A4 lo obligaria a tramar, y el tramado ensucia los trazos finos.
   */
  logoTicketUrl: "/brand/leguizcar-logo.png",
  /**
   * El logo de Leguizcar ya trae el nombre dibujado. Repetirlo en texto debajo
   * se ve como un error de armado y gasta papel. Si algun dia el logo pasara a
   * ser solo el simbolo, esto vuelve a false y el nombre reaparece.
   */
  logoIncluyeNombre: true,
};

function esc(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Membrete A4: logo a la izquierda, datos comerciales a la derecha, línea divisoria.
 * `origin` opcional para URL absoluta del logo (útil al imprimir/guardar PDF).
 */
export function membreteA4(origin = ""): string {
  const e = EMPRESA_DOC;
  const logo = e.logoUrl ? (origin ? `${origin}${e.logoUrl}` : e.logoUrl) : "";
  const logoHtml = logo
    ? `<img src="${esc(logo)}" alt="${esc(e.nombre)}" style="max-width:240px;max-height:130px;width:auto;height:auto;object-fit:contain;display:block;" />`
    : `<div style="font-size:20px;font-weight:800;color:#1e3a8a;letter-spacing:0.04em;">${esc(e.nombre)}</div>`;
  const actividadHtml = e.actividad.length
    ? e.actividad.map((a) => `<div style="color:#6b7280;">${esc(a)}</div>`).join("")
    : "";
  const telHtml = e.telefono ? `<div style="margin-top:4px;"><strong>Tel:</strong> ${esc(e.telefono)}</div>` : "";
  const emailHtml = e.email ? `<div><strong>Email:</strong> ${esc(e.email)}</div>` : "";
  const dirHtml = e.direccion.length ? `<div>${e.direccion.map(esc).join(" · ")}</div>` : "";
  return `
  <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:18px;border-bottom:2px solid #1e3a8a;padding-bottom:12px;margin-bottom:16px;">
    <div style="flex:0 0 auto;">
      ${logoHtml}
    </div>
    <div style="flex:1;min-width:0;text-align:right;font-size:11px;color:#374151;line-height:1.55;">
      <div style="font-size:14px;font-weight:800;color:#1f2937;">${esc(e.nombre)}</div>
      ${actividadHtml}
      ${telHtml}
      ${emailHtml}
      ${dirHtml}
    </div>
  </div>`;
}

/**
 * Membrete compacto para ticket angosto (58/80mm): logo arriba, datos centrados.
 */
export function membreteTicket(origin = ""): string {
  const e = EMPRESA_DOC;
  const src = e.logoTicketUrl || e.logoUrl;
  const logo = src ? (origin ? `${origin}${src}` : src) : "";
  // image-rendering:pixelated evita que el navegador suavice el PNG al escalar:
  // el logo ya viene binarizado y un remuestreo suave le devolveria los grises
  // que la termica no puede imprimir.
  const logoHtml = logo
    ? `<img src="${esc(logo)}" alt="${esc(e.nombre)}" style="max-width:118px;width:100%;height:auto;object-fit:contain;display:block;margin:0 auto 4px;image-rendering:pixelated;" />`
    : "";
  // Si el logo ya trae el nombre, no se repite en texto. Sin logo siempre se
  // imprime: el ticket no puede salir sin identificar al negocio.
  const nombreHtml =
    logo && e.logoIncluyeNombre
      ? ""
      : `<div style="font-weight:700;font-size:12px;">${esc(e.nombre)}</div>`;
  const telHtml = e.telefono ? `<div style="font-size:10px;">Tel: ${esc(e.telefono)}</div>` : "";
  const emailHtml = e.email ? `<div style="font-size:10px;word-break:break-all;">${esc(e.email)}</div>` : "";
  const dirHtml = e.direccion.length
    ? e.direccion.map((d) => `<div style="font-size:10px;">${esc(d)}</div>`).join("")
    : "";
  return `
  <div style="text-align:center;padding-bottom:6px;margin-bottom:6px;border-bottom:1px dashed #000;">
    ${logoHtml}
    ${nombreHtml}
    ${dirHtml}
    ${telHtml}
    ${emailHtml}
  </div>`;
}
