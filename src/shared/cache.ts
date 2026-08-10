/**
 * A local, capped, expiring record of grades Winnow has already computed.
 *
 * ## Why this exists, and why it is this small
 *
 * Search result cards carry an average star rating and a rating count. They do
 * not carry the histogram, and they do not carry a single review. The engine
 * needs at least three readable reviews to grade, so there is no honest way to
 * grade a product from its search card.
 *
 * The dishonest way is available and we are not taking it: fetch each card's
 * /dp/ page in the background. That means crawling Amazon with the user's
 * logged-in session, which risks *their* account, and it is a standing refusal.
 *
 * So the search page shows grades that were already earned on the product's own
 * page, and says "not checked" for everything else. Coverage starts empty and
 * builds as you browse. That is a weaker feature than the one people remember
 * from Fakespot, and it is the one we can stand behind.
 *
 * ## What this costs the user
 *
 * It is a local record of products they have opened — a shopping history, in
 * plain terms. It never leaves the machine, it holds 500 entries for 90 days,
 * and Options can erase it in one click. PRIVACY.md says all of that in the
 * same words. The ASIN is stored in clear rather than hashed: the cache's whole
 * job is to match a specific ASIN on a search page, so hashing would buy
 * nothing that a local reader could not undo by hashing candidate ASINs
 * themselves, and it would make the stored data harder for the user to inspect.
 * Storing it plainly and disclosing it plainly is the more honest of the two.
 */

import type { Grade } from '../core/types.js';
import { ENGINE_VERSION } from '../core/score.js';

export interface CachedGrade {
  asin: string;
  grade: Grade;
  score: number;
  /** The engine that produced this grade. Mismatches are treated as misses. */
  engineVersion: string;
  /** ISO date (not a timestamp) the grade was computed. */
  date: string;
  /** Epoch ms of last write, used only for LRU eviction. Never displayed. */
  seen: number;
}

export const CACHE_KEY = 'winnow:grades';
export const CACHE_CAP = 500;
export const CACHE_TTL_DAYS = 90;

function isFresh(entry: CachedGrade, now: number): boolean {
  if (entry.engineVersion !== ENGINE_VERSION) return false;
  const at = Date.parse(entry.date);
  if (!Number.isFinite(at)) return false;
  return now - at <= CACHE_TTL_DAYS * 864e5;
}

async function load(): Promise<CachedGrade[]> {
  try {
    const stored = await chrome.storage.local.get(CACHE_KEY);
    const raw = stored[CACHE_KEY];
    return Array.isArray(raw) ? (raw as CachedGrade[]) : [];
  } catch {
    // A cache that cannot be read is a cache that is empty. The search page
    // then shows "not checked" everywhere, which is the correct degraded state:
    // absent, not wrong.
    return [];
  }
}

/** Fresh entries only, keyed by ASIN. */
export async function readCache(): Promise<Map<string, CachedGrade>> {
  const now = Date.now();
  const map = new Map<string, CachedGrade>();
  for (const entry of await load()) {
    if (entry && typeof entry.asin === 'string' && isFresh(entry, now)) {
      map.set(entry.asin, entry);
    }
  }
  return map;
}

/** Record a grade, evicting the least recently seen entry once over cap. */
export async function rememberGrade(entry: Omit<CachedGrade, 'seen'>): Promise<void> {
  try {
    const now = Date.now();
    const kept = (await load()).filter((e) => e && e.asin !== entry.asin && isFresh(e, now));
    // Newest first, and *before* the sort: two writes inside the same
    // millisecond carry identical `seen` values, and Array.prototype.sort is
    // stable, so a tie is broken by position. Pushing to the end would put the
    // newest entry last among its ties and evict it first — the exact opposite
    // of least-recently-seen eviction, and invisible until the cache fills.
    kept.unshift({ ...entry, seen: now });
    kept.sort((a, b) => b.seen - a.seen);
    await chrome.storage.local.set({ [CACHE_KEY]: kept.slice(0, CACHE_CAP) });
  } catch {
    // Fire-and-forget by design: a failed cache write must never interrupt or
    // delay the panel the user is actually looking at.
  }
}

export async function clearCache(): Promise<void> {
  try {
    await chrome.storage.local.remove(CACHE_KEY);
  } catch {
    /* nothing useful to do, and nothing worth interrupting anyone over */
  }
}
