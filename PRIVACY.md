# Winnow Privacy Policy

**Last updated:** 26 July 2026
**Applies to:** the Winnow browser extension, all versions.

---

## The short version

Winnow does not collect, transmit, store, or sell any data about you. There is no server, no
account, and no analytics. All analysis happens on your own device.

---

## What Winnow accesses

When you open an Amazon product page, Winnow reads content your browser has **already rendered** on
that page: the product's rating, the rating breakdown, and the reviews visible on it.

That data is used immediately, in memory, on your device, to produce the analysis you see. It is not
written to disk, not sent anywhere, and not retained after you close the page.

## What Winnow stores

Exactly two settings — whether the panel is enabled, and whether the breakdown starts expanded.
These live in your browser's local extension storage and never leave your device. This is the sole
reason Winnow requests the `storage` permission.

## What Winnow does not do

Winnow does **not**:

- transmit any data off your device, to us or to anyone else
- operate a server, database, or logging system
- collect analytics, telemetry, crash reports, or usage statistics
- track your browsing, searches, purchases, or page history
- read pages outside the Amazon domains listed in its manifest
- create an account or ask for any personal information
- use cookies, fingerprinting, or advertising identifiers
- sell, rent, share, or disclose data to third parties, because it holds none

Winnow requests no `tabs` permission and no broad host access. You can verify this in the
extension's manifest before installing.

## Winnow will never crawl Amazon using your session

Winnow makes **no network requests of any kind**. It reads only what your browser already loaded for
a page you chose to visit.

This is deliberate and permanent. Amazon's terms prohibit automated data mining, and scraping
through a logged-in session puts *your* Amazon account at risk of suspension. Winnow accepts a
shallower analysis rather than exposing you to that. No future version will crawl your session.

## How Winnow makes money

**You pay us. Nobody else does.**

Winnow carries no affiliate links, no referral tags, no sponsored placements, no commissions, and no
merchant relationships. Winnow does not and will not accept payment, in any form, from any seller,
brand, marketplace, or advertiser to influence, alter, suppress, or promote any rating, grade, or
result it produces.

This is a binding commitment, not a description of current practice. A tool that earns a commission
when you buy cannot credibly tell you not to buy.

Should Winnow ever introduce paid features, they will be paid for by users directly, and this
section will continue to apply. If this commitment ever changes, it will be announced prominently
before taking effect, not altered quietly in this document.

The scoring engine is open source so that this claim can be independently verified rather than
merely trusted.

## Children

Winnow is not directed at children and collects no data from anyone, including children under 13.

## Changes to this policy

Material changes will be noted in the extension's changelog and reflected in the "last updated" date
above. Because Winnow collects no data, no change to this policy can retroactively affect
information about you — there is none to affect.

## Contact

Questions or concerns: open an issue at
<https://github.com/winnow-app/winnow/issues>.
