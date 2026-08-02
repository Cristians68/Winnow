/**
 * Local record of grades the user thought were wrong.
 *
 * ## Why this never leaves the device
 *
 * The obvious design is to POST disagreements to a server and watch the
 * aggregate. Winnow cannot do that. PRIVACY.md puts analytics and telemetry in
 * the "never" list, that promise is already shipped to the Web Store, and a
 * review-integrity tool that quietly added a background reporting channel would
 * be dishonest in exactly the way it exists to complain about.
 *
 * So the log is local, capped, and inert: nothing reads it but the user, and it
 * moves only when they click Export. That costs sample size — most people will
 * never export — and the trade is worth it, because the alternative costs the
 * one thing the product is actually selling.
 *
 * ## Why it stores contributions rather than just a thumbs-down
 *
 * "This grade is wrong" on its own is unactionable. What makes a rejected grade
 * diagnosable is knowing which check was carrying it, which is precisely what
 * the leave-one-out contributions in `SignalContribution` measure. Recording
 * those alongside the rejection turns a pile of complaints into a list of
 * suspects, and it is the difference between calibration evidence and noise.
 */

import type { Analysis, Grade } from '../core/types.js';

/** Which way the user thought the grade was wrong. */
export type DisagreementDirection = 'too-harsh' | 'too-lenient';

export interface SignalSnapshotEntry {
  id: string;
  status: string;
  /** Whether this check alone was holding the grade where it landed. */
  decisive: boolean;
  trustScoreDelta: number;
}

export interface DisagreementRecord {
  /**
   * SHA-256 of the ASIN, not the ASIN.
   *
   * The log still needs to tell two listings apart and spot the same one being
   * rejected repeatedly, and a hash does both. Storing the raw ASIN would put a
   * plain browsing history in extension storage for no extra analytical value —
   * and PRIVACY.md already promises that no Amazon identifier is written to disk.
   */
  asinHash: string;
  direction: DisagreementDirection;
  grade: Grade;
  trustScore: number;
  sampleSize: number;
  sampleSource: string;
  discountedCount: number;
  signals: SignalSnapshotEntry[];
  engineVersion: string;
  /** Date only. A precise timestamp would make the log a browsing timeline. */
  recordedOn: string;
}

export const DISAGREEMENTS_KEY = 'winnow:disagreements';

/**
 * Hard cap on stored records.
 *
 * Unbounded local logs are their own privacy problem: they turn into a
 * long-lived history nobody remembers consenting to. Oldest entries fall off.
 */
export const MAX_DISAGREEMENTS = 200;

/** Non-cryptographic use of a cryptographic digest: identity without identifiability. */
export async function hashAsin(asin: string): Promise<string> {
  const bytes = new TextEncoder().encode(`winnow:${asin}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 16);
}

export function toRecord(
  analysis: Analysis,
  direction: DisagreementDirection,
  asinHash: string,
  sampleSource = 'featured',
): DisagreementRecord {
  return {
    asinHash,
    direction,
    grade: analysis.grade,
    trustScore: analysis.trustScore,
    sampleSize: analysis.sampleSize,
    sampleSource,
    discountedCount: analysis.discountedCount,
    signals: analysis.signals.map((s) => ({
      id: s.id,
      status: s.status,
      decisive: s.contribution?.decisive ?? false,
      trustScoreDelta: s.contribution?.trustScoreDelta ?? 0,
    })),
    engineVersion: analysis.engineVersion,
    recordedOn: new Date().toISOString().slice(0, 10),
  };
}

export async function listDisagreements(): Promise<DisagreementRecord[]> {
  try {
    const stored = await chrome.storage.local.get(DISAGREEMENTS_KEY);
    const value = stored[DISAGREEMENTS_KEY];
    return Array.isArray(value) ? (value as DisagreementRecord[]) : [];
  } catch {
    return [];
  }
}

/**
 * Append one rejection.
 *
 * Re-recording the same listing in the same direction replaces the earlier
 * entry rather than stacking, so one annoyed user clicking twice does not
 * outweigh two users clicking once.
 */
export async function recordDisagreement(
  analysis: Analysis,
  direction: DisagreementDirection,
  sampleSource = 'featured',
): Promise<void> {
  const asinHash = await hashAsin(analysis.asin);
  const record = toRecord(analysis, direction, asinHash, sampleSource);

  const existing = await listDisagreements();
  const deduped = existing.filter(
    (r) => !(r.asinHash === asinHash && r.direction === direction),
  );
  const next = [...deduped, record].slice(-MAX_DISAGREEMENTS);

  try {
    await chrome.storage.local.set({ [DISAGREEMENTS_KEY]: next });
  } catch {
    // A full or unavailable storage area must never break the panel. The
    // feedback log is a convenience; the analysis is the product.
  }
}

export async function clearDisagreements(): Promise<void> {
  try {
    await chrome.storage.local.remove(DISAGREEMENTS_KEY);
  } catch {
    // Nothing to do — the caller re-reads and shows whatever is actually there.
  }
}

/** The export blob. Pretty-printed because a human is going to read it. */
export async function exportDisagreements(): Promise<string> {
  const records = await listDisagreements();
  return JSON.stringify(
    {
      exportedOn: new Date().toISOString().slice(0, 10),
      note: 'Winnow calibration feedback. Recorded locally, exported manually by the user.',
      count: records.length,
      records,
    },
    null,
    2,
  );
}
