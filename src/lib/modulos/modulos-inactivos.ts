/**
 * Módulos apagados en esta instancia y las rutas que les pertenecen.
 *
 * Por qué existe este archivo:
 * `empresa_modulos.activo = false` solo saca la entrada del menú. Las 287 rutas
 * de `/api/**` siguen respondiendo: hoy un usuario autenticado puede llamar a
 * `/api/sorteos/*` o `/api/chat/*` aunque el módulo esté apagado, porque solo 3
 * de esas rutas validan el módulo. Esto lo cierra en el borde, sin agregar una
 * consulta a la base en cada request.
 *
 * Es una lista estática a propósito: la instancia es monocliente y el conjunto
 * de módulos lo decide el negocio, no cambia por request. Consultar la base en
 * el middleware costaría un roundtrip en CADA navegación.
 *
 * Para reactivar un módulo:
 *   1. `UPDATE leguizcard.empresa_modulos SET activo = true ...` (lo muestra en
 *      el menú), y
 *   2. sacar su entrada de acá (lo vuelve a hacer accesible).
 * Si se hace solo el paso 1, el módulo aparece en el menú pero sus rutas siguen
 * devolviendo 404 — de ahí que ambos pasos vayan juntos.
 */

export interface ModuloInactivo {
  slug: string;
  motivo: string;
  /** Prefijos de URL que dejan de responder. Se comparan con startsWith. */
  rutas: string[];
}

export const MODULOS_INACTIVOS: ModuloInactivo[] = [
  {
    slug: "conversaciones",
    motivo: "Omnicanal sin contratar: no hay canal de WhatsApp configurado",
    rutas: [
      "/api/chat",
      "/dashboard/conversaciones",
      "/dashboard/colas-agentes",
      "/configuracion/canales",
      "/configuracion/colas",
      "/configuracion/conversaciones",
      "/configuracion/omnicanal-equipos",
      "/configuracion/omnicanal-horarios",
    ],
  },
  {
    slug: "conversaciones-finalizadas",
    motivo: "Depende de omnicanal",
    rutas: ["/dashboard/conversaciones-finalizadas"],
  },
  {
    slug: "historial-omnicanal",
    motivo: "Depende de omnicanal",
    rutas: ["/dashboard/historial-omnicanal", "/dashboard/historial"],
  },
  {
    slug: "monitoreo",
    motivo: "Monitoreo de colas omnicanal",
    rutas: ["/dashboard/monitoreo", "/api/monitoreo"],
  },
  {
    slug: "campanas",
    motivo: "Campañas WhatsApp: sin proveedor configurado",
    rutas: ["/api/campanas", "/dashboard/campanas"],
  },
  {
    slug: "sorteos",
    motivo: "No aplica a un lubricentro",
    rutas: ["/api/sorteos", "/sorteos", "/r/"],
  },
  {
    slug: "crm",
    motivo: "Fuera del alcance acordado",
    rutas: ["/api/crm", "/crm", "/configuracion/crm"],
  },
  {
    slug: "marketing",
    motivo: "Fuera del alcance acordado",
    rutas: ["/api/marketing", "/marketing", "/dashboard/marketing-ops"],
  },
  {
    slug: "proyectos",
    motivo: "Fuera del alcance acordado",
    rutas: ["/api/proyectos", "/dashboard/proyectos", "/configuracion/proyectos"],
  },
];

/** Todos los prefijos apagados, aplanados. Se arma una sola vez por runtime. */
const PREFIJOS: readonly string[] = MODULOS_INACTIVOS.flatMap((m) => m.rutas);

/**
 * ¿El pathname pertenece a un módulo apagado?
 * Compara por prefijo respetando el límite de segmento, para que `/marketing`
 * no bloquee una hipotética `/marketing-digital`.
 */
export function esRutaDeModuloInactivo(pathname: string): boolean {
  return PREFIJOS.some((p) => pathname === p || pathname.startsWith(p.endsWith("/") ? p : `${p}/`));
}

/** El módulo al que pertenece la ruta. Solo para logs y mensajes de error. */
export function moduloDeRuta(pathname: string): ModuloInactivo | null {
  return (
    MODULOS_INACTIVOS.find((m) =>
      m.rutas.some((p) => pathname === p || pathname.startsWith(p.endsWith("/") ? p : `${p}/`))
    ) ?? null
  );
}
