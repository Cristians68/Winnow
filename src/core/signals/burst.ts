import type { ReviewSignal, ProductSnapshot, Review } from '../types.js';
import { clamp } from '../text.js';

const DAY_MS = 86_400_000;
const WINDOW_DAYS = 3;

/**
 * Temporal clustering.
 *
 * Paid review campaigns land in waves. Organic reviews arrive as a trickle
 * proportional to sales. So when a large share of a sample that otherwise spans
 * months is concentrated into a few days, those reviews are suspect.
 *
 * Note this signal is deliberately weak on small samples: with 8-13 visible
 * reviews, coincidental clustering is common. It only fires when the sample
 * spans a meaningful period and the concentration is severe.
 */
export const burstSignal: ReviewSignal = {
  id: 'burst',
  label: 'Review timing',

  evaluate(snapshot: ProductSnapshot) {
    const out = new Map<string, { delta: number; reason: string }>();

    const dated = snapshot.reviews
      .filter((r): r is Review & { date: string } => Boolean(r.date))
      .map((r) => ({ review: r, time: Date.parse(r.date) }))
      .filter((r) => Number.isFinite(r.time))
      .sort((a, b) => a.time - b.time);

    if (dated.length < 5) return out;

    const spanDays = (dated[dated.length - 1]!.time - dated[0]!.time) / DAY_MS;
    // If everything genuinely happened in one week, there is no baseline to
    // compare a burst against.
    if (spanDays < 30) return out;

    // Slide a fixed window across the sample and keep the densest cluster.
    let best: { members: typeof dated; share: number } | null = null;
    for (let i = 0; i < dated.length; i++) {
      const start = dated[i]!.time;
      const members = dated.filter(
        (d) => d.time >= start && d.time <= start + WINDOW_DAYS * DAY_MS,
      );
      const share = members.length / dated.length;
      if (!best || share > best.share) best = { members, share };
    }

    if (!best || best.share < 0.5 || best.members.length < 3) return out;

    // How much denser than an even spread is this window?
    const expectedShare = clamp(WINDOW_DAYS / spanDays, 0.01, 1);
    const excess = clamp((best.share - expectedShare) / (1 - expectedShare));
    const delta = clamp(0.4 * excess);
    if (delta < 0.1) return out;

    const dayLabel = new Date(best.members[0]!.time).toISOString().slice(0, 10);
    for (const { review } of best.members) {
      out.set(review.id, {
        delta,
        reason: `Posted in a cluster of ${best.members.length} reviews within ${WINDOW_DAYS} days (around ${dayLabel}), against a sample spanning ${Math.round(spanDays)} days`,
      });
    }

    return out;
  },
};
