/*
 * Session store — Vercel KV backend (ui-gameplay spec §4.4 + §10.8).
 *
 * Exposes a Map-shaped `get / set / delete` interface over Redis managed by
 * @vercel/kv. Callers don't care about the backend — this layer is the seam
 * where we could swap to another KV implementation without touching API routes.
 *
 * Required environment variables (set in Vercel dashboard + .env.local):
 *   - KV_URL
 *   - KV_REST_API_TOKEN
 *
 * Missing env vars only surface at first call, not module load — this keeps
 * unit tests (which mock this module via vi.mock) from tripping on env.
 *
 * NOTE: @vercel/kv@3 is marked deprecated by Vercel in favour of the newer
 * @upstash/redis path, but the API contract we need (get/set/del with JSON
 * values + TTL) is stable. Migration is post-hackathon scope.
 */

import { kv } from '@vercel/kv';
import type { Session } from '../game/types';

const TTL_SECONDS = 3600; // 1 hour — ui-gameplay §10.8

/** Returns the session stored under `id`, or null if absent. */
export function get(id: string): Promise<Session | null> {
  return kv.get<Session>(sessionKey(id));
}

/** Upsert a session at `id` with a 1-hour TTL. */
export async function set(id: string, session: Session): Promise<void> {
  await kv.set(sessionKey(id), session, { ex: TTL_SECONDS });
}

/** Delete the session stored under `id`. No-op if absent. */
// Using `delete` as an identifier collides with the reserved word; export as
// `del` internally and re-export with the public name via the namespace below.
async function del(id: string): Promise<void> {
  await kv.del(sessionKey(id));
}

export { del as delete };

function sessionKey(id: string): string {
  return `hearsay:session:${id}`;
}
