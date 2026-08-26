-- =============================================================================
-- Leguizcard - foto del vehiculo
-- =============================================================================
-- Una foto por auto. Sirve para dos cosas concretas:
--   1. Confirmar de un vistazo que se agarro el vehiculo correcto cuando hay
--      patentes parecidas o el mismo modelo repetido.
--   2. Reconocer al auto en el buscador de la venta sin leer la chapa.
--
-- Se guarda solo el PATH, no la URL: el bucket es privado y la URL se firma al
-- momento de mostrarla, con vencimiento. Una URL guardada en la tabla seria una
-- URL vencida o, peor, un archivo publico.
--
-- Mismo patron que las imagenes de producto: bucket privado y path
-- {empresa_id}/{vehiculo_id}/principal.{ext}, con el empresa_id de primer
-- segmento para que el aislamiento entre clientes sea verificable mirando la
-- ruta.
--
-- Aditiva, nullable e idempotente.
-- =============================================================================

ALTER TABLE leguizcard.vehiculos
  ADD COLUMN IF NOT EXISTS imagen_path text;

COMMENT ON COLUMN leguizcard.vehiculos.imagen_path IS
  'Path en el bucket privado vehiculos-imagenes. NULL = sin foto. La URL se firma al mostrar.';
