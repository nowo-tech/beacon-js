import { encodeEnvelope, serializeLine } from '@nowo-tech/beacon-node';
import { CLOCK_MS } from './shared.ts';

/** A hand-made envelope for negative cases (still encoded by the real encoder). */
export function encodeEnvelopeForGolden(event: Record<string, unknown>): string {
  const eventId = 'f'.repeat(32);
  return encodeEnvelope(
    {
      event_id: eventId,
      sent_at: new Date(CLOCK_MS).toISOString(),
      sdk: { name: 'nowo.javascript.node', version: '0.0.0' },
    },
    [
      {
        type: 'event',
        payload: serializeLine({ event_id: eventId, timestamp: CLOCK_MS / 1000, ...event }),
      },
    ],
  );
}
