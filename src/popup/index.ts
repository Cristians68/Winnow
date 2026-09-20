import type { Analysis, Grade } from '../core/types.js';
import { getSettings, setSettings } from '../shared/settings.js';
import { isRatingsOnly } from '../core/score.js';
import { RATINGS_ONLY_TITLES } from '../core/verdict.js';
import { mountAdSlot } from '../shared/ads/render.js';

const GRADE_TONE: Record<Grade, string> = {
  A: 'good',
  B: 'good',
  C: 'mixed',
  D: 'bad',
  F: 'bad',
};

const HEADLINES: Record<Grade, string> = {
  A: 'Reviews look genuine',
  B: 'Reviews look mostly genuine',
  C: 'Some reviews look questionable',
  D: 'Many reviews look manipulated',
  F: 'Reviews look heavily manipulated',
};

function $(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el;
}

function show(state: { grade: string; tone?: string; headline: string; sub: string; basis?: string }): void {
  const grade = $('grade');
  grade.textContent = state.grade;
  grade.className = `grade${state.tone ? ` ${state.tone}` : ''}`;
  $('headline').textContent = state.headline;
  $('sub').textContent = state.sub;

  const basis = $('basis');
  if (state.basis) {
    basis.textContent = state.basis;
    basis.hidden = false;
  } else {
    basis.hidden = true;
  }
}

async function loadAnalysis(): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    show({ grade: '–', headline: 'No active tab', sub: '' });
    return;
  }

  let response: { analysis: Analysis | null } | undefined;
  try {
    response = await chrome.tabs.sendMessage(tab.id, { type: 'winnow:get-analysis' });
  } catch {
    // No content script on this page — almost always means it isn't Amazon.
    show({
      grade: '–',
      headline: 'Not an Amazon product page',
      sub: 'Open a product to see its review analysis.',
    });
    return;
  }

  const analysis = response?.analysis;
  if (!analysis) {
    show({
      grade: '–',
      headline: 'Nothing analysed yet',
      sub: 'Scroll to the reviews section and reopen this.',
    });
    return;
  }

  if (analysis.insufficientData) {
    show({
      grade: '?',
      headline: "Couldn't read this page",
      sub: 'Not a verdict about the product.',
      basis: analysis.basis,
    });
    return;
  }

  // The panel makes the same distinction, for the same reason: a grade with no
  // readable reviews behind it must not be announced as a verdict on reviews.
  const ratingsOnly = isRatingsOnly(analysis);

  const adjusted = ratingsOnly
    ? `Rating breakdown only · trust ${analysis.trustScore}/100`
    : analysis.adjustedRating === null
      ? 'Too little trustworthy data to estimate a rating.'
      : `Adjusted rating ${analysis.adjustedRating.toFixed(1)}★ · trust ${analysis.trustScore}/100`;

  show({
    grade: analysis.grade,
    tone: GRADE_TONE[analysis.grade],
    headline: ratingsOnly ? RATINGS_ONLY_TITLES[analysis.grade] : HEADLINES[analysis.grade],
    sub: adjusted,
    basis: analysis.basis,
  });
}

async function wireSettings(): Promise<void> {
  const toggle = $('enabled') as HTMLInputElement;
  toggle.checked = (await getSettings()).enabled;
  toggle.addEventListener('change', () => {
    void setSettings({ enabled: toggle.checked });
  });
}

function wireOptionsLink(): void {
  document.getElementById('options')?.addEventListener('click', (event) => {
    event.preventDefault();
    chrome.runtime.openOptionsPage();
  });
}

/**
 * Fill the sponsorship slot.
 *
 * Deliberately not awaited alongside the analysis: the grade must paint
 * immediately whether or not an ad server answers, and mountAdSlot already
 * swallows every failure. If the slot stays empty, the popup simply has a
 * little less in it.
 */
function wireAdSlot(): void {
  const host = document.getElementById('ad');
  if (host) void mountAdSlot(host, 'popup');
}

void loadAnalysis();
void wireSettings();
wireOptionsLink();
wireAdSlot();
