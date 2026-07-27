/**
 * Winnow selector probe.
 *
 * Paste this into the DevTools console on any Amazon product page you have
 * open in normal browsing. It reports which of the parser's selector chains
 * currently match, and previews the snapshot Winnow would build.
 *
 * Why this exists rather than an automated check: Amazon serves a bot-check
 * interstitial to automated sessions, so the parser can only be validated
 * against markup a real person actually loaded. Run this whenever a listing
 * looks wrong or after Amazon ships a layout change, and paste the output into
 * an issue.
 */
(() => {
  const CHAINS = {
    'product title': ['#productTitle', '#title span', 'h1#title', 'h1 span#productTitle'],
    'displayed rating': [
      '[data-hook="rating-out-of-text"]',
      '#acrPopover .a-icon-alt',
      '#averageCustomerReviews .a-icon-alt',
      'span[data-hook="average-star-rating"] .a-icon-alt',
      '#acrPopover',
    ],
    'total ratings': [
      '#acrCustomerReviewText',
      '[data-hook="total-review-count"]',
      '#reviewsMedley [data-hook="total-review-count"]',
    ],
    'histogram (labels)': [
      '#histogramTable a[aria-label]',
      '[data-hook="cr-histogram-row"] a[aria-label]',
      '#cm_cr_dp_d_rating_histogram a[aria-label]',
      'a[aria-label*="stars represent"]',
      'a[title*="stars represent"]',
    ],
    'histogram (rows)': ['#histogramTable tr', '[data-hook="cr-histogram-row"]', '#cm_cr_dp_d_rating_histogram tr'],
    reviews: [
      'div[data-hook="review"]',
      'li[data-hook="review"]',
      '#cm-cr-dp-review-list div[data-hook="review"]',
      '[id^="customer_review-"]',
    ],
    'mount anchors': ['#reviewsMedley', '#customerReviews', '#cm-cr-dp-review-list', '#averageCustomerReviews', '#centerCol'],
  };

  const REVIEW_FIELDS = {
    rating: [
      '[data-hook="review-star-rating"] .a-icon-alt',
      '[data-hook="cmps-review-star-rating"] .a-icon-alt',
      '[data-hook="review-star-rating"]',
      '.review-rating .a-icon-alt',
      'i[class*="a-star-"]',
    ],
    body: [
      '[data-hook="review-body"] span:not([class])',
      '[data-hook="review-body"] span',
      '[data-hook="review-collapsed"]',
      '[data-hook="review-body"]',
    ],
    title: ['[data-hook="review-title"] span:not([class])', '[data-hook="review-title"]', '.review-title'],
    date: ['[data-hook="review-date"]', '.review-date'],
    verified: ['[data-hook="avp-badge"]'],
    helpful: ['[data-hook="helpful-vote-statement"]', '.cr-vote-text'],
    profile: ['a.a-profile', '[data-hook="genome-widget"] a'],
  };

  const count = (root, sel) => {
    try {
      return root.querySelectorAll(sel).length;
    } catch {
      return -1;
    }
  };

  const interstitial =
    !!document.querySelector('form[action*="validateCaptcha"], form[action*="/errors/"]') ||
    /click the button below to continue shopping|enter the characters you see below/i.test(document.body.innerText);

  console.group('%cWinnow selector probe', 'font-weight:700;font-size:14px');
  console.log('URL:', location.href);

  if (interstitial) {
    console.warn('This is an Amazon bot-check interstitial, not a product page. Nothing to probe.');
    console.groupEnd();
    return;
  }

  console.group('Page-level chains');
  for (const [name, selectors] of Object.entries(CHAINS)) {
    const rows = selectors.map((sel) => ({ selector: sel, matches: count(document, sel) }));
    const hit = rows.find((r) => r.matches > 0);
    console.log(`${hit ? '✅' : '❌'} ${name}${hit ? ` → "${hit.selector}" (${hit.matches})` : ' — NO SELECTOR MATCHED'}`);
    if (!hit) console.table(rows);
  }
  console.groupEnd();

  const reviews = [...document.querySelectorAll('div[data-hook="review"], li[data-hook="review"], [id^="customer_review-"]')];
  console.group(`Per-review fields (${reviews.length} reviews found)`);
  if (reviews.length === 0) {
    console.warn('No review nodes found. Scroll the reviews section into view and re-run.');
  } else {
    const coverage = {};
    for (const [field, selectors] of Object.entries(REVIEW_FIELDS)) {
      const hits = reviews.filter((node) => selectors.some((sel) => count(node, sel) > 0)).length;
      coverage[field] = `${hits}/${reviews.length}`;
    }
    console.table(coverage);
    console.log('First review node, for inspection:', reviews[0]);
  }
  console.groupEnd();

  console.log(
    '%cPaste this whole output into a GitHub issue if any chain shows ❌.',
    'color:#0b5cab;font-weight:600',
  );
  console.groupEnd();
})();
