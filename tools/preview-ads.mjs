/**
 * Render the sponsorship slot in a real browser, without shipping anything.
 *
 * Why this exists: every test covering the ad slot runs in happy-dom, which
 * does no layout at all. It can prove the right elements exist, that nothing
 * is parsed as HTML, and that the label is present — it cannot prove two boxes
 * do not overlap, that a long headline does not push the popup wider than
 * Chrome will draw it, or that the disclosure line is readable in dark mode.
 *
 * That gap is not hypothetical. The panel shipped with its three stat values
 * at three different heights, through a suite that passed and an axe audit
 * that was clean, until somebody looked at a screenshot.
 *
 * So this serves the *real* renderAd, with the *real* popup and options
 * stylesheets, across the states a sponsor could actually produce — including
 * the hostile ones. It changes no manifest and grants no permission: the
 * registry's networks all stay configured:false, and the preview installs a
 * fixture network through the same test seam the suites use.
 *
 *   npm run preview:ads
 */

import * as esbuild from 'esbuild';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';

const PORT = 8899;
const ORIGIN = 'https://ads.preview.example';

/** The cases worth looking at, not just the happy one. */
const CASES = [
  ['Typical text creative', {
    headline: 'Ship faster with Widgets',
    body: 'A tool for people who build things.',
    advertiser: 'Widget Co',
  }],
  ['With an image', {
    headline: 'Ship faster with Widgets',
    body: 'A tool for people who build things.',
    advertiser: 'Widget Co',
    imageUrl: `${ORIGIN}/img.png`,
  }],
  ['No body line', { headline: 'Short and sweet', body: '', advertiser: 'Terse Ltd' }],
  ['Longest headline the validator allows (80)', {
    headline: 'A'.repeat(76) + ' end',
    body: 'Checks the cap does not overflow the popup.',
    advertiser: 'Maximal Industries',
  }],
  ['Longest body the validator allows (140)', {
    headline: 'Reasonable headline',
    body: 'B'.repeat(136) + ' end',
    advertiser: 'Verbose Corp',
  }],
  ['Longest advertiser name (40)', {
    headline: 'Reasonable headline',
    body: 'Short body.',
    advertiser: 'C'.repeat(36) + ' end',
  }],
  ['Unbroken string, no spaces to wrap on', {
    headline: 'Supercalifragilisticexpialidociousandthensome',
    body: 'https://example.com/a/very/long/path/that/cannot/wrap/anywhere/at/all',
    advertiser: 'Nowrap',
  }],
  ['Markup in every field (must render as text)', {
    headline: '<img src=x onerror=alert(1)>',
    body: '<b>bold</b> & <script>alert(2)</script>',
    advertiser: '<i>Evil</i>',
  }],
  ['Empty slot (what ships today)', null],
];

const entry = `
import { renderAd } from '../src/shared/ads/render.js';
import { __setTestNetworks } from '../src/shared/ads/registry.js';

// The shipped registry has no configured network, so isAllowedCreativeUrl
// would reject every creative and the preview would render nothing at all —
// which would look like a pass. Install a fixture through the same seam the
// test suites use. Nothing here reaches a build.
__setTestNetworks([{
  id: 'direct', origin: ${JSON.stringify(ORIGIN)}, path: '/ad',
  label: 'Preview', transport: 'GET', params: {}, configured: true,
}]);

const CASES = ${JSON.stringify(CASES)};

for (const [title, fields] of CASES) {
  for (const theme of ['light', 'dark']) {
    const frame = document.createElement('section');
    frame.className = 'case ' + theme;
    const h = document.createElement('h2');
    h.textContent = title + ' — ' + theme;
    frame.append(h);

    const surface = document.createElement('div');
    surface.className = 'surface';
    const host = document.createElement('div');
    host.id = 'ad';
    surface.append(host);
    frame.append(surface);
    document.getElementById('cases').append(frame);

    renderAd(host, fields && {
      provider: 'direct',
      imageUrl: null,
      viewUrl: null,
      ...fields,
      clickUrl: ${JSON.stringify(ORIGIN)} + '/click',
    });
  }
}
`;

const built = await esbuild.build({
  stdin: { contents: entry, resolveDir: 'tools', loader: 'ts' },
  bundle: true,
  format: 'iife',
  write: false,
  target: ['chrome120'],
});

/** Pull the slot rules out of a shipped stylesheet so the preview cannot drift. */
async function slotCss(file) {
  const html = await readFile(file, 'utf8');
  const css = html.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? '';
  return css;
}

const popupCss = await slotCss('src/popup/ui/popup.html');
const optionsCss = await slotCss('src/options/ui/options.html');

const page = `<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<title>Winnow ad slot preview</title>
<style>
  body { font: 14px system-ui, sans-serif; margin: 0; padding: 24px; background: #eceef2; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  .note { color: #555; margin: 0 0 22px; max-width: 70ch; line-height: 1.5; }
  #cases { display: grid; grid-template-columns: repeat(auto-fill, minmax(360px, 1fr)); gap: 18px; }
  .case h2 { font-size: 12px; font-weight: 600; color: #444; margin: 0 0 6px; }
  /* The popup is 320px wide in Chrome. Preview at that width or a headline
     that overflows there will look fine here and wrong in the product. */
  .surface { width: 320px; padding: 14px 16px; border-radius: 10px; border: 1px solid #d8dce3; }
  .case.light .surface { background: #fff; color: #16181d; }
  .case.dark .surface { background: #16181d; color: #e8eaed; }
  /* Shipped rules, lifted verbatim from the popup and options stylesheets. */
  ${popupCss}
  ${optionsCss}
  /* The shipped dark rules live behind prefers-color-scheme, which cannot be
     forced per element — restate them for the .dark frames so both themes are
     visible side by side on one screen. */
  .case.dark .ad-slot { background: #1d2027; border-color: #2c313a; }
  .case.dark .ad-label, .case.dark .ad-by, .case.dark .ad-note, .case.dark .ad-text { color: #9aa1ab; }
</style></head>
<body>
  <h1>Winnow sponsorship slot</h1>
  <p class="note">
    The real renderAd, with the shipped popup and options CSS, at the popup's real 320px width.
    Nothing here is configured in the product: every network in the registry is
    <code>configured: false</code> and this page installs a fixture through the test seam.
    Check for overflow, overlap, unreadable contrast, and that the last case renders
    <em>nothing at all</em>.
  </p>
  <div id="cases"></div>
  <script>${built.outputFiles[0].text}</script>
</body></html>`;

createServer((_req, res) => {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(page);
}).listen(PORT, '127.0.0.1', () => {
  console.log(`[winnow] ad slot preview → http://127.0.0.1:${PORT}`);
  console.log('[winnow] Ctrl-C to stop. Nothing is written and no build is changed.');
});
