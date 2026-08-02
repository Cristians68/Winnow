/**
 * Capture a real Amazon product page as a corpus fixture.
 *
 * Paste this whole file into the DevTools console on a product page, then save
 * what it copies to `tests/corpus/live-<name>.html` and run
 * `npm run corpus:freeze`.
 *
 * ## Why it rebuilds the page instead of taking document.documentElement
 *
 * A raw `outerHTML` of a signed-in Amazon page carries the account name in the
 * nav, delivery addresses, cart contents, session and CSRF tokens in inline
 * scripts, and a pile of tracking identifiers. Committing that to a public repo
 * would leak the developer's own account data — an ugly thing to do in any
 * project and an absurd one in a privacy tool.
 *
 * So this does not filter a copy of the page. It builds a new document from
 * scratch containing only the elements the parser is known to read, which means
 * anything not on that list cannot survive by being overlooked. Scripts, styles,
 * images, iframes and event handlers are dropped outright.
 *
 * Nothing is uploaded. The output goes to your clipboard and nowhere else.
 */
(() => {
  /** Exactly the containers src/content/parse.ts looks at. Nothing else is kept. */
  const KEEP = [
    '#productTitle',
    '#title span',
    '#averageCustomerReviews',
    '#acrPopover',
    '#acrCustomerReviewText',
    '[data-hook="rating-out-of-text"]',
    '[data-hook="total-review-count"]',
    '#histogramTable',
    '[data-hook="review"]',
  ];

  /** Attributes the parser uses. Everything else — tracking ids, styles — goes. */
  const KEEP_ATTRS = new Set(['id', 'class', 'data-hook', 'aria-label', 'title', 'href', 'name', 'content', 'value']);

  const DROP_TAGS = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'IMG', 'SVG', 'NOSCRIPT', 'LINK', 'INPUT', 'FORM', 'BUTTON']);

  function sanitise(node) {
    if (node.nodeType === Node.TEXT_NODE) return document.createTextNode(node.nodeValue);
    if (node.nodeType !== Node.ELEMENT_NODE) return null;
    if (DROP_TAGS.has(node.tagName)) return null;

    const copy = document.createElement(node.tagName.toLowerCase());

    for (const attr of [...node.attributes]) {
      if (!KEEP_ATTRS.has(attr.name)) continue;
      // Profile links are the one place an account identifier can ride along in
      // a kept attribute, so they are reduced to the shape the parser matches.
      if (attr.name === 'href') {
        const match = attr.value.match(/\/profile\/([^/?#]+)/);
        copy.setAttribute('href', match ? `/gp/profile/redacted-${hash(match[1])}` : '#');
        continue;
      }
      copy.setAttribute(attr.name, attr.value);
    }

    for (const child of node.childNodes) {
      const clean = sanitise(child);
      if (clean) copy.append(clean);
    }
    return copy;
  }

  /** Stable short id so the same reviewer stays the same person across a capture. */
  function hash(value) {
    let h = 0;
    for (let i = 0; i < value.length; i++) h = (Math.imul(31, h) + value.charCodeAt(i)) | 0;
    return Math.abs(h).toString(36).slice(0, 8);
  }

  const seen = new Set();
  const parts = [];

  for (const selector of KEEP) {
    for (const el of document.querySelectorAll(selector)) {
      if (seen.has(el)) continue;
      // Skip anything already contained in something we kept, to avoid duplicates.
      if (parts.some((p) => p.source.contains(el))) continue;
      seen.add(el);
      const clean = sanitise(el);
      if (clean) parts.push({ source: el, html: clean.outerHTML });
    }
  }

  const reviewCount = document.querySelectorAll('[data-hook="review"]').length;
  if (reviewCount === 0) {
    console.warn(
      '[winnow] No elements matching [data-hook="review"] on this page.\n' +
        'Either the review section has not loaded (scroll down and re-run), or Amazon has ' +
        'changed its markup — which is itself worth knowing about.',
    );
  }

  const asin =
    location.href.match(/\/(?:dp|gp\/product|product-reviews)\/([A-Z0-9]{10})/i)?.[1] ?? 'UNKNOWN';

  // The URL is reduced to its canonical form: query strings on Amazon carry
  // referral and session parameters that have no business in a fixture.
  const url = `https://www.amazon.com/dp/${asin}`;

  const output = [
    '<!--',
    '  LIVE CAPTURE, sanitised by tools/capture-corpus.js.',
    '  Only parser-relevant elements were kept; scripts, styles, images and',
    '  account markup were dropped rather than filtered. Reviewer profile links',
    '  are replaced with stable pseudonymous ids.',
    `  Captured from ${url}`,
    '-->',
    `<meta name="winnow-capture-url" content="${url}">`,
    `<meta name="winnow-capture-at" content="${new Date().toISOString()}">`,
    '',
    ...parts.map((p) => p.html),
    '',
  ].join('\n');

  copy(output);
  console.log(
    `[winnow] Captured ${reviewCount} review(s) for ${asin} — ${output.length} chars copied to clipboard.\n` +
      `Save as tests/corpus/live-${asin.toLowerCase()}.html, then run: npm run corpus:freeze\n` +
      'Read the file before committing it. You are the last check on what goes in.',
  );
  return output;
})();
