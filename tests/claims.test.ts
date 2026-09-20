/**
 * Every promise Winnow makes about itself, checked against what it now does.
 *
 * Winnow's product is a judgement about whether other people's claims are
 * honest. A false claim in its own copy is not a documentation bug, it is the
 * product failing at the thing it exists to do — and PRIVACY.md says so itself:
 * a change to the money model is to be "announced prominently, never altered
 * quietly in this document".
 *
 * Shipping a sponsorship slot falsified two specific sentences. This suite
 * exists so they cannot come back, and so the promises that are still true
 * cannot be lost in the edit that removes them.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const FILES = {
  privacy: 'PRIVACY.md',
  readme: 'README.md',
  popup: 'src/popup/ui/popup.html',
  options: 'src/options/ui/options.html',
  site: 'site/index.html',
};

/**
 * Markdown and HTML wrap prose across lines, so a phrase assertion written as
 * one sentence would fail on the line break rather than on the content. Every
 * read here collapses whitespace so the assertions are about wording.
 */
const read = (path: string) => readFileSync(path, 'utf8').replace(/\s+/g, ' ');
const all = () => Object.entries(FILES).map(([name, path]) => [name, read(path)] as const);

describe('claims that ads made false', () => {
  it('no longer says Winnow makes no money', () => {
    for (const [name, text] of all()) {
      expect(text, `${name} still says Winnow makes no money`).not.toMatch(
        /makes no money|make no money|Right now, we don't|there is nothing to buy/i,
      );
    }
  });

  it('no longer lists advertising among the things Winnow does not do', () => {
    // The specific sentence was "Run analytics, telemetry, crash reporting,
    // advertising or fingerprinting".
    expect(read(FILES.privacy)).not.toMatch(
      /crash reporting,\s*advertising/i,
    );
  });

  it('no longer promises there are no sponsored placements', () => {
    for (const [name, text] of all()) {
      expect(text, `${name} still promises no sponsored placements`).not.toMatch(
        /no sponsored placements/i,
      );
    }
  });
});

describe('promises that are still true and must survive the edit', () => {
  it('still refuses payment from sellers to influence a grade', () => {
    // The load-bearing clause. It is what separates this slot from the
    // affiliate practice Winnow's own listing criticises, so an edit that
    // rewrote the money section must not have taken it along.
    expect(read(FILES.privacy)).toMatch(
      /does not and will not accept payment[^.]*from any seller, brand, marketplace or advertiser to influence, alter, suppress or promote any rating, grade or result/i,
    );
  });

  it('still carries no affiliate links or referral tags', () => {
    expect(read(FILES.privacy)).toMatch(/no affiliate links/i);
    expect(read(FILES.popup)).toMatch(/no affiliate links/i);
  });

  it('still promises never to crawl with the reader session', () => {
    expect(read(FILES.privacy)).toMatch(/never crawl Amazon using your session/i);
  });

  it('still says the grade is computed locally', () => {
    expect(read(FILES.readme)).toMatch(/locally/i);
  });
});

describe('what the new copy has to state plainly', () => {
  it('discloses sponsorship in the privacy policy', () => {
    expect(read(FILES.privacy)).toMatch(/sponsor/i);
  });

  it('says where sponsorship appears and where it does not', () => {
    // A disclosure that does not name the boundary is not a disclosure.
    const privacy = read(FILES.privacy);
    expect(privacy).toMatch(/never (appears |shown )?on (an )?Amazon/i);
  });

  it('says the sponsor is not told which product is being viewed', () => {
    for (const path of [FILES.privacy, FILES.options]) {
      expect(read(path), `${path} does not say what the sponsor is told`).toMatch(
        /which product/i,
      );
    }
  });

  it('tells people they can switch it off', () => {
    expect(read(FILES.privacy)).toMatch(/switch(ed)? (it )?off|turn(ing)? (it |this )?off/i);
  });

  it('control: these assertions read real files with real content', () => {
    // Every assertion above is a match or a non-match against a file read from
    // disk. If a path were wrong, readFileSync would throw — but if a file were
    // empty, half of them would pass vacuously.
    for (const [name, text] of all()) {
      expect(text.length, `${name} is empty`).toBeGreaterThan(500);
    }
  });
});

/**
 * The copy says sponsorship appears on two surfaces. Both had better have one.
 *
 * This exists because the first version of this feature shipped copy naming
 * the popup *and* the settings page while only the popup actually mounted a
 * slot. That is the precise failure mode Winnow exists to detect in other
 * people's listings, committed in its own privacy policy.
 */
describe('surfaces the copy promises', () => {
  const sources: Record<string, [html: string, script: string]> = {
    popup: ['src/popup/ui/popup.html', 'src/popup/index.ts'],
    options: ['src/options/ui/options.html', 'src/options/index.ts'],
  };

  for (const [surface, [html, script]] of Object.entries(sources)) {
    it(`${surface} has a slot host and mounts it`, () => {
      expect(read(html), `${html} has no #ad host`).toMatch(/id="ad"/);
      expect(read(script), `${script} never calls mountAdSlot`).toMatch(/mountAdSlot/);
    });
  }

  it('mounts each surface under its own slot name', () => {
    expect(read(sources.popup![1])).toMatch(/mountAdSlot\([^)]*'popup'\)/);
    expect(read(sources.options![1])).toMatch(/mountAdSlot\([^)]*'options'\)/);
  });

  it('control: these assertions would notice a missing mount', () => {
    // The regexes are specific enough to fail if the call were removed, and
    // generic enough to survive a rename of the host variable. Prove they do
    // not match a file that has no mount at all.
    expect(read('src/content/index.ts')).not.toMatch(/mountAdSlot/);
  });
});

/**
 * Copy must match what the build actually does, in tense as well as fact.
 *
 * v0.3.0 had to strip "false revenue claims" — the popup said "We make money
 * from subscriptions" and the site said "You pay us. Nobody else does.", both
 * present tense, both describing something that did not exist. This release
 * walked straight back into it: the sponsorship copy was written in the
 * present tense while every network in the registry ships configured:false,
 * so the extension shows no sponsor at all.
 *
 * The rule: while no network is configured, no surface may state as present
 * fact that a sponsored message is shown.
 */
describe('copy matches the configured state', () => {
  it('states plainly that no sponsor is configured, while none is', async () => {
    const { activeNetworks } = await import('../src/shared/ads/registry.js');
    if (activeNetworks().length > 0) return; // a rail is live; rule does not apply

    for (const [name, path] of [
      ['privacy', FILES.privacy],
      ['readme', FILES.readme],
      ['options', FILES.options],
    ] as const) {
      expect(read(path), `${name} does not disclose that no sponsor is configured`).toMatch(
        /no sponsor is configured/i,
      );
    }
  });

  it('never claims in the present tense that a sponsored message is shown', async () => {
    const { activeNetworks } = await import('../src/shared/ads/registry.js');
    if (activeNetworks().length > 0) return;

    for (const [name, text] of all()) {
      expect(text, `${name} claims a sponsor is shown when none is configured`).not.toMatch(
        /Winnow shows one sponsored message|sponsored message appears in|Sponsorship pays for Winnow/i,
      );
    }
  });

  it('control: the tense rule would catch the wording it was written for', () => {
    // The exact sentence this release shipped and had to correct.
    const offending = 'Winnow shows one sponsored message, in its own two windows only.';
    expect(offending).toMatch(/Winnow shows one sponsored message/i);
  });
});
