/**
 * The local disagreement log.
 *
 * Two properties matter more than the rest and are tested first: that nothing
 * here ever transmits, and that the raw ASIN never reaches disk. Both are
 * promises made in PRIVACY.md, and a regression in either would be a privacy
 * incident in a privacy product rather than an ordinary bug.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  DISAGREEMENTS_KEY,
  MAX_DISAGREEMENTS,
  clearDisagreements,
  exportDisagreements,
  hashAsin,
  listDisagreements,
  recordDisagreement,
  toRecord,
} from '../src/shared/feedback.js';
import type { Analysis, Grade, SignalResult } from '../src/core/types.js';

let storage: Record<string, unknown>;
let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  storage = {};
  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: {
      local: {
        get: vi.fn(async (key: string) => ({ [key]: storage[key] })),
        set: vi.fn(async (patch: Record<string, unknown>) => {
          Object.assign(storage, patch);
        }),
        remove: vi.fn(async (key: string) => {
          delete storage[key];
        }),
      },
    },
  };

  // Any network call from this module is a bug, so make one impossible to miss.
  fetchSpy = vi.fn(() => {
    throw new Error('feedback must never make a network request');
  });
  vi.stubGlobal('fetch', fetchSpy);
});

function signal(id: string, decisive: boolean): SignalResult {
  return {
    id,
    label: id,
    status: 'warn',
    score: 0.5,
    weight: 1,
    confidence: 0.7,
    detail: 'detail',
    contribution: {
      gradeWithout: 'A' as Grade,
      trustScoreWithout: 90,
      trustScoreDelta: decisive ? -15 : -1,
      decisive,
    },
  };
}

function analysis(overrides: Partial<Analysis> = {}): Analysis {
  return {
    asin: 'B000000001',
    grade: 'C',
    trustScore: 61,
    adjustedRating: 3.9,
    displayedRating: 4.6,
    discountedCount: 3,
    concerningSignals: 2,
    sampleSize: 9,
    confidence: 'moderate',
    basis: 'basis',
    signals: [signal('verified', true), signal('burst', false)],
    assessments: [],
    insufficientData: false,
    engineVersion: '0.1.0',
    analysedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('privacy guarantees', () => {
  it('never makes a network request', async () => {
    await recordDisagreement(analysis(), 'too-harsh');
    await listDisagreements();
    await exportDisagreements();
    await clearDisagreements();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('never writes the raw ASIN to storage', async () => {
    await recordDisagreement(analysis({ asin: 'B0ASINLEAK' }), 'too-harsh');
    expect(JSON.stringify(storage)).not.toContain('B0ASINLEAK');
  });

  it('hashes the same ASIN consistently and different ASINs differently', async () => {
    const a = await hashAsin('B000000001');
    expect(a).toBe(await hashAsin('B000000001'));
    expect(a).not.toBe(await hashAsin('B000000002'));
  });

  it('records a date but not a precise time, so the log is not a browsing timeline', async () => {
    await recordDisagreement(analysis(), 'too-harsh');
    const [record] = await listDisagreements();
    expect(record!.recordedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(JSON.stringify(record)).not.toMatch(/T\d{2}:\d{2}/);
  });
});

describe('recording', () => {
  it('stores a rejection with the signal contributions attached', async () => {
    await recordDisagreement(analysis(), 'too-harsh', 'featured');
    const records = await listDisagreements();

    expect(records).toHaveLength(1);
    expect(records[0]!.direction).toBe('too-harsh');
    expect(records[0]!.grade).toBe('C');
    expect(records[0]!.sampleSource).toBe('featured');

    // The whole point of the log: which check was carrying the grade.
    const decisive = records[0]!.signals.filter((s) => s.decisive);
    expect(decisive.map((s) => s.id)).toEqual(['verified']);
  });

  it('keeps both directions for the same listing', async () => {
    await recordDisagreement(analysis(), 'too-harsh');
    await recordDisagreement(analysis(), 'too-lenient');
    expect(await listDisagreements()).toHaveLength(2);
  });

  it('replaces rather than stacks when the same listing is rejected the same way twice', async () => {
    await recordDisagreement(analysis({ trustScore: 61 }), 'too-harsh');
    await recordDisagreement(analysis({ trustScore: 44 }), 'too-harsh');

    const records = await listDisagreements();
    expect(records).toHaveLength(1);
    expect(records[0]!.trustScore).toBe(44);
  });

  it('caps the log and drops the oldest entries', async () => {
    const overflow = MAX_DISAGREEMENTS + 15;
    for (let i = 0; i < overflow; i++) {
      await recordDisagreement(analysis({ asin: `B${String(i).padStart(9, '0')}` }), 'too-harsh');
    }
    expect(await listDisagreements()).toHaveLength(MAX_DISAGREEMENTS);
  });

  it('survives a storage failure without throwing into the panel', async () => {
    (globalThis as unknown as { chrome: { storage: { local: { set: unknown } } } }).chrome.storage.local.set =
      vi.fn(async () => {
        throw new Error('QUOTA_BYTES exceeded');
      });
    await expect(recordDisagreement(analysis(), 'too-harsh')).resolves.toBeUndefined();
  });
});

describe('export and clear', () => {
  it('exports valid JSON containing the records', async () => {
    await recordDisagreement(analysis(), 'too-lenient');
    const parsed = JSON.parse(await exportDisagreements());
    expect(parsed.count).toBe(1);
    expect(parsed.records[0].direction).toBe('too-lenient');
  });

  it('exports an empty set rather than failing when nothing was recorded', async () => {
    const parsed = JSON.parse(await exportDisagreements());
    expect(parsed.count).toBe(0);
    expect(parsed.records).toEqual([]);
  });

  it('clears everything', async () => {
    await recordDisagreement(analysis(), 'too-harsh');
    await clearDisagreements();
    expect(await listDisagreements()).toEqual([]);
    expect(storage[DISAGREEMENTS_KEY]).toBeUndefined();
  });

  it('returns an empty list rather than throwing on corrupt storage', async () => {
    storage[DISAGREEMENTS_KEY] = 'not an array';
    expect(await listDisagreements()).toEqual([]);
  });
});

describe('record shape', () => {
  it('marks signals without a contribution as having moved nothing', () => {
    const bare: SignalResult = {
      id: 'depth',
      label: 'depth',
      status: 'pass',
      score: 1,
      weight: 1,
      confidence: 1,
      detail: 'd',
    };
    const record = toRecord(analysis({ signals: [bare] }), 'too-harsh', 'abc123');
    expect(record.signals[0]!.decisive).toBe(false);
    expect(record.signals[0]!.trustScoreDelta).toBe(0);
  });
});
