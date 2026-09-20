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
  // The two documents a store reviewer reads, and whose text becomes the public
  // store page. They were written before sponsorship existed and were not part
  // of the release that falsified them, so they are pinned here too.
  store: 'docs/store-listing.md',
  justification: 'docs/host-permission-justification.txt',
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

/**
 * The copy that goes to a store reviewer.
 *
 * `docs/store-listing.md` becomes the public store page and the answers typed
 * into the submission form; `docs/host-permission-justification.txt` is pasted
 * into the permission field. Both were last edited for 0.4.0, before
 * sponsorship existed, and the release that rewrote every user-facing surface
 * left them behind — so the most public copy Winnow has was still promising
 * "no sponsored placements" while the build carried a sponsorship slot.
 *
 * A false monetisation claim here is not an embarrassment, it is an attestation
 * to Google and Mozilla. These assertions hold both files to the standard the
 * storage justification already sets for itself in its own note: a disclosure
 * that silently goes stale is worse than a broad one.
 */
describe('the copy that goes to store reviewers', () => {
  const REVIEWER_FILES = [
    ['store', FILES.store],
    ['justification', FILES.justification],
  ] as const;

  it('no longer promises that no network request is ever made', () => {
    // False since the ad broker shipped, whether or not a rail is configured:
    // the code path exists, and the claim is about the extension, not the build.
    for (const [name, path] of REVIEWER_FILES) {
      expect(read(path), `${name} still promises no network requests of any kind`).not.toMatch(
        /no network requests of any kind/i,
      );
    }
  });

  it('no longer claims there is no server to send anything to', () => {
    for (const [name, path] of REVIEWER_FILES) {
      expect(read(path), `${name} still claims there is nothing to send to`).not.toMatch(
        /no server to send anything to/i,
      );
    }
  });

  it('no longer claims no code path can transmit what is stored', () => {
    expect(read(FILES.store)).not.toMatch(/no code path in the extension capable of sending/i);
  });

  it('still says that what is stored is never transmitted', () => {
    // This is the part that stayed true, and the data disclosure rests on it.
    // The edit that removes the overclaim must not remove the claim.
    expect(read(FILES.store)).toMatch(/none of it is transmitted/i);
  });

  it('discloses sponsorship and names the boundary', () => {
    const store = read(FILES.store);
    expect(store, 'the listing never mentions sponsorship').toMatch(/sponsor/i);
    expect(store, 'the listing does not say where sponsorship cannot appear').toMatch(
      /never appears on an Amazon page/i,
    );
  });

  it('tells a reviewer the request carries no product and no identifier', () => {
    // The question a reviewer actually has about an ad-bearing extension.
    expect(read(FILES.store)).toMatch(/not the product|no field/i);
    expect(read(FILES.justification)).toMatch(/sponsor/i);
  });

  it('still states the load-bearing refusal of seller payment', () => {
    expect(read(FILES.store)).toMatch(
      /payment[^.]*from any seller, brand, marketplace or advertiser to influence, alter, suppress or promote/i,
    );
  });

  it('states that no sponsor is configured, while none is', async () => {
    const { activeNetworks } = await import('../src/shared/ads/registry.js');
    if (activeNetworks().length > 0) return; // a rail is live; rule does not apply

    for (const [name, path] of REVIEWER_FILES) {
      expect(read(path), `${name} does not disclose that no sponsor is configured`).toMatch(
        /no sponsor is configured/i,
      );
    }
  });

  it('no longer tells shoppers the extension makes no network requests', () => {
    // This one is on the public store page, not just the reviewer form.
    expect(read(FILES.store)).not.toMatch(/makes no network requests, has no server/i);
  });

  it('scopes the promise about what leaves the browser', () => {
    // "No data leaves your browser. Ever." is the same trap one sentence wider:
    // true of everything Winnow reads, and false the moment a sponsorship
    // request is made — which carries nothing about you, but is a request.
    const store = read(FILES.store);
    expect(store).not.toMatch(/No data leaves your browser\. Ever\./i);
    expect(store).not.toMatch(/transmittable by any code/i);
    expect(store, 'the listing does not say what does stay put').toMatch(
      /nothing about what you view leaves your browser/i,
    );
  });

  it('control: these assertions would catch the sentences they were written for', () => {
    // The literal text both files carried before this change. If the regexes
    // were too narrow to match it, the suite would have passed vacuously.
    const shipped = [
      'makes no network requests of any kind — the extension has no server to send anything to.',
      'There is no code path in the extension capable of sending any of it anywhere',
      'Winnow carries no affiliate links, no referral tags, no sponsored placements',
      "Right now, we don't. Winnow is free and there is nothing to buy.",
    ].join(' ');

    expect(shipped).toMatch(/no network requests of any kind/i);
    expect(shipped).toMatch(/no server to send anything to/i);
    expect(shipped).toMatch(/no code path in the extension capable of sending/i);
    expect(shipped).toMatch(/no sponsored placements/i);
    expect(shipped).toMatch(/Right now, we don't|there is nothing to buy/i);
  });
});

/**
 * The limit of "nothing leaves your machine".
 *
 * The sponsorship section's strongest sentence said the request "cannot be used
 * to recognise you or to count you twice". The request *body* cannot: it is
 * byte-identical between installations, and `tests/ads-policy.test.ts` pins its
 * key set. The connection can — any request shows the receiving server an IP
 * address, and approximate location follows from it.
 *
 * Winnow's entire claim on this slot is that it does not overclaim, so the one
 * thing sponsorship cannot prevent has to be written down rather than left for
 * a critic to find.
 */
describe('the honest limit of a request that leaves the machine', () => {
  /**
   * Read one `## ` section rather than the whole document. PRIVACY.md already
   * mentions an IP address under deep analysis, so a document-wide match would
   * pass whether or not the sponsorship disclosure exists.
   */
  const section = (path: string, heading: string) => {
    const raw = readFileSync(path, 'utf8');
    const start = raw.indexOf(`## ${heading}`);
    expect(start, `${path} has no "## ${heading}" section`).toBeGreaterThan(-1);
    const body = raw.slice(start + 3);
    const end = body.search(/\n## /);
    return (end === -1 ? body : body.slice(0, end)).replace(/\s+/g, ' ');
  };

  it('says inside the sponsorship section that the sponsor sees the connection', () => {
    expect(
      section(FILES.privacy, 'Sponsorship'),
      'the sponsorship section never mentions the IP address a request reveals',
    ).toMatch(/IP address/i);
  });

  it('no longer claims the request cannot be used to recognise you', () => {
    expect(read(FILES.privacy)).not.toMatch(/cannot be used to recognise you/i);
  });

  it('still says the request body distinguishes nobody', () => {
    // The precise version of the claim that was too broad. Narrowing it must
    // not amount to dropping it.
    expect(section(FILES.privacy, 'Sponsorship')).toMatch(/byte-identical/i);
  });

  it('control: the section read is scoped, and the old sentence would be caught', () => {
    // Scoping: a phrase that exists elsewhere in PRIVACY.md must not appear in
    // the slice, or the assertions above are reading the whole document.
    const sponsorship = section(FILES.privacy, 'Sponsorship');
    expect(read(FILES.privacy)).toMatch(/never crawl Amazon using your session/i);
    expect(sponsorship).not.toMatch(/never crawl Amazon using your session/i);

    // And the regex is wide enough to have matched what was there.
    expect('so the request cannot be used to recognise you or to count you twice.').toMatch(
      /cannot be used to recognise you/i,
    );
  });
});
