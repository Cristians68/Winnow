import type {
  Analysis,
  ConfidenceLevel,
  Grade,
  ProductSignal,
  ProductSnapshot,
  ReviewAssessment,
  ReviewSignal,
  SampleSource,
  SignalContribution,
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

export const ENGINE_VERSION = '0.2.0';

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

/**
 * Score a snapshot, optionally with one check switched off.
 *
 * `exclude` exists so the engine can answer "what would the grade be without
 * this check?" by actually re-running itself, rather than by inferring an answer
 * from the weights. See `SignalContribution` for why the inferred version would
 * be wrong. Excluding a review-level check also removes its suspicion deltas, so
 * the counterfactual moves the adjusted rating too — which is the point.
 */
function scoreSnapshot(
  snapshot: ProductSnapshot,
  deep: DeepAugmentation | undefined,
  exclude: string | null,
): Analysis {
  const assessments = assessReviews(snapshot, deep, exclude);
  const reviewSignalResults = summariseReviewSignals(snapshot, assessments, exclude);
  const productSignalResults = PRODUCT_SIGNALS.filter((s) => s.id !== exclude).map((s) =>
    s.evaluate(snapshot),
  );
  const deepSignals = (deep?.signals ?? []).filter((s) => s.id !== exclude);
  const signals = [...productSignalResults, ...reviewSignalResults, ...deepSignals];

  const sampleSize = snapshot.reviews.length;
  const meanSuspicion =
    sampleSize === 0
      ? 0
      : assessments.reduce((sum, a) => sum + a.suspicion, 0) / sampleSize;

  const sampleConfidence = sampleConfidenceFrom(sampleSize, snapshot.sampleSource);

  // --- Weighted trust score -------------------------------------------------
  let weightedSum = 0;
  let effectiveWeight = 0;

  if (sampleSize > 0) {
    const w = REVIEW_COMPONENT_WEIGHT * sampleConfidence;
    weightedSum += (1 - meanSuspicion) * w;
    effectiveWeight += w;
  }

  for (const signal of [...productSignalResults, ...deepSignals]) {
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

export function analyse(snapshot: ProductSnapshot, deep?: DeepAugmentation): Analysis {
  const base = scoreSnapshot(snapshot, deep, null);

  // No grade means nothing to attribute, and re-running eight times to produce
  // eight identical refusals would be pure waste.
  if (base.insufficientData) return base;

  return {
    ...base,
    signals: base.signals.map((signal) => ({
      ...signal,
      contribution: contributionOf(snapshot, deep, base, signal.id),
    })),
  };
}

/** Re-score without one check and diff it against the real result. */
function contributionOf(
  snapshot: ProductSnapshot,
  deep: DeepAugmentation | undefined,
  base: Analysis,
  signalId: string,
): SignalContribution {
  const without = scoreSnapshot(snapshot, deep, signalId);

  // A counterfactual that collapses into "not enough evidence" tells the user
  // nothing about this check, so report it as having moved nothing rather than
  // inventing a grade out of the refusal branch's placeholder score.
  if (without.insufficientData) {
    return {
      gradeWithout: base.grade,
      trustScoreWithout: base.trustScore,
      trustScoreDelta: 0,
      decisive: false,
    };
  }

  return {
    gradeWithout: without.grade,
    trustScoreWithout: without.trustScore,
    trustScoreDelta: without.trustScore - base.trustScore,
    decisive: without.grade !== base.grade,
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
export function assessReviews(
  snapshot: ProductSnapshot,
  deep?: DeepAugmentation,
  exclude: string | null = null,
): ReviewAssessment[] {
  const textBroken = textExtractionFailed(snapshot);
  const byReview = new Map<string, ReviewAssessment>(
    snapshot.reviews.map((r) => [r.id, { reviewId: r.id, suspicion: 0, reasons: [] }]),
  );

  for (const signal of REVIEW_SIGNALS) {
    if (signal.id === exclude) continue;
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
  exclude: string | null = null,
): SignalResult[] {
  const sampleSize = snapshot.reviews.length;
  const confidence = sampleConfidenceFrom(sampleSize, snapshot.sampleSource);

  const textBroken = textExtractionFailed(snapshot);

  return REVIEW_SIGNALS.filter((signal) => signal.id !== exclude).map((signal) => {
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

/**
 * Ceiling on confidence when the sample is Amazon's featured reviews.
 *
 * The size curve below answers "how many reviews did we see", and the code used
 * to treat that as the whole answer — saturating at 1.0 from 25 reviews, which
 * asserts that a large enough featured sample is a full-confidence read on the
 * review base. It isn't. Featured reviews are *chosen by Amazon*, and that bias
 * does not shrink as the count grows: 25 hand-picked reviews are 25 hand-picked
 * reviews. Amazon can also change the selection at any time without our code
 * changing, so the same listing can be sampled differently on two consecutive
 * loads.
 *
 * Size and representativeness are two different things, and only one of them
 * improves with n. So featured samples are capped here regardless of count,
 * which keeps `estimateAdjustedRating` from shrinking an estimate almost all the
 * way onto a biased draw. A `/product-reviews/` listing page is not hand-picked
 * per product, so it is allowed the full range.
 */
export const FEATURED_SAMPLE_CEILING = 0.75;

/**
 * Confidence contributed by the sample. Size saturates around 25 reviews, then
 * the source caps it — see FEATURED_SAMPLE_CEILING for why the cap is not
 * redundant with the curve.
 */
export function sampleConfidenceFrom(
  sampleSize: number,
  source: SampleSource = 'featured',
): number {
  if (sampleSize === 0) return 0;
  const bySize = clamp(Math.log10(sampleSize + 1) / Math.log10(26));
  return source === 'listing' ? bySize : Math.min(bySize, FEATURED_SAMPLE_CEILING);
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
