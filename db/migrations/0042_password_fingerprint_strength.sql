-- 0042: puntaje de fortaleza de la contraseña (salud de credenciales; docs/business/governance.md §3, GO-10).
--
-- La huella de la contraseña (`password_fingerprints`, 0005) ya vive una por credencial y se reemplaza en cada
-- cambio de contraseña. El puntaje de fortaleza tiene el mismo ciclo de vida, así que se guarda en la misma fila:
-- se calcula al escribir (el servidor tiene entonces el texto en claro) y solo se guarda el número, nunca el texto.
--
-- No se crea tabla nueva: la tabla conserva su organización, su índice por (organización, huella) y su política de
-- aislamiento de la 0005. Esta migración NO edita la 0005 (migración aplicada); solo agrega columnas.
-- Las filas anteriores quedan sin puntaje (null): se llenan cuando la contraseña vuelva a escribirse.

alter table password_fingerprints
  add column strength_score smallint check (strength_score between 0 and 4),
  add column strength_scored_at timestamptz;

comment on column password_fingerprints.strength_score is
  'Puntaje de zxcvbn de la contraseña vigente: 0 (trivial de adivinar) a 4 (muy difícil). Null si aún no se calculó.';
comment on column password_fingerprints.strength_scored_at is
  'Instante (UTC) en que se calculó el puntaje, igual al de la escritura de la contraseña vigente.';

-- Mismo conjunto de permisos de la 0005: la aplicación solo lee, inserta y actualiza; las columnas nuevas
-- heredan el grant a nivel de tabla.
