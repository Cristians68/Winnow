import type { ReviewSignal, ProductSnapshot } from '../types.js';
import { hasPhraseList, normaliseLanguage } from '../language.js';
import {
  incentivePhrasesFor,
  templatePhrasesFor,
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
 *
 * ## Language
 *
 * This is the one check whose evidence is made of specific words, so it is the
 * one check that cannot be quietly generalised across storefronts. Against a
 * language we have no phrase list for it would match nothing and report "No
 * incentive disclosures, boilerplate or generated-text patterns found" — a
 * clean bill of health issued by a check that never looked. `unavailable`
 * exists to say that out loud instead.
 *
 * The generated-text heuristic is held to English even where phrase lists
 * exist. Its three thresholds were tuned against English prose, and sentence
 * rhythm and type-token ratio are not language-invariant: German compounding
 * alone shifts lexical diversity enough to make the numbers mean something
 * different. Porting the thresholds without re-tuning them would be a guess
 * wearing the costume of a measurement.
 */
export const phrasingSignal: ReviewSignal = {
  id: 'phrasing',
  label: 'Review language',

  unavailable(snapshot: ProductSnapshot): string | null {
    const language = normaliseLanguage(snapshot.language);
    if (hasPhraseList(language)) return null;
    return language === null
      ? "Winnow couldn't tell what language this page is in, so the wording checks were skipped rather than run against the wrong dictionary."
      : "Winnow's wording checks don't cover this storefront's language yet, so this check was skipped rather than reporting a clean result it didn't earn.";
  },

  evaluate(snapshot: ProductSnapshot) {
    const out = new Map<string, { delta: number; reason: string }>();

    const language = normaliseLanguage(snapshot.language);
    if (!hasPhraseList(language)) return out;

    const incentivePhrases = incentivePhrasesFor(language);
    const templatePhrases = templatePhrasesFor(language);

    for (const review of snapshot.reviews) {
      const text = review.text ?? '';
      if (text.trim().length === 0) continue;

      let delta = 0;
      const reasons: string[] = [];

      // Disclosed incentive. Strong and unambiguous — the reviewer told us.
      const incentives = matchPhrases(text, incentivePhrases);
      if (incentives.length > 0) {
        delta += 0.45;
        reasons.push('Discloses a free or discounted product in exchange for the review');
      }

      // Template boilerplate. Weak individually; meaningful in volume.
      const templates = matchPhrases(text, templatePhrases);
      if (templates.length >= 2) {
        delta += 0.12 * Math.min(templates.length, 3);
        reasons.push('Built largely from generic review boilerplate');
      }

      // Machine-generated heuristic — requires all three conditions, and
      // English, because that is the only language its thresholds were set
      // against. See the note at the top of this file.
      const words = wordCount(text);
      if (language === 'en' && words >= 40) {
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
