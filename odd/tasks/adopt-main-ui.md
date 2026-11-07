# Adoptar en dev la interfaz de main (ADR 0049) sin perder lo propio de dev

Objetivo: llevar a `dev` el sistema visual de `main` (latón, temas oscuro y claro, barra superior de cristal) por capas, conservando las funciones que solo tiene `dev`: editor de roles a pantalla completa, etiquetas de cuentas, logotipos de plataformas, vista previa de auditoría, pantalla de credenciales y menú ocultable. Rama: `dev`. Un commit por paso.

## Specs

- S1. «quiero adoptar la interfaz de main, pero sin romper dev, que puedo ir integrando?» (2026-11-07).
- S2. «procede con 1 y 2» (2026-11-07): paso 1, colores y temas; paso 2, marco de la aplicación (barra superior con marca, idioma, tema y menú de usuario; menú lateral por grupos), conservando las pestañas por sección y el menú ocultable de `dev`.
- S3. Fuera de este lote: paso 3 (componentes compartidos) y paso 4 (pantallas una por una). Las pantallas de revelación y segundo factor son rutas protegidas y necesitan encargo aparte.

## Tasks

| ID | Specs | Ruta | Estado | Commit |
| --- | --- | --- | --- | --- |
| T1 Colores y temas: `tokens.css` y `tokens.test.ts` de main, módulo de tema y selector, fuente Space Grotesk, pantallas de acceso con el tema activo | S2 | inline | hecho: 953 pruebas web y 78 de ui verdes, tipos y lint limpios; capturas de la pantalla de acceso en los dos temas revisadas | ver `git log` |
| T2 Marco: barra superior de cristal con marca, idioma, tema y menú de usuario; menú lateral por grupos; sin tokens `nav-*` | S2 | inline | pendiente | — |

## Log

- L1 (2026-11-07): la persona no contestó si el azul se conserva como opción. Opción conservadora: se reemplaza por los dos temas de main; los nombres de token son los mismos, así que un selector con el azul sigue siendo barato (tema pendiente del selector de diseño).
- L2 (2026-11-07): para no romper nada en T1, los tokens del menú marino (`nav-*`) y `shadow-card` quedan como alias de los tokens del tema activo en `tokens.css`. Se retiran en T2 y en el paso 3.
- L3 (2026-11-07): la clase `theme-auth` desaparece: las pantallas de acceso usan el tema activo y ofrecen el selector de tema, como en main. El selector de idioma de dev (píldora ES | EN) se conserva sin su variante `inverse`.
