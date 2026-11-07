# Etiquetas de cuentas: verlas, filtrar por ellas y sugerirlas al escribir

Objetivo: que la sección Cuentas muestre las etiquetas, permita filtrar por una etiqueta exacta y sugiera las ya existentes al crear o editar una cuenta. Rama: `dev`. Entrega: un commit convencional por unidad terminada, sin `git push`.

## Specs

- S1. «en la seccion cuentas, no se filtra por etiqueta, ni cuando agregas una etiqueta te da opcion a visualizar las etiquetas existentes» (2026-11-07).
- S2. Alcance aceptado («si, opcion A»): (1) etiquetas visibles en la lista; (2) filtro por etiqueta en «Mis cuentas» y en el inventario; (3) sugerencias de etiquetas existentes al crear y editar; (4) en la API, consulta de etiquetas existentes y filtro por etiqueta exacta.
- S3. Regla de visibilidad (opción A, decidida por la persona dueña): las sugerencias de «Mis cuentas» salen solo de las cuentas con acceso efectivo, para que nadie descubra etiquetas de cuentas que no puede ver. El inventario, que ya muestra las etiquetas de todas las cuentas activas a quien tiene `vault.inventory.read`, ofrece las de todo el inventario.

## Tasks

| ID | Specs | Ruta | Estado | Commit |
| --- | --- | --- | --- | --- |
| T1 API: contrato (`tag` en los listados, respuesta de etiquetas), repositorio, caso de uso, controlador, pruebas de integración y matriz | S2, S3 | inline | hecho salvo correr la suite de integración (L3, L4) | ver `git log` |
| T2 Web: etiquetas en la tabla, filtro por etiqueta, sugerencias en crear y editar, textos en ambos idiomas | S2, S3 | inline | pendiente | — |

## Log

- L1 (2026-11-07): sin Docker ni Podman en este equipo. Las pruebas de integración se corren contra el PostgreSQL local con un ajuste temporal de `apps/api/test/global-setup.ts` que no se commitea.
- L2 (2026-11-07): las entradas nuevas de la matriz de autorización (`GET /accounts/tags`, `GET /accounts/inventory/tags`) requieren revisión humana (CLAUDE.md, rutas protegidas).
- L3 (2026-11-07): T1 implementada; tipos, lint y compilación de la API en verde. La suite de integración no arranca: `@swc/core` 1.16.18 rechaza cargar su binario porque `C:\` concede permisos de modificación a «Usuarios autentificados» (falla del entorno, no del código). Se comprobaron las consultas nuevas a mano contra el PostgreSQL local dentro de una transacción revertida: etiquetas distintas, orden sin distinguir mayúsculas, filtro exacto y exclusión de cuentas sin acceso efectivo. `GET /accounts/tags` sin sesión responde 401. Detenido por la regla de fallas del entorno, a la espera de la persona.
- L4 (2026-11-07, usuario): «si» a seguir con la web y dejar la suite de integración sin correr por ahora. Pendiente: correr `vault-account-search` y `authorization-matrix` en un equipo con Docker o Podman antes de llevar el cambio a `main`.
