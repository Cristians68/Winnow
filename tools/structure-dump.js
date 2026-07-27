/**
 * Winnow structure dump.
 *
 * Reports Amazon's *actual* current markup for the two things the selector
 * probe showed as broken: review body text and the rating histogram.
 *
 * Paste into the DevTools console on an Amazon product page with the reviews
 * scrolled into view. The result is copied to your clipboard — paste it back.
 *
 * If Chrome refuses the paste, type exactly:  allow pasting
 */
(() => {
  const describe = (el) => {
    const cls = typeof el.className === 'string' && el.className.trim()
      ? '.' + el.className.trim().split(/\s+/).slice(0, 3).join('.')
      : '';
    const hook = el.dataset?.hook ? `[data-hook="${el.dataset.hook}"]` : '';
    const id = el.id ? `#${el.id}` : '';
    const text = (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 70);
    return `${el.tagName.toLowerCase()}${id}${cls}${hook} :: ${text}`;
  };

  const reviewNodes = [...document.querySelectorAll('[data-hook="review"], [id^="customer_review-"]')];
  const first = reviewNodes[0];

  const report = {
    url: location.href.split('?')[0],
    reviewNodeCount: reviewNodes.length,

    // Everything inside one review node, so we can see where the body text lives.
    firstReviewTree: first ? [...first.querySelectorAll('*')].slice(0, 70).map(describe) : null,

    // What the parser currently extracts, for comparison.
    currentBodyAttempts: first
      ? {
          'review-body span:not([class])': first.querySelector('[data-hook="review-body"] span:not([class])')?.textContent?.trim().slice(0, 80) ?? null,
          'review-body span': first.querySelector('[data-hook="review-body"] span')?.textContent?.trim().slice(0, 80) ?? null,
          'review-body': first.querySelector('[data-hook="review-body"]')?.textContent?.trim().slice(0, 80) ?? null,
          'review-collapsed': first.querySelector('[data-hook="review-collapsed"]')?.textContent?.trim().slice(0, 80) ?? null,
        }
      : null,

    // Anything histogram-shaped anywhere on the page.
    histogramElements: [...document.querySelectorAll('[id*="histogram" i], [class*="histogram" i], [data-hook*="histogram" i]')]
      .slice(0, 12)
      .map(describe),

    // The accessible labels the parser prefers to read percentages from.
    starLabels: [...document.querySelectorAll('[aria-label*="star" i], [title*="star" i]')]
      .slice(0, 14)
      .map((el) => el.getAttribute('aria-label') || el.getAttribute('title')),

    ratingSummary: {
      acrPopover: document.querySelector('#acrPopover')?.getAttribute('title') ?? null,
      acrCustomerReviewText: document.querySelector('#acrCustomerReviewText')?.textContent?.trim() ?? null,
      ratingOutOfText: document.querySelector('[data-hook="rating-out-of-text"]')?.textContent?.trim() ?? null,
    },
  };

  const json = JSON.stringify(report, null, 1);
  try {
    copy(json);
    console.log('%cCopied to clipboard — paste it back to Claude.', 'color:#0a5cb8;font-weight:700');
  } catch {
    console.log('Clipboard unavailable; copy the object below manually.');
  }
  console.log(report);
  return `${reviewNodes.length} review nodes, ${report.histogramElements.length} histogram elements found`;
})();
