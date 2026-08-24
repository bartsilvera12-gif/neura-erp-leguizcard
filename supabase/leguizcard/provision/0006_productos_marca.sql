-- =============================================================================
-- Leguizcard - productos.marca
-- =============================================================================
-- El reporte de stock minimo (`/api/reportes/stock-minimo`) selecciona
-- `p.marca`, columna que el linaje de `instemaq` no traia. Sin ella el reporte
-- falla con 42703 (undefined_column).
--
-- Ademas es util por si misma para un lubricentro: la marca del lubricante o
-- del filtro (Shell, Mobil, Total, Mann, ...) es un criterio de busqueda real.
--
-- Aditiva y nullable: no toca datos existentes ni rompe inserts previos.
-- Idempotente.
-- =============================================================================

ALTER TABLE leguizcard.productos
  ADD COLUMN IF NOT EXISTS marca text;

COMMENT ON COLUMN leguizcard.productos.marca IS
  'Marca comercial del producto (Shell, Mobil, Mann, ...). Usada por el reporte de stock minimo y la busqueda de inventario.';

-- Busqueda por marca en el listado de stock minimo.
CREATE INDEX IF NOT EXISTS idx_productos_marca
  ON leguizcard.productos (empresa_id, marca)
  WHERE marca IS NOT NULL;
