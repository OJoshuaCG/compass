/** Fachada pública del módulo `notification`. */
export type { InvitationMessage, Mailer } from './application/ports/mailer.js';
export { InMemoryMailer } from './infrastructure/in-memory-mailer.js';
export { LogMailer } from './infrastructure/log-mailer.js';
