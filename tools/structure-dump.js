/**
 * Winnow structure dump.
 *
 * Reports Amazon's *actual* current markup for whatever the selector probe
 * showed as broken — currently review body text and the rating histogram.
 *
 * Prints PLAIN TEXT lines rather than an object, because a logged object shows
 * up collapsed as "Array(70)" and cannot be copied out of the console.
 *
 * Paste into the DevTools console on an Amazon product page with the reviews
 * scrolled into view, then select the printed lines and copy them.
 * If Chrome refuses the paste, type exactly:  allow pasting
 */
(() => {
  const out = [];
  const say = (line) => out.push(line);

  const describe = (el) => {
    const cls =
      typeof el.className === 'string' && el.className.trim()
        ? '.' + el.className.trim().split(/\s+/).slice(0, 3).join('.')
        : '';
    const hook = el.dataset?.hook ? `[hook=${el.dataset.hook}]` : '';
    const id = el.id ? `#${el.id}` : '';
    const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
    return `${el.tagName.toLowerCase()}${id}${cls}${hook} :: ${text.slice(0, 90)}`;
  };

  const reviewNodes = [...document.querySelectorAll('[data-hook="review"], [id^="customer_review-"]')];
  const first = reviewNodes[0];

  say('===== WINNOW STRUCTURE DUMP =====');
  say(`url: ${location.href.split('?')[0]}`);
  say(`reviewNodes: ${reviewNodes.length}`);

  say('');
  say('--- INSIDE FIRST REVIEW (elements with a hook, an id, or real text) ---');
  if (!first) {
    say('NO REVIEW NODE FOUND — scroll the reviews into view and re-run.');
  } else {
    const interesting = [...first.querySelectorAll('*')].filter((el) => {
      const own = [...el.childNodes]
        .filter((n) => n.nodeType === 3)
        .map((n) => n.textContent.trim())
        .join(' ');
      return el.dataset?.hook || el.id || own.length > 20;
    });
    for (const el of interesting.slice(0, 45)) say(describe(el));
    say(`(${interesting.length} interesting of ${first.querySelectorAll('*').length} total)`);
  }

  say('');
  say('--- WHAT THE PARSER CURRENTLY GETS FOR BODY ---');
  if (first) {
    for (const sel of [
      '[data-hook="review-body"] span:not([class])',
      '[data-hook="review-body"] span',
      '[data-hook="review-body"]',
      '[data-hook="review-collapsed"]',
    ]) {
      const hit = first.querySelector(sel);
      say(`${sel} => ${hit ? JSON.stringify(hit.textContent.trim().slice(0, 70)) : 'NULL'}`);
    }
  }

  say('');
  say('--- STAR / HISTOGRAM LABELS (exact strings) ---');
  const labels = [...document.querySelectorAll('[aria-label*="star" i], [title*="star" i], [aria-label*="%"]')];
  for (const el of labels.slice(0, 16)) {
    say(`${el.tagName.toLowerCase()} :: ${JSON.stringify(el.getAttribute('aria-label') || el.getAttribute('title'))}`);
  }
  say(`(${labels.length} label elements total)`);

  say('');
  say('--- HISTOGRAM CONTAINERS ---');
  const hist = [...document.querySelectorAll('[id*="histogram" i], [class*="histogram" i], [data-hook*="histogram" i]')];
  for (const el of hist.slice(0, 8)) say(describe(el));

  say('');
  say('--- RATING SUMMARY ---');
  say(`acrPopover title: ${JSON.stringify(document.querySelector('#acrPopover')?.getAttribute('title') ?? null)}`);
  say(`acrCustomerReviewText: ${JSON.stringify(document.querySelector('#acrCustomerReviewText')?.textContent?.trim() ?? null)}`);
  say(`rating-out-of-text: ${JSON.stringify(document.querySelector('[data-hook="rating-out-of-text"]')?.textContent?.trim() ?? null)}`);
  say('===== END =====');

  const text = out.join('\n');
  // Print as one plain string so the console scrollback can be copied verbatim.
  console.log(text);
  try {
    copy(text);
    console.log('%c(also copied to clipboard)', 'color:#0a5cb8;font-weight:700');
  } catch {
    /* clipboard unavailable — the printed text above is the fallback */
  }
  return `dumped ${out.length} lines`;
})();
