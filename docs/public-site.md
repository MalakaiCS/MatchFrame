# Public website

The signed-out pages at `/`: homepage, features, how it works, graphics showcase, sports, pricing, FAQ,
documentation and contact. Built from the MatchFrame public website expansion plan (20 October 2026).

## Where the content lives

| What | File | Notes |
| --- | --- | --- |
| Capabilities, availability per edition, sports, the site video | `apps/web/content/site.ts` | One source for the homepage, features, sport pages and FAQ. `evidence` says how each claim was checked. |
| FAQ | `apps/web/content/faq.ts` | `basis` records where each answer came from; `home: true` puts it on the homepage. |
| Documentation | `apps/web/content/docs.ts` | Bold text is the product's own labels. Update `verified` when a guide is re-checked against the interface. |
| Navigation and footer | `apps/web/components/site/nav.ts` | The sitemap and the link test use the same list. |
| Pages | `apps/web/app/(main)/(site)/` | Static pages; the layout adds the header and footer. |
| Brand mark, wordmark, share image | `apps/web/components/site/brand.tsx`, `apps/web/public/icon.svg`, `(site)/opengraph-image.tsx` | The mark is a vector redraw of the supplied logo; the wordmark uses Outfit ExtraBold. |

Inline markup in content files: `[label](/href)`, `**bold**` and `` `code` ``.

Rules the content follows (from the plan): say "beta" or "needs the media server" where that is the truth,
keep untested or undecided things out of present-tense claims, and never invent prices, terms, customers or
measurements. When the product changes, change the content file and its `basis` or `evidence` in the same commit.

## Deployment settings

| Variable | Effect |
| --- | --- |
| `SITE_INDEXING=true` | Lets search engines index the public pages and publishes `/sitemap.xml` in `robots.txt`. Unset (the default), every page says `noindex` and `robots.txt` disallows everything, so a staging address never appears in search. App, scorer, output and account pages are never indexed. Read at build time. |
| `PUBLIC_WEB_URL` | The site's public address, for canonical links, share images and the sitemap. |
| `CONTACT_EMAIL` | The inbox the contact form sends to (reply-to is the sender). Unset, the form says it is not connected instead of pretending to send. |
| `PRODUCT_NAME` | Name inside the app (defaults to MatchFrame). The public site always says MatchFrame. If a deployment still has `PRODUCT_NAME=Broadcast Studio` from the old guide, change or remove it. |

## Decisions that need an owner

The site works without these, but each one controls a claim we do not make yet.

| Decision | Where it shows | Today |
| --- | --- | --- |
| Currency, GST, trials and cancellation terms | `/pricing`, FAQ "Is there a free plan?", "Can I cancel?" | Prices are published as supplied (`$29`, `$79`, `$199`, from `$499`, yearly at ten months) without a currency code or GST statement; no trial is advertised; cancellation terms are "not published yet". |
| Plan allowances and features | Plan screen, `/pricing` | Recorded on the organisation when a plan is chosen, but not enforced yet: any account can run more live matches, add more staff and use automation and sponsor rotation regardless of plan. |
| Online payment | Settings → Plan | Needs `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` and a Stripe price for each plan and period (`STRIPE_PRICE_STARTER_MONTHLY`, `_YEARLY`, `CLUB_…`, `STUDIO_…`). League / Enterprise is quoted. |
| Cloud video production ($10 per production hour) | `/pricing` optional services | Marked "Coming soon": the hosted service runs without the media server, and 1080p30 has not been measured (A51 showed the test host could not carry two 720p programmes). |
| "Published business hours" for Studio priority support | Studio plan card | No business hours are published anywhere yet. |
| Self-hosting terms (licence, access to the code) | FAQ "What does self-hosting mean?" | "Terms not published yet; contact us". |
| Who owns uploaded footage and graphics | Not on the site | The FAQ question is held back until there are approved terms. |
| Privacy policy and terms of service | Not on the site | The contact page says what happens to a message (emailed to the team, not stored, no mailing list). Approved policy pages are still needed before selling the service. |
| Support model and response times | `/contact`, FAQ "How do I get help on matchday?" | No response times are promised; no live matchday support. |
| The video on the homepage and showcase | `VIDEOS.graphics` in `content/site.ts` | YouTube `k4ET0z97tz8`, as requested. It could not be viewed from the build environment, so its caption is neutral ("Graphics in action"). Its YouTube title is "Premier League Motion Graphics Pack — Expanded Edition", which suggests a third-party graphics pack rather than MatchFrame's output; it was the reference for the Premier look's restyle. Replace it with a recording of MatchFrame's own graphics, or remove it, before launch. |
| Original logo files | Header, favicon, share image | A vector redraw of the supplied logo. Replace with the master files if they differ. |
| Launch indexing and the public address | `SITE_INDEXING`, `PUBLIC_WEB_URL` | Indexing is off. |
| First-setup time | FAQ "How long does the first setup take?" | Not measured, and the answer says so. Time a representative new user before publishing a number. |

## Checks

`tests/e2e/specs/public-site.spec.ts` (signed out): MatchFrame branding and one heading on every page; every
header and footer link returns 200; robots and sitemap; the mobile menu; the interactive graphics sample (a goal
changes the score and puts the goal graphic on air); FAQ search and deep links; docs search; the contact form
validating, sending and arriving in Mailpit with the sender as reply-to (or saying it is not connected).
