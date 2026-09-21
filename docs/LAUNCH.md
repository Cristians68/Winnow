# Getting Winnow in front of people

Everything here is written to be copied and pasted. Nothing here involves pretending to be a user.

---

## The rule, before anything else

**No fake reviews, no sock puppets, no astroturfing, no paid "organic" posts, no asking friends to
leave five stars.** Not because it is against the rules, though it is. Because Winnow's entire
product is detecting exactly that behaviour, and being caught doing it is not a setback — it is the
end of the product. There is no version of this where the fake-review-detector got caught faking
reviews and recovered.

It also means the one asset the competition cannot copy is being straight. Lead with it.

---

## Order of operations

The sequence matters more than any individual post.

1. **Upload 0.5.0.** Everything below sends people to a store listing. Two releases are currently
   unshipped and the store still serves 0.3.0.
2. **Submit to Firefox/AMO.** A second channel for an afternoon's work.
3. **Post the honest launches** (Hacker News, Reddit, Product Hunt) — these give a spike.
4. **Do the outreach** — this gives the durable traffic, because a link in a roundup article keeps
   working for years.
5. **Then** consider sponsorship. No ad network approves a publisher with no traffic.

Do not do 3 before 1. A launch post that lands on a stale listing wastes the one launch you get.

---

## 1. Hacker News — "Show HN"

HN is the best single fit. The audience cares about privacy, open source, and MV3 permissions, and
the Fakespot shutdown is a story that community followed.

**Post title** (HN titles must be plain — no hype, no emoji):

```
Show HN: Winnow – open-source Amazon review analysis that runs in the browser
```

**First comment** (post this yourself immediately after submitting):

```
I built this after Mozilla shut Fakespot down on 1 July 2025 and shipped no replacement.

The thing that made it interesting to build: since around May 2026, Amazon's /product-reviews/
pages 404 without session cookies and full review bodies left the public HTML. So the old
model — paste a URL, a server fetches and analyses it — can't really be rebuilt. A server sees
far less than a logged-in shopper does. An extension reads the page the browser already
rendered, which is now the only place the reviews are.

It runs seven checks locally (rating distribution, verified purchases, phrasing, duplicate
text, posting bursts, review substance, helpful votes) and reports the star average left after
setting aside the ones that failed.

Two design decisions I'd be interested in arguments about:

1. It refuses to give an adjusted rating when the sample is too thin. Amazon shows 8-13
   featured reviews per page — small and biased — so confidence is capped and sometimes the
   answer is "not enough to say". That makes it less satisfying than checkers that always
   return a number, which I think is correct but it does cost something.

2. No affiliate links, permanently, written into the privacy policy rather than the README. A
   tool that earns a commission when you buy can't credibly tell you not to buy. It's also the
   main thing I'd want to check about any tool like this, so it seemed fair to make it
   checkable rather than promised.

Scoring engine is MIT and dependency-free so you can read why a grade came out the way it did:
https://github.com/Cristians68/Winnow

Happy to answer anything about the signal design or the MV3 constraints.
```

**Timing.** Weekday morning US Eastern. Do not ask anyone to upvote — HN detects voting rings and
penalises the submission, and it is the same category of thing as the rule at the top of this file.

**Be present for four hours.** On Show HN, the comment thread is the product. Answer criticism
directly, concede what is fair, and do not get defensive about the false-positive question — it is
the right question.

---

## 2. Reddit

Reddit converts well and bans self-promotion aggressively. Read each subreddit's rules before
posting; several require a comment history before a link post is allowed.

**Do not cross-post the same text.** Identical copy across subreddits is the fastest way to get
filtered as spam. Each one below is written differently on purpose.

### r/amazonreviews, r/AmazonSeller (read rules — some ban tool posts outright)

```
Title: Amazon's /product-reviews/ pages now 404 without session cookies — which is why
       the old review-checking sites can't come back

Body:
Noticed this while building a review-analysis tool and thought it was worth writing up
separately, because it explains why Fakespot/ReviewMeta-style sites have quietly stopped
working rather than just shutting down.

Since roughly May 2026, requesting a product's review pages without session cookies returns
404, and full review text is no longer in the public HTML. So any service that works by
fetching a listing server-side now sees a fraction of what you see logged in. That's a
structural problem, not a funding one — and Mozilla shutting Fakespot in July 2025 wasn't the
whole story.

The practical upshot for anyone still checking listings by hand: the featured reviews on the
page are a biased sample chosen by Amazon, usually 8-13 of them. If you want signal, the 1-
and 2-star reviews are the most informative thing on the page — they're the hardest to fake,
because nobody pays for complaints.

(I do maintain an open-source extension in this space; happy to link it if that's allowed here,
but the above stands on its own.)
```

### r/privacy, r/degoogle

```
Title: I wrote an Amazon review checker that asks for one permission, and I'd like people
       to check that claim rather than believe it

Body:
Most shopping extensions ask to read every site you visit. That's the part I wanted to avoid,
so this one requests "storage" plus the Amazon storefronts it runs on, and nothing else. No
account, no analytics, no telemetry.

The reason I'm posting here rather than somewhere friendlier: I'd genuinely like people who
read manifests to read this one. The scoring engine is MIT and dependency-free, the content
script contains no network call at all, and there's a test in the repo that greps the built
bundles to prove it — with a control that proves the grep can actually fail, because a check
that can't fail is just a green light with no bulb in it.

If something in there is worse than I think it is, I'd rather hear it from this subreddit than
find out later.

[link]
```

### r/BuyItForLife, r/Frugal, r/ShoppingDeals — **do not post a link here**

These subs dislike promotion and will remove it. Instead: be useful in comment threads where
someone asks "how do I tell if these reviews are fake", link the guide page rather than the
store listing, and only if it genuinely answers the question. One good comment on an active
thread outperforms a removed post.

---

## 3. Product Hunt

Lower quality traffic than HN but it produces backlinks and a permanent listing.

**Tagline (60 chars):**
```
The Amazon review checker that admits when it can't tell
```

**Description:**
```
Fakespot shut down in July 2025 and nothing credible replaced it. Winnow analyses the reviews
on an Amazon product page and shows the rating that product would have without the manipulated
ones — computed on your device, with every check shown.

It caps its own confidence when the sample is thin, and reports no adjusted rating rather than
inventing one. No affiliate links, permanently, written into the privacy policy. The scoring
engine is open source so a grade you disagree with is one you can go read the reason for.
```

Launch Tuesday–Thursday, 12:01am Pacific.

---

## 4. Outreach — the part with the longest half-life

A spot in a "best Fakespot alternatives" article keeps sending people for years, and those
articles are actively maintained because they earn affiliate revenue.

**Find the targets:**

```
site:*.com "fakespot alternative" 2026
site:*.com "fakespot shut down"
"review checker" extension roundup 2026
site:reddit.com "fakespot alternative"
```

Take the first three pages of results. Note the author and the publication date. Prioritise
anything updated in the last six months — those are the ones being maintained.

**Email template:**

```
Subject: Winnow, for your [article title] roundup

Hi [name],

Your [article title] piece is the first result I get for "fakespot alternative", and I noticed
it's been kept current — so I wanted to put one more option in front of you rather than ask you
to find it.

Winnow (https://winnow-reviews.vercel.app) analyses Amazon review integrity in the browser
rather than on a server. Two things that might make it worth a line in the roundup:

- It asks for one permission, "storage", plus the Amazon domains it runs on. Most tools in this
  category ask to read every site you visit. That's verifiable on the store listing under
  Privacy practices, for us and for anything else you list.

- It carries no affiliate links and won't — it's a binding clause in the privacy policy, not a
  README line. I know that's an unusual thing to volunteer to someone whose article probably
  runs on affiliate revenue, and I don't think it should disqualify anything else you cover.
  But it's the difference readers in this category tend to care about.

The scoring engine is open source (MIT) if you want to check any claim above rather than take
my word: https://github.com/Cristians68/Winnow

No obligation at all, and no follow-up from me either way.

[name]
```

**Why that template works:** it names something specific about their article, gives a verifiable
claim rather than an adjective, and does not ask for anything. Do not follow up twice.

---

## 5. The comparison asset, once it is verified

There is a strong, checkable point available here that Winnow currently makes nowhere: every
Chrome extension must declare on its own listing what data it handles, Google shows it under
**Privacy practices**, and the developer is accountable for it.

Winnow declares `storage`. Several tools in this category declare considerably more.

**Verify before publishing any specific comparison.** Open each competitor's listing yourself,
read its Privacy practices section, and screenshot it with the date. Do not publish a claim about
a named competitor sourced from notes — including these notes. This was checked once and could not
be re-confirmed programmatically, because the Chrome Web Store blocks automated fetching.

Until it is re-verified, the site makes the honest version of the argument: here is our
declaration, go and compare it yourself. That is more persuasive anyway — a reader who checks it
believes it.

---

## What to measure

Check weekly, and write the numbers down somewhere:

- **Installs and weekly users** — Chrome Web Store dashboard.
- **Impressions and install rate** — same dashboard. If impressions are high and installs are
  low, the listing copy or the screenshots are the problem, not distribution.
- **Search queries and clicks** — Google Search Console, once the site is verified. Submit
  `https://winnow-reviews.vercel.app/sitemap.xml`.
- **Ratings** — the first few reviews set the tone for a long time.

The honest framing: this is a slow category. Expect the SEO pages to take two to three months to
rank for anything, and treat the launch posts as a one-off spike rather than a trend.

---

## First-week checklist

- [ ] Upload `winnow-0.5.0-chrome.zip` (publisher account is **jcrsanti990@gmail.com**, not the
      usual one). Expect in-depth review — storefronts go 14 → 20.
- [ ] Paste the updated short description and detailed description from `docs/store-listing.md`.
- [ ] Paste the host-permission justification from `docs/host-permission-justification.txt`
      (951 characters; the field truncates at 1000 without telling you).
- [ ] Submit the Firefox build to AMO.
- [ ] Verify `winnow-reviews.vercel.app` in Google Search Console, submit the sitemap.
- [ ] Post Show HN. Be available to reply for four hours.
- [ ] Send ten outreach emails. Ten, not a hundred — personalised ones work and a blast does not.
- [ ] Write down the install count so week two has something to compare against.
