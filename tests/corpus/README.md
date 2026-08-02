# Frozen page corpus

Whole captured pages, run end-to-end through the parser and the scoring engine,
compared against a frozen expected result.

## What this catches, and what it does not

`calibration.test.ts` builds `ProductSnapshot` objects by hand. That tests the
engine, but it skips the parser entirely — so a change that broke selector
matching would leave the whole calibration suite green. This corpus starts from
raw HTML, so parser and engine are pinned together.

**It catches our drift.** Change a threshold, a selector, or a signal, and the
diff shows up as a failing case with the exact field that moved.

**It cannot catch Amazon's drift.** These snapshots are frozen. If Amazon
changes its markup tomorrow, every case here keeps passing while the live
extension reads nothing. That is not a flaw to be fixed by adding cases; it is a
different problem needing a different mechanism, and the one already in the
engine is `textExtractionFailed()`, which fires at runtime when text coverage
collapses. A frozen corpus and a live coverage check are complements, not
substitutes — do not let a green corpus stand in for having loaded a real page.

## The clock is frozen too

`helpfulness.ts` reads `Date.now()` and compares it to review dates, so the same
fixture scores differently as it ages. Each capture therefore records the moment
it was taken, and the test sets the system clock to it before scoring. Without
that, these tests would start failing on their own some months after being
written, for no reason connected to any code change.

## The seed cases are synthetic

The two `synthetic-*` fixtures were written by hand to exercise the real
selectors, not captured from Amazon. They are scaffolding: they prove the
harness works and pin engine behaviour, but they cannot tell you whether the
selectors still match what Amazon actually ships.

**Real captures are the point of this directory.** Add them with
`tools/capture-corpus.js` (paste into DevTools on a product page — it strips
session and account markup before handing back the HTML). Name real captures
`live-<something>.html` so the two kinds stay visibly distinct.

## Workflow

```bash
npm run corpus:freeze     # regenerate every .expected.json from current code
npx vitest run tests/corpus.test.ts
```

Re-freezing accepts whatever the code currently does, so **read the diff before
committing it.** An unexplained grade change in a re-freeze is the corpus doing
its job, not noise to be cleared.
