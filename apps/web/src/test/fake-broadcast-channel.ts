/**
 * `BroadcastChannel` falso y aislado en el proceso: el real de Node cruza hilos de trabajo, y las
 * pruebas que corren en paralelo se avisarían entre sí. Replica la semántica del estándar: el
 * mensaje llega a las demás instancias abiertas con el mismo nombre (no a quien lo envía) y el
 * cierre de quien envía no lo cancela.
 */
export class FakeBroadcastChannel {
  static readonly open = new Set<FakeBroadcastChannel>();
  /** Todo lo enviado por cualquier instancia: permite comprobar que no viaja nada más. */
  static readonly posted: unknown[] = [];

  onmessage: ((event: MessageEvent) => void) | null = null;

  constructor(readonly name: string) {
    FakeBroadcastChannel.open.add(this);
  }

  postMessage(data: unknown): void {
    FakeBroadcastChannel.posted.push(data);
    const recipients = [...FakeBroadcastChannel.open].filter(
      (channel) => channel !== this && channel.name === this.name,
    );
    queueMicrotask(() => {
      for (const channel of recipients) channel.onmessage?.(new MessageEvent('message', { data }));
    });
  }

  close(): void {
    FakeBroadcastChannel.open.delete(this);
  }

  static reset(): void {
    FakeBroadcastChannel.open.clear();
    FakeBroadcastChannel.posted.length = 0;
  }
}
