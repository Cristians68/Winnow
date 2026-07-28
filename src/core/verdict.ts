/**
 * The plain-English "so should I buy it?" line.
 *
 * Everything else in the panel reports evidence. This translates that evidence
 * into the decision the shopper actually came to make, because a letter grade
 * and a trust score still leave them doing the translation themselves.
 *
 * ## The boundary, which is the whole design
 *
 * Winnow measures whether the *reviews* are trustworthy. It never reads whether
 * the reviews say the product is any good — no sentiment, no feature extraction,
 * nothing about quality. So it cannot tell anyone whether to buy something, and
 * a line that implied otherwise would be the same false confidence this product
 * exists to call out.
 *
 * What it can do honestly is answer the question one step back: **how much of
 * this star rating should you believe, and what should you do about it?** That
 * is a real answer to a real question, and it is entirely within the evidence.
 *
 * So the verdict always talks about the rating and never about the product. It
 * says "treat 4.8 as closer to 3.9 and read the critical reviews", not "this is
 * a bad product". When the reviews look clean it explicitly hands the decision
 * back: the rating is worth trusting, judge the product on its merits.
 */

import type { Analysis } from './types.js';

export interface Verdict {
  /** Short answer, safe to read on its own. */
  headline: string;
  /** What to actually do, one or two sentences. */
  advice: string;
  /** Drives colour only; meaning is always carried by the text too. */
  tone: 'good' | 'mixed' | 'bad' | 'unknown';
}

/** A gap this size or larger between displayed and adjusted is worth acting on. */
const MATERIAL_GAP = 0.3;

function stars(value: number): string {
  return `${value.toFixed(1)}★`;
}

export function buildVerdict(analysis: Analysis): Verdict {
  const { grade, displayedRating, adjustedRating, insufficientData, sampleSize, discountedCount } = analysis;

  // Never advise from evidence we do not have. This is the same refusal the
  // engine makes about the adjusted rating, carried through to the advice.
  if (insufficientData) {
    return {
      headline: 'Not enough to judge',
      advice:
        "Winnow couldn't read enough of this page to say anything useful. That's a limit of what we could read, not a finding about the product — judge it the way you would with no tool at all.",
      tone: 'unknown',
    };
  }

  const gap =
    displayedRating !== null && adjustedRating !== null ? displayedRating - adjustedRating : 0;
  const materialGap = gap >= MATERIAL_GAP;
  const shown = displayedRating !== null ? stars(displayedRating) : 'the star rating';

  // Where the rating cannot be restated, the advice still has to work.
  const restated =
    adjustedRating !== null && materialGap
      ? `Winnow's estimate is closer to ${stars(adjustedRating)}.`
      : '';

  if (grade === 'D' || grade === 'F') {
    return {
      headline: materialGap ? `Don't rely on ${shown}` : `Treat ${shown} with caution`,
      advice:
        `${restated} Enough of the visible reviews look manipulated that the headline rating is not a safe guide. ` +
        'Read the 1- and 2-star reviews before deciding, and weigh them more heavily than the average.',
      tone: 'bad',
    };
  }

  if (grade === 'C') {
    return {
      headline: `${shown} looks softer than it appears`,
      advice:
        `${restated} Some of what is visible does not hold up, so treat the rating as an optimistic figure rather than a wrong one. ` +
        'Worth reading the critical reviews before you commit.',
      tone: 'mixed',
    };
  }

  // A and B. The reviews are not the problem, so hand the decision back.
  const caveat =
    discountedCount > 0
      ? ` ${discountedCount} of the ${sampleSize} visible reviews were discounted, which is within the range of a normal listing.`
      : '';

  return {
    headline: materialGap ? `${shown} is roughly right` : `${shown} looks earned`,
    advice:
      `Winnow found no real reason to doubt these reviews, so the rating is worth taking at face value.${caveat} ` +
      'Whether the product suits you is a separate question, and one Winnow does not try to answer — it reads review integrity, not quality.',
    tone: 'good',
  };
}
