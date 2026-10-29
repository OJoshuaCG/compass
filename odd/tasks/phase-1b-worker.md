# Fase 1b · Publicador del outbox (H1a)

Objetivo: implementar el [ADR 0035](../../docs/adr/0035-transactional-outbox-for-events.md): trabajador por sondeo con `FOR UPDATE SKIP LOCKED`, entrega al menos una vez, reintentos con espera exponencial y cuarentena, dentro de la API. Sin manejadores reales (correo, avisos): es solo el registro y el bucle.

## Specs (textuales del encargo)

- Reclamar por lotes con `FOR UPDATE SKIP LOCKED`; marcar publicado; ante fallo, sumar intento y reprogramar con espera exponencial con tope; tras el máximo, dejar en cuarentena con el esquema existente.
- Registro de manejadores por `type`; un tipo desconocido no tumba el bucle; el `payload` nunca se registra.
- Cada evento se procesa con el contexto de su organización.
- Arranca con la API y se detiene al apagar; `OUTBOX_WORKER_ENABLED` apagado salvo orden expresa; `OUTBOX_POLL_INTERVAL_MS` acotada.

## Tareas

| ID | Tarea | Estado |
| --- | --- | --- |
| H1a-1 | Módulo `outbox` (dominio, aplicación, infraestructura) y cableado en el contenedor | Hecha |
| H1a-2 | Configuración validada y arranque/apagado en `main.http.ts` | Hecha |
| H1a-3 | Pruebas unitarias e de integración (SKIP LOCKED, aislamiento, rollback) | Escritas, sin ejecutar |
| H1a-4 | Documentación (ADR 0035, `docs/backend.md` §6.5, `docs/deployment.md`) | Hecha |
| H1b | Manejadores reales (aviso de revelaciones a la Raíz, aviso de 24 h del segundo factor) | Pendiente |
| G1 | Retención de publicados: propuesta de 7 días NO definitiva, decide el dueño | Pendiente |

## Bitácora

- 2026-10-28: implementado sin migración. Cuarentena = `next_attempt_at = 'infinity'` con `published_at` nulo. Código de fallo solo en el log (no hay columna). Verificado: `tsc`, `eslint` y `depcruise` en verde. NO ejecutadas las pruebas (las corre el agente de pruebas).
