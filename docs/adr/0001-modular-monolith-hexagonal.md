# ADR 0001: Monolito modular, hexagonal por módulo

- **Estado**: Aceptada
- **Fecha**: 2026-10-26
- **Referencias**: [`plan.md`](../../plan.md) secciones "Decisiones cerradas (ADR)", "Arquitectura" y "Capas dentro de cada módulo (hexagonal)"; [`docs/backend.md`](../backend.md) §3; [`docs/architecture.md`](../architecture.md).

## Contexto

El equipo es de 3 personas y debe operar el producto sin dedicar tiempo a infraestructura distribuida. El sistema guarda secretos reales, por lo que las reglas de seguridad (jerarquía, motor de decisión, versiones de secretos) deben ser código puro, probable de forma exhaustiva y aislado del framework. Además, el plan prevé módulos futuros (`federation`, `inbound-codes`, `broker`) y la posibilidad de separar procesos más adelante.

## Decisión

Un monolito modular: un repositorio, una imagen de contenedor y procesos con distinto punto de entrada (API, worker y migraciones). Cada módulo sigue arquitectura hexagonal con las capas `domain`, `application`, `infrastructure` e `interface`, y los módulos solo se comunican por su fachada pública (`index.ts`) o por eventos de dominio vía `outbox_events`. La regla de dependencia se verifica con `eslint-plugin-boundaries` y dependency-cruiser.

## Alternativas consideradas

- **Microservicios**: descartados porque un equipo de 3 no puede operarlos (razón del plan).
- **Monolito sin límites internos** _(inferida del plan)_: descartado porque impediría separar un módulo después sin reescribirlo y dificultaría probar las reglas de seguridad sin levantar el framework.

## Consecuencias

- **Positivas**: operación simple; límites de módulo que permiten extraer un servicio sin reescribirlo; dominio probable sin Nest ni base de datos.
- **Negativas o costos**: disciplina de capas y fachadas; riesgo de convertir la hexagonal en ceremonia (por eso un puerto solo existe cuando hay una razón real, ver `docs/backend.md` §3.1).
- **Verificación**: lint de límites y prueba de arquitectura en CI; revisión de PR.
