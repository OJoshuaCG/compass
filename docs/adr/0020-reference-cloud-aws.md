# ADR 0020: Nube de referencia AWS, adaptadores intercambiables

- **Estado**: Aceptada con confirmación pendiente
- **Fecha**: 2026-10-26
- **Referencias**: [`plan.md`](../../plan.md) secciones "Infraestructura, despliegue y operación" y "Decisiones pendientes del equipo" (proveedor de nube); [`docs/backend.md`](../backend.md) §6.3.

> **Confirmación pendiente**: el proveedor de nube sigue en las decisiones pendientes del plan ("AWS es la referencia del plan; confirmar o elegir GCP o Azure"). Esta decisión fija la arquitectura para que **no dependa** del proveedor; no cierra la elección del proveedor. Se actualizará el estado a "Aceptada" cuando el equipo confirme.

## Contexto

Tres personas no deben operar bases de datos ni KMS propios, por lo que conviene usar servicios gestionados. Aun así, el dominio no debe quedar atado a un proveedor.

## Decisión

AWS es la referencia de despliegue con servicios gestionados: ECS Fargate (API y worker, misma imagen con otro comando), RDS PostgreSQL Multi-AZ, ElastiCache, KMS (una KEK por organización), Secrets Manager, ALB + WAF, S3 con Object Lock (archivo de auditoría) y SES. Cada servicio externo está detrás de un puerto (`KeyManagementPort`, correo, SMS, etc.), con adaptador AWS y adaptadores locales o falsos para desarrollo y pruebas; GCP o Azure tienen equivalentes directos.

## Alternativas consideradas

- **GCP o Azure como referencia**: el plan las lista como equivalentes directos y deja la confirmación pendiente; definen KMS, base de datos gestionada y correo.
- **Autoalojar PostgreSQL y KMS** _(inferida del plan)_: descartado por el tamaño del equipo.

## Consecuencias

- **Positivas**: operación reducida; el dominio no depende del proveedor.
- **Negativas o costos**: hasta confirmar, el runbook y las tarifas del KMS son de referencia AWS; cambiar de proveedor implica nuevos adaptadores y revisar los runbooks.
- **Verificación**: ningún módulo de dominio importa SDK de proveedor (lint de límites); el adaptador local se niega a arrancar con `NODE_ENV=production`.
