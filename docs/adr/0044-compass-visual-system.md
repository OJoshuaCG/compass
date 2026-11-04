# ADR 0044: Sistema visual de Compass: acento latón, dos temas y cristal solo en capas flotantes

- **Estado**: Aceptada por la persona dueña del proyecto el 2026-11-04 («aceptar las propuestas que se brindan para trabajar con todo el redisenio de todas las vistas de este proyecto»).
- **Fecha**: 2026-11-04
- **Referencias**: lienzo de diseño «Compass — Propuesta de diseño» (https://claude.ai/artifact/Tth2eUdgKBYiZjMmcZmwdn); `docs/frontend.md` §4; `packages/ui/src/styles/tokens.css`; `apps/web/src/shared/styles/tokens.test.ts`; `odd/tasks/ui-redesign.md`.

## Resumen

La interfaz adopta el sistema visual de la propuesta de diseño: instrumentos silenciosos con una sola «aguja» de latón como acento, superficies frías y neutras, dos temas completos (oscuro y claro) y cristal solo en las capas que flotan sobre el trabajo. Reemplaza a la paleta «carbón» de un solo tema oscuro de la fase 0.

## Contexto

- La fase 0 fijó un único tema oscuro con acento azul (`docs/frontend.md` §4.1 anterior, y `plan.md`: «tema oscuro único por tokens»). Esa decisión era de diseño, no de seguridad.
- La propuesta nueva cubre inicio, usuarios, cuenta de la bóveda con revelación de secreto y fundamentos, en oscuro y en claro.
- Las tres familias tipográficas de la propuesta (Space Grotesk, Inter y JetBrains Mono) ya se sirven desde nuestro origen con `@fontsource-variable/*`. La propuesta las carga desde Google Fonts, lo que la CSP estricta no permite.
- El mockup trae textos literales en inglés; el proyecto exige catálogo es-MX y en-US.

## Decisión

1. **Se adopta el sistema visual de la propuesta** con los valores de `docs/frontend.md` §4.1: un solo acento latón, superficies frías, dos temas (`data-theme`), radios de 6, 10 y 14 px.
2. **Se conservan los nombres semánticos de token** de `packages/ui` (`canvas`, `surface`, `raised`, `overlay`, `text*`, `accent*`, estados) y se cambian sus valores. Se agregan `sidebar`, las variantes suaves de acento y estado, `info`, `on-danger` y los tokens de cristal. Así los componentes existentes no se reescriben.
3. **El cristal (`backdrop-filter`) se limita a capas flotantes:** barra superior, ventanas modales y menús. Nunca tarjetas ni tablas.
4. **Las fuentes no cambian:** se adaptan a los estilos nuevos sin dependencias ni CDN.
5. **Se conservan, sin cambio:** textos solo por catálogo es-MX y en-US, tabla estándar, accesibilidad AA medida por una prueba, sin color literal en componentes, y las reglas de capas del lint.
6. **La prueba de contraste mide los dos temas.** Un valor que baje del umbral en cualquiera de ellos rompe la prueba.
7. **La revelación de secretos se rediseña solo en lo visual.** Su autorización, auditoría y cifrado no cambian, y sus cambios pasan por los dos revisores ciegos.

## Consecuencias

- La frase «un solo juego de valores oscuros, sin modo claro» queda sustituida. `plan.md` conserva su texto original; en diseño manda este ADR, y en seguridad sigue mandando el plan.
- Hay que ofrecer selector de tema y recordar la preferencia por persona. Sin preferencia se sigue la del sistema.
- Toda pantalla debe verse bien y cumplir contraste en los dos temas, lo que duplica la revisión visual.
- `backdrop-filter` tiene costo de pintado: por eso se limita a pocas capas y se mantiene opaco el contenido.
- El rediseño se entrega por unidades (tokens, componentes, vistas) con un commit por unidad, y su avance está en `odd/tasks/ui-redesign.md`.
