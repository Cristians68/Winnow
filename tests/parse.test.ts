// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import {
  extractAsin,
  extractHistogram,
  extractReviews,
  buildSnapshot,
  isProductPage,
  isInterstitial,
} from '../src/content/parse.js';

function docFrom(html: string): Document {
  return new DOMParser().parseFromString(`<html><body>${html}</body></html>`, 'text/html');
}

describe('ASIN extraction', () => {
  it('reads the ASIN from common URL shapes', () => {
    const empty = docFrom('');
    expect(extractAsin('https://www.amazon.com/dp/B08N5WRWNW', empty)).toBe('B08N5WRWNW');
    expect(extractAsin('https://www.amazon.com/Some-Product-Name/dp/B08N5WRWNW/ref=sr_1_3', empty)).toBe('B08N5WRWNW');
    expect(extractAsin('https://www.amazon.co.uk/gp/product/B08N5WRWNW?th=1', empty)).toBe('B08N5WRWNW');
    expect(extractAsin('https://www.amazon.com/product-reviews/B08N5WRWNW', empty)).toBe('B08N5WRWNW');
  });

  it('falls back to the DOM when the URL has no ASIN', () => {
    const doc = docFrom('<input id="ASIN" value="B01ABCDEFG">');
    expect(extractAsin('https://www.amazon.com/gp/cart/view.html', doc)).toBe('B01ABCDEFG');
  });

  it('returns null when there is no ASIN anywhere', () => {
    expect(extractAsin('https://www.amazon.com/', docFrom(''))).toBeNull();
  });

  it('recognises product pages', () => {
    expect(isProductPage('https://www.amazon.com/dp/B08N5WRWNW')).toBe(true);
    expect(isProductPage('https://www.amazon.com/s?k=headphones')).toBe(false);
  });
});

describe('histogram extraction', () => {
  it('reads percentages from accessible labels', () => {
    const doc = docFrom(`
      <div id="histogramTable">
        <a aria-label="5 stars represent 78% of rating" href="#"></a>
        <a aria-label="4 stars represent 12% of rating" href="#"></a>
        <a aria-label="3 stars represent 5% of rating" href="#"></a>
        <a aria-label="2 stars represent 2% of rating" href="#"></a>
        <a aria-label="1 star represents 3% of rating" href="#"></a>
      </div>`);
    expect(extractHistogram(doc)).toEqual({ 5: 78, 4: 12, 3: 5, 2: 2, 1: 3 });
  });

  it('falls back to reading table rows when labels are absent', () => {
    const doc = docFrom(`
      <table id="histogramTable">
        <tr><td>5 star</td><td>70%</td></tr>
        <tr><td>4 star</td><td>15%</td></tr>
        <tr><td>3 star</td><td>6%</td></tr>
        <tr><td>2 star</td><td>3%</td></tr>
        <tr><td>1 star</td><td>6%</td></tr>
      </table>`);
    expect(extractHistogram(doc)).toEqual({ 5: 70, 4: 15, 3: 6, 2: 3, 1: 6 });
  });

  it('returns undefined when no histogram is present', () => {
    expect(extractHistogram(docFrom('<div>nothing here</div>'))).toBeUndefined();
  });
});

describe('review extraction', () => {
  const reviewHtml = `
    <div data-hook="review" id="R1ABCDEF">
      <a class="a-profile" href="/gp/profile/amzn1.account.ABC123"><span class="a-profile-name">Jane D.</span></a>
      <i data-hook="review-star-rating" class="a-star-5"><span class="a-icon-alt">5.0 out of 5 stars</span></i>
      <a data-hook="review-title"><span>Works exactly as described</span></a>
      <span data-hook="review-date">Reviewed in the United States on June 3, 2026</span>
      <span data-hook="avp-badge">Verified Purchase</span>
      <div data-hook="review-body"><span>Battery lasted about 6 hours in normal use.</span></div>
      <span data-hook="helpful-vote-statement">12 people found this helpful</span>
    </div>`;

  it('extracts every field from a well-formed review', () => {
    const [review] = extractReviews(docFrom(reviewHtml));
    expect(review).toBeDefined();
    expect(review!.id).toBe('R1ABCDEF');
    expect(review!.rating).toBe(5);
    expect(review!.date).toBe('2026-06-03');
    expect(review!.verified).toBe(true);
    expect(review!.text).toContain('Battery lasted about 6 hours');
    expect(review!.title).toBe('Works exactly as described');
    expect(review!.helpfulVotes).toBe(12);
    expect(review!.reviewerId).toBe('amzn1.account.ABC123');
    expect(review!.reviewerName).toBe('Jane D.');
  });

  it('handles the "One person found this helpful" wording', () => {
    const doc = docFrom(reviewHtml.replace('12 people found this helpful', 'One person found this helpful'));
    expect(extractReviews(doc)[0]!.helpfulVotes).toBe(1);
  });

  it('marks a review unverified when the badge is missing', () => {
    const doc = docFrom(reviewHtml.replace('<span data-hook="avp-badge">Verified Purchase</span>', ''));
    expect(extractReviews(doc)[0]!.verified).toBe(false);
  });

  it('degrades gracefully when optional fields are missing', () => {
    const doc = docFrom(`
      <div data-hook="review">
        <i data-hook="review-star-rating"><span class="a-icon-alt">3.0 out of 5 stars</span></i>
        <div data-hook="review-body"><span>It is okay.</span></div>
      </div>`);
    const [review] = extractReviews(doc);
    expect(review!.rating).toBe(3);
    expect(review!.date).toBeUndefined();
    expect(review!.verified).toBe(false);
    expect(review!.helpfulVotes).toBe(0);
  });

  it('skips rows with no readable rating rather than throwing', () => {
    const doc = docFrom(`
      <div data-hook="review"><div data-hook="review-body"><span>No stars here.</span></div></div>
      ${reviewHtml}`);
    expect(extractReviews(doc)).toHaveLength(1);
  });

  it('strips the hidden star text out of review titles', () => {
    const doc = docFrom(`
      <div data-hook="review">
        <i data-hook="review-star-rating"><span class="a-icon-alt">4.0 out of 5 stars</span></i>
        <a data-hook="review-title">4.0 out of 5 stars Solid but flawed</a>
        <div data-hook="review-body"><span>Body text.</span></div>
      </div>`);
    expect(extractReviews(doc)[0]!.title).toBe('Solid but flawed');
  });

  it('returns an empty array on a page with no reviews', () => {
    expect(extractReviews(docFrom('<div>no reviews</div>'))).toEqual([]);
  });
});

// Markup captured from a live page in July 2026 (B0FG7WXNP3). Amazon rebuilt
// the review component with CSS-module classes and camelCase hooks; the old
// [data-hook="review-body"] disappeared, which made the parser return empty
// text for 12 of 13 reviews and produce a confidently wrong grade.
describe('Amazon 2026 review markup', () => {
  const modernReview = `
    <div id="R3VL34GP4CZNJP" data-hook="review" class="a-section aok-relative">
      <div class="a-row a-spacing-mini" data-hook="genome-widget">
        <a class="a-profile" href="/gp/profile/amzn1.account.XYZ">
          <div class="a-profile-content"><span class="a-profile-name">Supermom</span></div>
        </a>
      </div>
      <div class="_Y3Itd_single-review-star-rating-bar-desktop_1T97A">
        <i class="a-icon a-icon-star a-star-5" data-hook="review-star-rating">
          <span class="a-icon-alt">5 out of 5 stars</span>
        </i>
      </div>
      <h5 class="_Y3Itd_single-review-title_2aKRE" data-hook="review-title-content">
        <a class="a-size-base a-color-base a-link-normal">Comfortable, Well-Made, and Perfect for Workouts</a>
      </h5>
      <div class="a-row a-spacing-none" data-hook="review-by-line">
        <span class="a-size-base a-color-tertiary" data-hook="review-date">Reviewed in the United States on June 18, 2026</span>
      </div>
      <div data-hook="review-badges">
        <span class="a-size-mini a-color-state a-text-bold" data-hook="avp-badge">Verified Purchase</span>
      </div>
      <div class="_Y3Itd_single-review-text-container_325WM">
        <div class="_Y3Itd_contain-rich-content_2IORW" data-hook="reviewTextContent">
          <p><span>I am very happy with this weighted vest! It fits comfortably and stays in place.</span></p>
          <p><span>The material feels durable and well-made, and the adjustable fit makes it versatile.</span></p>
          <p><span>If you're looking for a quality weighted vest to add intensity, this is it.</span></p>
        </div>
        <div class="a-cardui-footer">
          <a class="a-cardui-expand-control-footer-button"><span class="a-see-more-text">Read more</span></a>
        </div>
      </div>
      <div class="a-section a-spacing-top-small">
        <span class="a-size-base a-color-tertiary" data-hook="helpful-vote-statement">14 people found this helpful</span>
      </div>
    </div>`;

  it('recovers the body text from the rebuilt markup', () => {
    const [review] = extractReviews(docFrom(modernReview));
    expect(review!.text).toContain('I am very happy with this weighted vest');
    expect(review!.text).toContain('The material feels durable');
    expect(review!.text).toContain('quality weighted vest');
  });

  it('strips the expander chrome Amazon appends to the text', () => {
    const [review] = extractReviews(docFrom(modernReview));
    expect(review!.text).not.toMatch(/Read more|Read less/i);
    expect(review!.text).not.toMatch(/double tap to read/i);
  });

  it('recovers the title from the h5 even though the hook was renamed', () => {
    const [review] = extractReviews(docFrom(modernReview));
    expect(review!.title).toBe('Comfortable, Well-Made, and Perfect for Workouts');
  });

  it('still reads the fields whose hooks survived the rebuild', () => {
    const [review] = extractReviews(docFrom(modernReview));
    expect(review!.rating).toBe(5);
    expect(review!.date).toBe('2026-06-18');
    expect(review!.verified).toBe(true);
    expect(review!.helpfulVotes).toBe(14);
    expect(review!.reviewerId).toBe('amzn1.account.XYZ');
  });

  it('falls back to paragraphs when every named hook is gone', () => {
    // The durable path: no recognisable hooks or classes at all.
    const stripped = `
      <div data-hook="review">
        <i data-hook="review-star-rating"><span class="a-icon-alt">4 out of 5 stars</span></i>
        <div class="_someFutureHash_xyz">
          <p><span>Battery lasted about 6 hours in real use.</span></p>
          <p><span>Build quality is solid for the price.</span></p>
        </div>
      </div>`;
    const [review] = extractReviews(docFrom(stripped));
    expect(review!.text).toContain('Battery lasted about 6 hours');
    expect(review!.text).toContain('Build quality is solid');
  });

  it('reads the histogram now that it is a <ul> rather than a <table>', () => {
    const doc = docFrom(`
      <ul id="histogramTable" class="a-unordered-list a-nostyle a-vertical">
        <li><a class="a-link-normal"><span>5 star</span><span>83%</span></a></li>
        <li><a class="a-link-normal"><span>4 star</span><span>8%</span></a></li>
        <li><a class="a-link-normal"><span>3 star</span><span>4%</span></a></li>
        <li><a class="a-link-normal"><span>2 star</span><span>1%</span></a></li>
        <li><a class="a-link-normal"><span>1 star</span><span>4%</span></a></li>
      </ul>`);
    expect(extractHistogram(doc)).toEqual({ 5: 83, 4: 8, 3: 4, 2: 1, 1: 4 });
  });

  it('produces a snapshot with usable text coverage from the real markup', () => {
    const doc = docFrom(`
      <span id="productTitle">Zeerun Reflective Weighted Vest</span>
      <span id="acrPopover" title="4.6 out of 5 stars"></span>
      <span id="acrCustomerReviewText">3,041 global ratings</span>
      <ul id="histogramTable">
        <li><span>5 star</span><span>83%</span></li>
        <li><span>4 star</span><span>8%</span></li>
        <li><span>3 star</span><span>4%</span></li>
        <li><span>2 star</span><span>1%</span></li>
        <li><span>1 star</span><span>4%</span></li>
      </ul>
      ${modernReview}`);

    const snapshot = buildSnapshot(doc, 'https://www.amazon.com/dp/B0FG7WXNP3')!;
    expect(snapshot.displayedRating).toBe(4.6);
    expect(snapshot.totalRatings).toBe(3041);
    expect(snapshot.histogram).toEqual({ 5: 83, 4: 8, 3: 4, 2: 1, 1: 4 });
    expect(snapshot.reviews[0]!.text.length).toBeGreaterThan(50);
  });
});

describe('bot-check interstitials', () => {
  // Captured from a real response: Amazon keeps the /dp/<ASIN> URL but serves
  // none of the product content, so the ASIN alone is not enough to proceed.
  const interstitial = `
    <div>
      <p>Click the button below to continue shopping</p>
      <form action="https://www.amazon.com/errors/validateCaptcha"><button>Continue shopping</button></form>
    </div>`;

  it('detects the interstitial by its captcha form', () => {
    expect(isInterstitial(docFrom(interstitial))).toBe(true);
  });

  it('detects the interstitial by its wording alone', () => {
    expect(isInterstitial(docFrom('<p>Enter the characters you see below</p>'))).toBe(true);
  });

  it('does not mistake a normal product page for an interstitial', () => {
    expect(isInterstitial(docFrom('<span id="productTitle">Test Headphones</span>'))).toBe(false);
  });

  it('refuses to build a snapshot from an interstitial even though the URL has an ASIN', () => {
    expect(buildSnapshot(docFrom(interstitial), 'https://www.amazon.com/dp/B08N5WRWNW')).toBeNull();
  });
});

describe('snapshot assembly', () => {
  it('assembles a full snapshot', () => {
    const doc = docFrom(`
      <span id="productTitle">Test Headphones</span>
      <span id="acrPopover" title="4.3 out of 5 stars"></span>
      <span id="acrCustomerReviewText">12,345 ratings</span>
      <div id="histogramTable">
        <a aria-label="5 stars represent 62% of rating" href="#"></a>
        <a aria-label="4 stars represent 18% of rating" href="#"></a>
        <a aria-label="3 stars represent 8% of rating" href="#"></a>
      </div>
      <div data-hook="review" id="R2">
        <i data-hook="review-star-rating"><span class="a-icon-alt">5.0 out of 5 stars</span></i>
        <div data-hook="review-body"><span>Good sound for the price.</span></div>
      </div>`);

    const snapshot = buildSnapshot(doc, 'https://www.amazon.com/dp/B08N5WRWNW')!;
    expect(snapshot.asin).toBe('B08N5WRWNW');
    expect(snapshot.title).toBe('Test Headphones');
    expect(snapshot.displayedRating).toBe(4.3);
    expect(snapshot.totalRatings).toBe(12345);
    expect(snapshot.histogram).toMatchObject({ 5: 62 });
    expect(snapshot.reviews).toHaveLength(1);
  });

  it('returns null without an ASIN', () => {
    expect(buildSnapshot(docFrom(''), 'https://www.amazon.com/')).toBeNull();
  });
});
