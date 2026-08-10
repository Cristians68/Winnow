import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  readCache, rememberGrade, clearCache, CACHE_KEY, CACHE_CAP, CACHE_TTL_DAYS,
} from '../src/shared/cache.js';

const store: Record<string, unknown> = {};
beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: async (key: string) => ({ [key]: store[key] }),
        set: async (patch: Record<string, unknown>) => Object.assign(store, patch),
        remove: async (key: string) => { delete store[key]; },
      },
    },
  });
});

const entry = (asin: string, over: Partial<{ grade: any; date: string; engineVersion: string }> = {}) => ({
  asin, grade: over.grade ?? 'B', score: 80,
  engineVersion: over.engineVersion ?? '0.3.0',
  date: over.date ?? new Date().toISOString().slice(0, 10),
});

describe('grade cache', () => {
  it('remembers a grade and reads it back', async () => {
    await rememberGrade(entry('B0TEST0001'));
    expect((await readCache()).get('B0TEST0001')?.grade).toBe('B');
  });

  it('caps the number of entries and evicts least-recently-seen first', async () => {
    for (let i = 0; i < CACHE_CAP + 10; i++) {
      await rememberGrade(entry(`B${String(i).padStart(9, '0')}`));
    }
    const cache = await readCache();
    expect(cache.size).toBe(CACHE_CAP);
    expect(cache.has('B000000000')).toBe(false);          // oldest, evicted
    expect(cache.has(`B${String(CACHE_CAP + 9).padStart(9, '0')}`)).toBe(true);
  });

  it('drops entries older than the TTL', async () => {
    const old = new Date(Date.now() - (CACHE_TTL_DAYS + 1) * 864e5).toISOString().slice(0, 10);
    await rememberGrade(entry('B0OLD00001', { date: old }));
    await rememberGrade(entry('B0NEW00001'));
    const cache = await readCache();
    expect(cache.has('B0OLD00001')).toBe(false);
    expect(cache.has('B0NEW00001')).toBe(true);
  });

  // A grade traces to the logic that produced it — the panel prints the engine
  // version for exactly this reason. Showing a grade from a different engine
  // would break that trace silently.
  it('ignores entries produced by a different engine version', async () => {
    await rememberGrade(entry('B0STALE001', { engineVersion: '0.1.0' }));
    expect((await readCache()).has('B0STALE001')).toBe(false);
  });

  it('clears everything on request', async () => {
    await rememberGrade(entry('B0TEST0001'));
    await clearCache();
    expect((await readCache()).size).toBe(0);
  });

  it('degrades to an empty cache when storage throws', async () => {
    vi.stubGlobal('chrome', { storage: { local: { get: async () => { throw new Error('nope'); } } } });
    expect((await readCache()).size).toBe(0);
  });

  it('stores nothing under any key but its own', async () => {
    await rememberGrade(entry('B0TEST0001'));
    expect(Object.keys(store)).toEqual([CACHE_KEY]);
  });
});
