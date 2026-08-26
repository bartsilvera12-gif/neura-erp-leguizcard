import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { esRutaDeModuloInactivo, moduloDeRuta } from "@/lib/modulos/modulos-inactivos";

/**
 * Refresca la sesión Supabase en cookies antes de Route Handlers / RSC.
 * Solo NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_ANON_KEY (sin db.schema en getUser).
 */
export async function middleware(request: NextRequest) {
  // Modulos apagados: se cortan en el borde, antes de tocar Supabase.
  // `empresa_modulos.activo = false` solo saca la entrada del menu; sin esto las
  // rutas de esos modulos siguen respondiendo a cualquier usuario autenticado.
  const { pathname } = request.nextUrl;
  if (esRutaDeModuloInactivo(pathname)) {
    const mod = moduloDeRuta(pathname);
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        {
          success: false,
          error: `Módulo no habilitado en esta instancia${mod ? `: ${mod.slug}` : ""}.`,
        },
        { status: 404 }
      );
    }
    // Paginas: al dashboard. El proyecto no tiene not-found.tsx propio, asi que
    // un rewrite a /404 dependeria del fallback interno de Next; redirigir es
    // comportamiento definido y ademas deja al usuario en un lugar util.
    return NextResponse.redirect(new URL("/", request.url));
  }

  let supabaseResponse = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    return supabaseResponse;
  }

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        supabaseResponse = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options)
        );
      },
    },
  });

  await supabase.auth.getUser();

  return supabaseResponse;
}

/**
 * Excluir `/api/webhooks/*`: Meta hace GET sin cookies para verificar el webhook;
 * no debe pasar por refresh de sesión Supabase (y queda listo para proxies estrictos).
 */
export const config = {
  matcher: [
    "/((?!api/webhooks|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
