# Winnow site

Static single page. No build step, no dependencies, no framework — it is one HTML file with inline
CSS, which is the honest amount of machinery for what it does.

## Deploying

```bash
cd site
vercel --prod
```

Or point any static host at this directory.

## Why the legal pages link to GitHub

The privacy and security policies are served from the repository rather than duplicated here.
Duplicating them would let the hosted copy drift out of step with the shipped one, and for documents
whose whole value is that they are accurate and checkable, drift is the failure mode that matters.
The Chrome Web Store accepts a GitHub URL for the privacy policy.

Once the repository is public, verify both footer links resolve before submitting the listing.

## Notes

- Theme-aware via `prefers-color-scheme`; both themes meet WCAG AA contrast.
- Respects `prefers-reduced-motion`.
- Skip link, landmark regions, a single `h1`, and a visible focus indicator throughout.
- The wide table scrolls inside its own container so the page body never scrolls horizontally.
- The trademark disclaimer in the footer is deliberate: Winnow analyses Amazon listings and must not
  imply any affiliation.
