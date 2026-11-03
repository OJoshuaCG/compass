import { parseRawMessage } from './mime-parse-core.js';

/**
 * Punto de entrada del proceso hijo de análisis MIME (ADR 0045, paso 8): lee el mensaje crudo por stdin y
 * escribe el resultado JSON por stdout. No importa nada de base de datos, KMS ni configuración, y el padre
 * lo lanza sin variables de entorno: un fallo en el analizador no alcanza contraseñas ni claves.
 */
async function main(): Promise<void> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  const parsed = await parseRawMessage(Buffer.concat(chunks));
  process.stdout.write(JSON.stringify(parsed));
}

main().catch(() => {
  // Sin detalle: el mensaje de error podría contener fragmentos del correo.
  process.exit(2);
});
