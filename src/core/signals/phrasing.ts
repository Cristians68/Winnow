import type { ReviewSignal, ProductSnapshot } from '../types.js';
import {
  INCENTIVE_PHRASES,
  TEMPLATE_PHRASES,
  matchPhrases,
  lexicalDiversity,
  sentenceLengthVariation,
  specificityMarkers,
  wordCount,
  clamp,
} from '../text.js';

/**
 * Language-based signals: disclosed incentives, template-farm boilerplate, and
 * a local heuristic for machine-generated text.
 *
 * The AI heuristic here is intentionally conservative. Robust AI-text detection
 * needs cross-product corpus comparison, which is the server tier's job. What we
 * can do locally is flag the combination that is hard to produce accidentally:
 * uniform sentence rhythm + narrow vocabulary + zero concrete detail. Any one of
 * those alone is normal writing, so we only flag when they co-occur.
 */
export const phrasingSignal: ReviewSignal = {
  id: 'phrasing',
  label: 'Review language',

  evaluate(snapshot: ProductSnapshot) {
    const out = new Map<string, { delta: number; reason: string }>();

    for (const review of snapshot.reviews) {
      const text = review.text ?? '';
      if (text.trim().length === 0) continue;

      let delta = 0;
      const reasons: string[] = [];

      // Disclosed incentive. Strong and unambiguous — the reviewer told us.
      const incentives = matchPhrases(text, INCENTIVE_PHRASES);
      if (incentives.length > 0) {
        delta += 0.45;
        reasons.push('Discloses a free or discounted product in exchange for the review');
      }

      // Template boilerplate. Weak individually; meaningful in volume.
      const templates = matchPhrases(text, TEMPLATE_PHRASES);
      if (templates.length >= 2) {
        delta += 0.12 * Math.min(templates.length, 3);
        reasons.push('Built largely from generic review boilerplate');
      }

      // Machine-generated heuristic — requires all three conditions.
      const words = wordCount(text);
      if (words >= 40) {
        const uniformity = sentenceLengthVariation(text); // lower = more uniform
        const diversity = lexicalDiversity(text);
        const specifics = specificityMarkers(text);

        if (uniformity < 0.35 && diversity < 0.55 && specifics === 0) {
          const severity =
            clamp((0.35 - uniformity) / 0.35) * clamp((0.55 - diversity) / 0.55);
          delta += 0.3 * severity;
          reasons.push(
            'Uniform sentence rhythm, narrow vocabulary and no concrete details — consistent with generated text',
          );
        }
      }

      if (delta > 0) {
        out.set(review.id, { delta, reason: reasons.join('; ') });
      }
    }

    return out;
  },
};
