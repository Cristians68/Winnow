/**
 * Corpus storage, on Node's built-in SQLite. No dependencies.
 *
 * What this database deliberately does NOT contain:
 *   · raw review text        — only shingle hashes, enough to detect reuse
 *   · Amazon reviewer ids    — only HMAC hashes, salted server-side
 *   · product titles         — only a hash, enough to notice a listing swap
 *   · anything about the Winnow user — no ip, no client id, no timestamps tied
 *     to a person. Rows record facts about public listings, not about visitors.
 *
 * The corpus is the actual moat: it accumulates across users and cannot be
 * rebuilt by a competitor scraping from servers, because Amazon no longer
 * serves that data to servers.
 */

import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';

/**
 * `node:sqlite` is a node:-prefixed-only builtin and is absent from
 * `builtinModules`, so bundlers that resolve imports statically (Vite/Vitest)
 * try to load a package literally named "sqlite" and fail. Loading it through
 * createRequire keeps it out of static analysis while remaining a plain
 * synchronous builtin import at runtime.
 */
const require = createRequire(import.meta.url);

interface Statement {
  run(...params: unknown[]): unknown;
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown;
}

interface SqliteDatabase {
  exec(sql: string): void;
  prepare(sql: string): Statement;
  close(): void;
}

const { DatabaseSync } = require('node:sqlite') as {
  DatabaseSync: new (location: string) => SqliteDatabase;
};

export interface ObservationRow {
  observedAt: string;
  displayedRating: number | null;
  totalRatings: number | null;
  titleHash: string | null;
  histogram: string | null;
}

export interface CorpusReview {
  reviewKey: string;
  rating: number;
  date: string | null;
  verified: number;
  reviewerHash: string | null;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS observations (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  asin           TEXT NOT NULL,
  observed_at    TEXT NOT NULL,
  displayed_rating REAL,
  total_ratings  INTEGER,
  title_hash     TEXT,
  histogram      TEXT
);
CREATE INDEX IF NOT EXISTS idx_observations_asin ON observations(asin, observed_at);

CREATE TABLE IF NOT EXISTS reviews (
  asin           TEXT NOT NULL,
  review_key     TEXT NOT NULL,
  rating         INTEGER NOT NULL,
  review_date    TEXT,
  verified       INTEGER NOT NULL,
  helpful_votes  INTEGER NOT NULL,
  reviewer_hash  TEXT,
  word_count     INTEGER NOT NULL,
  first_seen     TEXT NOT NULL,
  last_seen      TEXT,
  PRIMARY KEY (asin, review_key)
);
CREATE INDEX IF NOT EXISTS idx_reviews_last_seen ON reviews(last_seen);
CREATE INDEX IF NOT EXISTS idx_reviews_reviewer ON reviews(reviewer_hash);

CREATE TABLE IF NOT EXISTS shingles (
  shingle_hash   TEXT NOT NULL,
  asin           TEXT NOT NULL,
  sightings      INTEGER NOT NULL DEFAULT 1,
  last_counted   TEXT,
  PRIMARY KEY (shingle_hash, asin)
);
CREATE INDEX IF NOT EXISTS idx_shingles_hash ON shingles(shingle_hash);

CREATE TABLE IF NOT EXISTS cache (
  asin           TEXT PRIMARY KEY,
  payload        TEXT NOT NULL,
  computed_at    TEXT NOT NULL
);
`;

/**
 * Separate days a phrase must be seen on a product before it counts toward
 * cross-product template detection. See recordShingles().
 */
export const MIN_CORROBORATION = 2;

export function sha(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 32);
}

export class Corpus {
  private readonly db: SqliteDatabase;

  constructor(location = process.env.WINNOW_DB ?? 'winnow-corpus.db') {
    this.db = new DatabaseSync(location);
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec(SCHEMA);
  }

  close(): void {
    this.db.close();
  }

  // --- observations (rating history) ---------------------------------------

  recordObservation(asin: string, o: Omit<ObservationRow, 'observedAt'> & { observedAt?: string }): void {
    this.db
      .prepare(
        `INSERT INTO observations (asin, observed_at, displayed_rating, total_ratings, title_hash, histogram)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        asin,
        o.observedAt ?? new Date().toISOString(),
        o.displayedRating,
        o.totalRatings,
        o.titleHash,
        o.histogram,
      );
  }

  /** Observation history for an ASIN, oldest first. */
  observations(asin: string, limit = 200): ObservationRow[] {
    return this.db
      .prepare(
        `SELECT observed_at AS observedAt, displayed_rating AS displayedRating,
                total_ratings AS totalRatings, title_hash AS titleHash, histogram
         FROM observations WHERE asin = ? ORDER BY observed_at ASC LIMIT ?`,
      )
      .all(asin, limit) as unknown as ObservationRow[];
  }

  /**
   * Collapse consecutive identical observations so a popular product viewed a
   * thousand times does not bloat the table with a thousand identical rows.
   */
  pruneDuplicateObservations(asin: string): void {
    this.db
      .prepare(
        `DELETE FROM observations WHERE id IN (
           SELECT o.id FROM observations o
           JOIN observations prev ON prev.asin = o.asin AND prev.id = (
             SELECT MAX(id) FROM observations p WHERE p.asin = o.asin AND p.id < o.id
           )
           WHERE o.asin = ?
             AND IFNULL(o.displayed_rating,-1) = IFNULL(prev.displayed_rating,-1)
             AND IFNULL(o.total_ratings,-1)    = IFNULL(prev.total_ratings,-1)
             AND IFNULL(o.title_hash,'')       = IFNULL(prev.title_hash,'')
         )`,
      )
      .run(asin);
  }

  // --- reviews --------------------------------------------------------------

  upsertReview(asin: string, r: CorpusReview & { helpfulVotes: number; wordCount: number }): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO reviews (asin, review_key, rating, review_date, verified, helpful_votes, reviewer_hash, word_count, first_seen, last_seen)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(asin, review_key) DO UPDATE SET
           helpful_votes = excluded.helpful_votes,
           last_seen = excluded.last_seen`,
      )
      .run(
        asin,
        r.reviewKey,
        r.rating,
        r.date,
        r.verified,
        r.helpfulVotes,
        r.reviewerHash,
        r.wordCount,
        now,
        now,
      );
  }

  /** Other ASINs this reviewer has been seen reviewing. */
  asinsForReviewer(reviewerHash: string): string[] {
    return (
      this.db.prepare(`SELECT DISTINCT asin FROM reviews WHERE reviewer_hash = ?`).all(reviewerHash) as unknown as Array<{
        asin: string;
      }>
    ).map((row) => row.asin);
  }

  // --- shingles (cross-product template reuse) -----------------------------

  /**
   * A phrase must be independently corroborated before it can influence any
   * other product's score.
   *
   * Anti-poisoning measure. Without it, one attacker could submit fabricated
   * reviews and make a rival's genuine text look like a farm template. We
   * deliberately cannot identify clients — that is the privacy guarantee — so
   * "independent" is approximated by *time*: a given phrase/product pair counts
   * at most once per calendar day, so manufacturing corroboration requires
   * sustained submissions across days rather than a single burst.
   *
   * This raises the cost of poisoning substantially. It does not eliminate it;
   * see SECURITY.md.
   */
  recordShingles(asin: string, shingleHashes: Iterable<string>, today = new Date().toISOString().slice(0, 10)): void {
    const stmt = this.db.prepare(
      `INSERT INTO shingles (shingle_hash, asin, sightings, last_counted)
       VALUES (?, ?, 1, ?)
       ON CONFLICT(shingle_hash, asin) DO UPDATE SET
         sightings    = sightings + CASE WHEN IFNULL(last_counted,'') = excluded.last_counted THEN 0 ELSE 1 END,
         last_counted = excluded.last_counted`,
    );
    for (const hash of shingleHashes) stmt.run(hash, asin, today);
  }

  /**
   * How many *other* products each phrase has been corroborated on.
   *
   * Only pairs seen on at least MIN_CORROBORATION separate days count, so a
   * single submission can never by itself brand another product's text as
   * templated.
   */
  shingleSpread(shingleHashes: string[], excludeAsin: string): Map<string, number> {
    const spread = new Map<string, number>();
    if (shingleHashes.length === 0) return spread;

    const stmt = this.db.prepare(
      `SELECT COUNT(DISTINCT asin) AS n FROM shingles
       WHERE shingle_hash = ? AND asin != ? AND sightings >= ?`,
    );
    for (const hash of shingleHashes) {
      const row = stmt.get(hash, excludeAsin, MIN_CORROBORATION) as unknown as { n: number } | undefined;
      spread.set(hash, row?.n ?? 0);
    }
    return spread;
  }

  // --- cache ----------------------------------------------------------------

  readCache(asin: string, maxAgeMs: number): unknown | null {
    const row = this.db.prepare(`SELECT payload, computed_at FROM cache WHERE asin = ?`).get(asin) as unknown as
      | { payload: string; computed_at: string }
      | undefined;
    if (!row) return null;
    if (Date.now() - Date.parse(row.computed_at) > maxAgeMs) return null;
    try {
      return JSON.parse(row.payload);
    } catch {
      return null;
    }
  }

  writeCache(asin: string, payload: unknown): void {
    this.db
      .prepare(
        `INSERT INTO cache (asin, payload, computed_at) VALUES (?, ?, ?)
         ON CONFLICT(asin) DO UPDATE SET payload = excluded.payload, computed_at = excluded.computed_at`,
      )
      .run(asin, JSON.stringify(payload), new Date().toISOString());
  }

  invalidateCache(asin: string): void {
    this.db.prepare(`DELETE FROM cache WHERE asin = ?`).run(asin);
  }

  // --- retention ------------------------------------------------------------

  /**
   * Enforce the retention promise in PRIVACY.md.
   *
   * The policy states reviewer data is kept for 24 months from last sighting
   * and then deleted. A documented policy that nothing executes is not a
   * guarantee, so this runs on a timer and is covered by tests.
   *
   * Returns the number of rows removed, per table.
   */
  pruneExpired(retentionMonths = 24, now = new Date()): { reviews: number; observations: number; cache: number } {
    const cutoff = new Date(now);
    cutoff.setMonth(cutoff.getMonth() - retentionMonths);
    const iso = cutoff.toISOString();

    const countRows = (sql: string, ...params: unknown[]): number =>
      (this.db.prepare(sql).get(...params) as { n: number }).n;

    const reviews = countRows(
      `SELECT COUNT(*) AS n FROM reviews WHERE COALESCE(last_seen, first_seen) < ?`,
      iso,
    );
    this.db.prepare(`DELETE FROM reviews WHERE COALESCE(last_seen, first_seen) < ?`).run(iso);

    const observations = countRows(`SELECT COUNT(*) AS n FROM observations WHERE observed_at < ?`, iso);
    this.db.prepare(`DELETE FROM observations WHERE observed_at < ?`).run(iso);

    // Cached analyses are derived data and expire far sooner than the policy.
    const staleCache = new Date(now.getTime() - 7 * 86_400_000).toISOString();
    const cache = countRows(`SELECT COUNT(*) AS n FROM cache WHERE computed_at < ?`, staleCache);
    this.db.prepare(`DELETE FROM cache WHERE computed_at < ?`).run(staleCache);

    // Phrase hashes for products no longer represented carry no further value.
    this.db.exec(`DELETE FROM shingles WHERE asin NOT IN (SELECT DISTINCT asin FROM reviews)`);

    return { reviews, observations, cache };
  }

  observationCount(asin: string): number {
    const row = this.db.prepare(`SELECT COUNT(*) AS n FROM observations WHERE asin = ?`).get(asin) as unknown as {
      n: number;
    };
    return row.n;
  }
}
