"use client";

import { useEffect, useMemo, useState } from "react";

/**
 * Paginado en el cliente para los reportes.
 *
 * El reporte ya tiene todas sus filas cargadas; esto solo decide cual pedazo se
 * dibuja. No reduce lo que viaja del servidor — arregla la pantalla, no la
 * transferencia. Para los volumenes de un lubricentro alcanza; si algun reporte
 * creciera a decenas de miles de filas, ese habria que paginarlo en el servidor
 * como ya hace el de rotacion ABC.
 *
 * Uso:
 *   const pag = usePaginacion(filtrados);
 *   ...
 *   {pag.filas.map(...)}
 *   <Paginador {...pag.props} etiqueta="productos" />
 */
export function usePaginacion<T>(filas: T[], tamanoInicial = 25) {
  const [pagina, setPagina] = useState(1);
  const [tamano, setTamano] = useState(tamanoInicial);

  const total = filas.length;
  const totalPaginas = Math.max(1, Math.ceil(total / tamano));

  // Si el filtro achica la lista y la pagina actual queda fuera de rango, se
  // vuelve a la ultima valida en vez de mostrar una tabla vacia.
  const paginaSegura = Math.min(pagina, totalPaginas);

  // Cambiar el filtro o el tamano devuelve a la primera pagina: quedarse en la
  // 7 despues de filtrar muestra un vacio que parece un error.
  useEffect(() => {
    setPagina(1);
  }, [total, tamano]);

  const visibles = useMemo(
    () => filas.slice((paginaSegura - 1) * tamano, paginaSegura * tamano),
    [filas, paginaSegura, tamano]
  );

  const desde = total === 0 ? 0 : (paginaSegura - 1) * tamano + 1;
  const hasta = Math.min(paginaSegura * tamano, total);

  return {
    /** Las filas de la pagina actual. */
    filas: visibles,
    pagina: paginaSegura,
    totalPaginas,
    total,
    /** Todo lo que necesita <Paginador>, para pasarlo con spread. */
    props: {
      pagina: paginaSegura,
      totalPaginas,
      total,
      desde,
      hasta,
      tamano,
      onPagina: (p: number) => setPagina(Math.min(Math.max(1, p), totalPaginas)),
      onTamano: (n: number) => setTamano(n),
    },
  };
}
