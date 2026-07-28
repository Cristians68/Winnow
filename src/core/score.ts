import type {
  Analysis,
  ConfidenceLevel,
  Grade,
  ProductSignal,
  ProductSnapshot,
  ReviewAssessment,
  ReviewSignal,
  SignalResult,
} from './types.js';
import { clamp } from './text.js';

import { distributionSignal } from './signals/distribution.js';
import { verifiedSignal } from './signals/verified.js';
import { phrasingSignal } from './signals/phrasing.js';
import { duplicationSignal } from './signals/duplication.js';
import { burstSignal } from './signals/burst.js';
import { depthSignal } from './signals/depth.js';
import { helpfulnessSignal } from './signals/helpfulness.js';

export const ENGINE_VERSION = '0.1.0';

export const PRODUCT_SIGNALS: ProductSignal[] = [distributionSignal];

export const REVIEW_SIGNALS: ReviewSignal[] = [
  verifiedSignal,
  phrasingSignal,
  duplicationSignal,
  burstSignal,
  depthSignal,
  helpfulnessSignal,
];

/** Relative weight of the per-review evidence against product-level signals. */
const REVIEW_COMPONENT_WEIGHT = 1.6;

/**
 * Suspicion at which a review counts as discounted.
 *
 * This is the only threshold that drives the headline count and the grade cap,
 * so any signal meant to be able to condemn a review on its own must reach it.
 */
export const DISCOUNT_THRESHOLD = 0.4;

/**
 * Minimum evidence before Winnow will grade at all.
 *
 * The weighted score alone is not enough of a guard. The rating histogram
 * carries weight 1.4, and its confidence stays above zero even on a handful of
 * ratings, so a product with **no readable reviews and four ratings** cleared
 * the old effective-weight floor and graded A at 100/100 — "Reviews look
 * genuine", from no reviews at all. A single rating produced a confident C with
 * an adjusted rating of 5.0.
 *
 * Both were found by live testing, and both are the failure this product exists
 * to avoid: absence of evidence rendered as evidence of absence. A histogram is
 * a summary of reviews, not a substitute for having seen any, so grading now
 * also requires either a usable sample of reviews or enough ratings behind the
 * histogram for it to mean something.
 */
export const MIN_REVIEWS_TO_GRADE = 3;
export const MIN_RATINGS_FOR_HISTOGRAM_ONLY = 50;

/** Assumed star value of a manipulated review when back-solving a clean rating. */
const MANIPULATED_RATING_ASSUMPTION = 5;

/**
 * Extra evidence from the deep-analysis server, folded into the local score.
 *
 * The server can see things a single page cannot — template reuse across
 * products, reviewer networks, listing history — but the grade is still
 * computed here, locally, from the combined evidence. That keeps the scoring
 * logic in the open-source engine rather than behind an API nobody can audit.
 */
export interface DeepAugmentation {
  reviewDeltas: Array<{ reviewId: string; delta: number; reason: string }>;
  signals: SignalResult[];
}

export function analyse(snapshot: ProductSnapshot, deep?: DeepAugmentation): Analysis {
  const assessments = assessReviews(snapshot, deep);
  const reviewSignalResults = summariseReviewSignals(snapshot, assessments);
  const productSignalResults = PRODUCT_SIGNALS.map((s) => s.evaluate(snapshot));
  const signals = [...productSignalResults, ...reviewSignalResults, ...(deep?.signals ?? [])];

  const sampleSize = snapshot.reviews.length;
  const meanSuspicion =
    sampleSize === 0
      ? 0
      : assessments.reduce((sum, a) => sum + a.suspicion, 0) / sampleSize;

  const sampleConfidence = sampleConfidenceFrom(sampleSize);

  // --- Weighted trust score -------------------------------------------------
  let weightedSum = 0;
  let effectiveWeight = 0;

  if (sampleSize > 0) {
    const w = REVIEW_COMPONENT_WEIGHT * sampleConfidence;
    weightedSum += (1 - meanSuspicion) * w;
    effectiveWeight += w;
  }

  for (const signal of [...productSignalResults, ...(deep?.signals ?? [])]) {
    if (signal.status === 'insufficient-data') continue;
    const w = signal.weight * signal.confidence;
    weightedSum += signal.score * w;
    effectiveWeight += w;
  }

  // Enough signal weight to compute a number, AND enough underlying evidence for
  // that number to mean anything. The second half is not redundant: see the
  // constants above for the live cases that cleared the first and should not have.
  const thinEvidence =
    sampleSize < MIN_REVIEWS_TO_GRADE &&
    (snapshot.totalRatings ?? 0) < MIN_RATINGS_FOR_HISTOGRAM_ONLY;

  const insufficientData = effectiveWeight < 0.15 || thinEvidence;
  const trustScore = insufficientData
    ? 50
    : Math.round(clamp(weightedSum / effectiveWeight) * 100);

  const displayedRating = snapshot.displayedRating ?? null;
  const adjustedRating = insufficientData
    ? null
    : estimateAdjustedRating(displayedRating, meanSuspicion, sampleConfidence);

  const discountedCount = assessments.filter((a) => a.suspicion >= DISCOUNT_THRESHOLD).length;

  // Signals that reached warn or fail on their own, independent of whether any
  // single review crossed the discount bar. The panel needs this because the two
  // counts can legitimately disagree: several reviews can each be flagged by a
  // check without any one of them accumulating enough suspicion to be discounted.
  // Reporting only the second produced "Nothing flagged across 9 visible
  // reviews" directly above a row reading FLAGGED.
  const concerningSignals = signals.filter(
    (s) => s.status === 'fail' || s.status === 'warn',
  ).length;

  return {
    asin: snapshot.asin,
    grade: insufficientData
      ? 'C'
      : capGradeByDiscountedShare(toGrade(trustScore), discountedCount, sampleSize, concerningSignals),
    trustScore,
    adjustedRating,
    displayedRating,
    discountedCount,
    concerningSignals,
    sampleSize,
    confidence: confidenceLevel(sampleSize, snapshot, insufficientData),
    basis: describeBasis(sampleSize, snapshot, insufficientData),
    signals,
    assessments,
    insufficientData,
    engineVersion: ENGINE_VERSION,
    analysedAt: new Date().toISOString(),
  };
}

/** Signals that are meaningless if we failed to read the review text. */
const TEXT_DEPENDENT_SIGNALS = new Set(['phrasing', 'duplication', 'depth']);

/**
 * Share of sampled reviews we actually recovered text for.
 *
 * This exists because of a real failure: when Amazon changed its markup, body
 * extraction silently returned empty strings, and Winnow confidently reported
 * "12 of 13 reviews are 5 stars with no written review" — flagging almost every
 * review on the page for a defect in our own parser.
 *
 * A tool whose entire pitch is calibrated honesty cannot fail that way. When
 * coverage collapses, the correct answer is "we couldn't read this", not a
 * grade built on absence of evidence.
 */
export function textCoverage(snapshot: ProductSnapshot): number {
  if (snapshot.reviews.length === 0) return 0;
  const withText = snapshot.reviews.filter((r) => (r.text ?? '').trim().length > 0).length;
  return withText / snapshot.reviews.length;
}

/** Below this, we treat missing text as a parser failure rather than a finding. */
const MIN_TEXT_COVERAGE = 0.35;

export function textExtractionFailed(snapshot: ProductSnapshot): boolean {
  return snapshot.reviews.length >= 3 && textCoverage(snapshot) < MIN_TEXT_COVERAGE;
}

/** Run every review signal and accumulate per-review suspicion. */
export function assessReviews(snapshot: ProductSnapshot, deep?: DeepAugmentation): ReviewAssessment[] {
  const textBroken = textExtractionFailed(snapshot);
  const byReview = new Map<string, ReviewAssessment>(
    snapshot.reviews.map((r) => [r.id, { reviewId: r.id, suspicion: 0, reasons: [] }]),
  );

  for (const signal of REVIEW_SIGNALS) {
    if (textBroken && TEXT_DEPENDENT_SIGNALS.has(signal.id)) continue;
    for (const [reviewId, { delta, reason }] of signal.evaluate(snapshot)) {
      const assessment = byReview.get(reviewId);
      if (!assessment) continue;
      assessment.suspicion += delta;
      assessment.reasons.push(reason);
    }
  }

  for (const { reviewId, delta, reason } of deep?.reviewDeltas ?? []) {
    const assessment = byReview.get(reviewId);
    if (!assessment) continue;
    assessment.suspicion += delta;
    assessment.reasons.push(reason);
  }

  for (const assessment of byReview.values()) {
    assessment.suspicion = clamp(assessment.suspicion);
  }

  return [...byReview.values()];
}

/**
 * Back-solve the rating the product would show if the apparently manipulated
 * share were removed.
 *
 * If share `s` of reviews are manipulated and manipulated reviews sit at ~5
 * stars, then displayed = s*5 + (1-s)*genuine, so genuine = (displayed - 5s)/(1-s).
 *
 * The result is then shrunk toward the displayed rating in proportion to how
 * little of the review base we actually saw. This matters: we typically observe
 * 8-13 *featured* reviews out of thousands, and featured reviews are a biased
 * sample. Presenting an unshrunk estimate off that sample would be exactly the
 * false precision this product exists to call out.
 */
export function estimateAdjustedRating(
  displayedRating: number | null,
  meanSuspicion: number,
  sampleConfidence: number,
): number | null {
  if (displayedRating === null || !Number.isFinite(displayedRating)) return null;
  if (meanSuspicion <= 0.01) return round1(displayedRating);
  // Above this, the estimator becomes numerically unstable and the honest
  // answer is "we can't compute a meaningful rating from this".
  if (meanSuspicion >= 0.85) return null;

  const raw =
    (displayedRating - MANIPULATED_RATING_ASSUMPTION * meanSuspicion) /
    (1 - meanSuspicion);

  const shrunk = displayedRating + (raw - displayedRating) * sampleConfidence;
  return round1(clamp(shrunk, 1, 5));
}

/**
 * Turn each review signal into a product-level summary so the UI can show a
 * per-signal breakdown rather than a single opaque number.
 */
function summariseReviewSignals(
  snapshot: ProductSnapshot,
  assessments: ReviewAssessment[],
): SignalResult[] {
  const sampleSize = snapshot.reviews.length;
  const confidence = sampleConfidenceFrom(sampleSize);

  const textBroken = textExtractionFailed(snapshot);

  return REVIEW_SIGNALS.map((signal) => {
    const base = { id: signal.id, label: signal.label, weight: 1, confidence };

    if (sampleSize === 0) {
      return {
        ...base,
        status: 'insufficient-data' as const,
        score: 0.5,
        confidence: 0,
        detail: 'No reviews were readable on this page.',
      };
    }

    // Say we couldn't read the text, rather than reporting its absence as a
    // property of the reviews themselves.
    if (textBroken && TEXT_DEPENDENT_SIGNALS.has(signal.id)) {
      return {
        ...base,
        status: 'insufficient-data' as const,
        score: 0.5,
        confidence: 0,
        detail: "Winnow couldn't read the review text on this page, so this check was skipped.",
      };
    }

    const flagged = signal.evaluate(snapshot);

    const share = flagged.size / sampleSize;
    const score = clamp(1 - share);
    const status =
      share === 0 ? ('pass' as const) : share >= 0.4 ? ('fail' as const) : ('warn' as const);

    const evidence = [...flagged.values()].map((v) => v.reason).slice(0, 5);

    return {
      ...base,
      status,
      score,
      detail:
        flagged.size === 0
          ? passDetail(signal.id)
          : `${flagged.size} of ${sampleSize} visible reviews flagged.`,
      evidence,
    };
  });
}

function passDetail(signalId: string): string {
  switch (signalId) {
    case 'verified':
      return 'Every visible review is from a verified purchase.';
    case 'phrasing':
      return 'No incentive disclosures, boilerplate or generated-text patterns found.';
    case 'duplication':
      return 'No reviews share substantially similar text.';
    case 'burst':
      return 'Review dates are spread out rather than clustered.';
    case 'depth':
      return 'Extreme ratings come with enough detail to be credible.';
    case 'helpfulness':
      return 'Community voting on these reviews looks normal.';
    default:
      return 'No issues found.';
  }
}

/** Confidence contributed by sample size alone. Saturates around 25 reviews. */
export function sampleConfidenceFrom(sampleSize: number): number {
  if (sampleSize === 0) return 0;
  return clamp(Math.log10(sampleSize + 1) / Math.log10(26));
}

export function toGrade(trustScore: number): Grade {
  if (trustScore >= 85) return 'A';
  if (trustScore >= 70) return 'B';
  if (trustScore >= 55) return 'C';
  if (trustScore >= 40) return 'D';
  return 'F';
}

const GRADE_ORDER: Grade[] = ['A', 'B', 'C', 'D', 'F'];

/**
 * Cap the grade by how much of the visible sample we discounted.
 *
 * A product-level signal like the rating histogram carries real weight and full
 * confidence, so a clean histogram can outvote the review-level evidence and
 * pull a padded listing to an A. Calibration testing caught exactly that: a
 * listing with three unverified, contentless five-star reviews out of eight
 * still read as "Reviews look genuine".
 *
 * Averages are the wrong tool for that judgement. If a meaningful share of what
 * a shopper can actually see is suspect, the headline must not say the reviews
 * look genuine — whatever the aggregate says. This is deliberately a cap rather
 * than a penalty: it can only lower a grade, never raise one, and it maps
 * directly onto the "N of M visible reviews discounted" line already shown, so
 * the user can see why.
 *
 * ## Why a single check cannot push past C
 *
 * "Many reviews look manipulated" is close to an accusation, and the engine
 * should not make it on one kind of evidence. Live testing produced exactly that
 * failure: a listing with eight total ratings, where four of seven visible
 * reviews were unverified five-star and *every other check was clear*, graded D.
 * Unverified is not manipulated — gifts and guest checkout produce that pattern
 * on any new product — and the panel was calling a brand-new listing a fraud on
 * a single indicator, at low confidence.
 *
 * So corroboration gates severity, the same way the phrasing detector already
 * refuses to call text machine-generated without three of its four conditions.
 * One check acting alone can say "some reviews look questionable" (C). Saying
 * "many look manipulated" (D or F) requires at least two independent checks to
 * agree. A missed fake costs less than a false accusation.
 */
export function capGradeByDiscountedShare(
  grade: Grade,
  discounted: number,
  sampleSize: number,
  concerningSignals = Number.POSITIVE_INFINITY,
): Grade {
  if (sampleSize === 0) return grade;
  const share = discounted / sampleSize;

  let floor: Grade | null = share >= 0.5 ? 'D' : share >= 0.35 ? 'C' : share >= 0.15 ? 'B' : null;
  if (!floor) return grade;

  // Only one check found anything, so the cap stops at "questionable".
  if (concerningSignals < 2 && GRADE_ORDER.indexOf(floor) > GRADE_ORDER.indexOf('C')) {
    floor = 'C';
  }

  return GRADE_ORDER.indexOf(grade) >= GRADE_ORDER.indexOf(floor) ? grade : floor;
}

function confidenceLevel(
  sampleSize: number,
  snapshot: ProductSnapshot,
  insufficientData: boolean,
): ConfidenceLevel {
  if (insufficientData) return 'very-low';
  const hasHistogram = Boolean(snapshot.histogram);
  if (sampleSize >= 20 && hasHistogram) return 'high';
  if (sampleSize >= 8 && hasHistogram) return 'moderate';
  if (sampleSize >= 8 || hasHistogram) return 'low';
  return 'very-low';
}

function describeBasis(
  sampleSize: number,
  snapshot: ProductSnapshot,
  insufficientData: boolean,
): string {
  if (insufficientData) {
    return "Winnow couldn't read enough of this page to judge it. That isn't a verdict about the product.";
  }

  const parts: string[] = [];
  parts.push(
    sampleSize === 1
      ? 'the 1 review visible on this page'
      : `the ${sampleSize} reviews visible on this page`,
  );
  if (snapshot.histogram) {
    const total = snapshot.totalRatings;
    parts.push(
      total
        ? `the rating breakdown across all ${total.toLocaleString()} ratings`
        : 'the overall rating breakdown',
    );
  }

  const caveats: string[] = [];
  if (textExtractionFailed(snapshot)) {
    caveats.push(
      "Winnow couldn't read the review text on this page, so the language checks were skipped and this grade rests on less evidence than usual",
    );
  }
  if (!snapshot.histogram) {
    caveats.push("the rating breakdown wasn't readable either");
  }

  const caveat = caveats.length > 0 ? ` Note: ${caveats.join(', and ')}.` : '';
  return `Based on ${parts.join(' and ')}. This is an estimate, not proof.${caveat}`;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
