/**
 * The stable projection of a corpus case.
 *
 * Shared by the test and the freeze tool so the two can never disagree about
 * what is being compared — a freeze tool that wrote a slightly different shape
 * from the one the test reads would produce permanently red or, worse,
 * permanently green cases.
 *
 * Volatile fields are dropped deliberately: `analysedAt` and `capturedAt` change
 * on every run and would make every case fail for no reason. Everything kept
 * here is something a code change should have to justify.
 *
 * The parsed reviews are included, not just the grade. Without them a broken
 * selector that silently dropped half the reviews could still land on the same
 * letter and pass.
 */

/** Read the capture metadata the fixture carries in its own markup. */
export function captureMetaFrom(doc) {
  const meta = (name) =>
    doc.querySelector(`meta[name="${name}"]`)?.getAttribute('content') ?? undefined;

  const url = meta('winnow-capture-url');
  const capturedAt = meta('winnow-capture-at');

  if (!url || !capturedAt) {
    throw new Error(
      'Corpus fixture is missing <meta name="winnow-capture-url"> or "winnow-capture-at". ' +
        'Both are inputs to the analysis, so a fixture without them cannot be scored reproducibly.',
    );
  }
  return { url, capturedAt };
}

export function project(snapshot, analysis) {
  return {
    snapshot: {
      asin: snapshot.asin,
      title: snapshot.title ?? null,
      displayedRating: snapshot.displayedRating ?? null,
      totalRatings: snapshot.totalRatings ?? null,
      histogram: snapshot.histogram ?? null,
      sampleSource: snapshot.sampleSource ?? null,
      reviewCount: snapshot.reviews.length,
      reviews: snapshot.reviews.map((r) => ({
        id: r.id,
        rating: r.rating,
        date: r.date ?? null,
        verified: r.verified,
        helpfulVotes: r.helpfulVotes,
        textLength: r.text.length,
      })),
    },
    analysis: {
      grade: analysis.grade,
      trustScore: analysis.trustScore,
      adjustedRating: analysis.adjustedRating,
      displayedRating: analysis.displayedRating,
      discountedCount: analysis.discountedCount,
      concerningSignals: analysis.concerningSignals,
      sampleSize: analysis.sampleSize,
      confidence: analysis.confidence,
      insufficientData: analysis.insufficientData,
      signals: analysis.signals.map((s) => ({
        id: s.id,
        status: s.status,
        score: Number(s.score.toFixed(4)),
        detail: s.detail,
        contribution: s.contribution
          ? {
              gradeWithout: s.contribution.gradeWithout,
              trustScoreWithout: s.contribution.trustScoreWithout,
              decisive: s.contribution.decisive,
            }
          : null,
      })),
    },
  };
}
