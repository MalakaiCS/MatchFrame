# Public website

The signed-out pages at `/`: homepage, features, how it works, graphics showcase, sports, pricing, FAQ,
documentation and contact. Built from the MatchFrame public website expansion plan (20 October 2026) and redesigned
on 24 October 2026: light and dark versions, a new homepage, real product images, pricing that carries the chosen
plan to sign-up, and a contact form that stores every enquiry.

## Light and dark

Every page (the site, sign-in pages and the app) has a light and a dark version. Dark is the default; the sun/moon
button in the header and the *Light / Dark / System* choice in the footer (and in the app's account menu) change it,
and the choice is kept in the browser (`localStorage['mf-theme']`). A small script in `<head>`
(`apps/web/lib/theme.ts`) sets `html[data-theme]` before the first paint, so there is no flash. Colours are tokens in
`packages/ui/src/tokens.css` (dark under `@theme`, light under `:root[data-theme='light']`); use `bg-bg`, `bg-panel`,
`bg-elevated`, `text-text`, `text-muted`, `border-border`, `bg-primary text-on-primary` and so on rather than fixed
colours, and the `light:` / `dark:` variants for the rare exception. Broadcast graphics and the scorer's *Sunlight*
mode keep their own colours.

## Where the content lives

| What | File | Notes |
| --- | --- | --- |
| Capabilities, availability per edition, sports, the site video (`VIDEOS`) | `apps/web/content/site.ts` | One source for the homepage, features, sport pages and FAQ. `evidence` says how each claim was checked. Availability uses four words only: **Available**, **Beta**, **Coming soon**, **Requires media server**. The number of looks and graphics (`LOOK_COUNT`, `GRAPHIC_COUNT`) comes from the graphics registry in `@bs/graphics`, never typed in. |
| Product images (`SHOTS`) | `apps/web/components/site/shots.tsx`, files in `apps/web/public/site/` | Screens of the real app and stills of the real renderer, with fictional teams. Recapture with the app running: `BASE_URL=http://localhost:3000 CAPTURE_EMAIL=… CAPTURE_PASSWORD=… pnpm capture:site` (`ONLY=stills` or `ONLY=app` for half). The script creates its own sample match, hides overlay links and shows the signed-in person as "Sam Patel". |
| Homepage preview | `apps/web/components/site/graphics-sample.tsx` | The real renderer with sample data, a labelled *Sample*, four controls and Reset, pause/replay; no sequence for visitors who prefer reduced motion. The sample kick-off is always 15 minutes after the page loads. |
| Prices, plan comparison, currency and tax | `packages/domain/src/pricing.ts` (`PRICE_PLANS`, `PLAN_COMPARISON`, `PRICE_TERMS`) | The same catalogue drives `/pricing`, sign-up and Settings → Plan. `PRICE_TERMS.currency` and `.tax` are `null` until the owner confirms them; the page then says so instead of guessing. |
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
| `CONTACT_EMAIL` | The team inbox each enquiry is emailed to (reply-to is the sender). Every enquiry is stored first with a reference (`MF-XXXXXX`) and listed for site staff in the console (*Enquiries*); if the email cannot be sent it is retried (1, 5, 15 minutes, 1 and 3 hours) and the staff inbox shows it as failed. Enquiries are deleted after 365 days. |
| `PLATFORM_OWNER_EMAILS` | Site staff who read enquiries in the console. The form is open when `CONTACT_EMAIL` is set **or** at least one site staff member exists; with neither, it says it is not connected and names the setting, and never shows a success it did not achieve. |
| `PRODUCT_NAME` | Name inside the app (defaults to MatchFrame). The public site always says MatchFrame. If a deployment still has `PRODUCT_NAME=Broadcast Studio` from the old guide, change or remove it. |

## Decisions that need an owner

The site works without these, but each one controls a claim we do not make yet.

| Decision | Where it shows | Today |
| --- | --- | --- |
| Currency, GST, trials and cancellation terms | `/pricing`, FAQ "Is there a free plan?", "Can I cancel?" | Prices are published as supplied (`$29`, `$79`, `$199`, from `$499`, yearly at ten months) without a currency code or tax statement (`PRICE_TERMS` is `null`, and the page says the currency and tax treatment are confirmed at checkout); no trial is advertised, so the button says *Get started*, not *Start free trial*; cancellation terms are "not published yet". |
| Plan allowances and features | Plan screen, `/pricing` | Recorded on the organisation when a plan is chosen, but not enforced yet: any account can run more live matches, add more staff and use automation and sponsor rotation regardless of plan. |
| Online payment | Settings → Plan | Needs `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` and a Stripe price for each plan and period (`STRIPE_PRICE_STARTER_MONTHLY`, `_YEARLY`, `CLUB_…`, `STUDIO_…`). League / Enterprise is quoted. |
| Cloud video production ($10 per production hour) | `/pricing` optional services | Marked "Coming soon": the hosted service runs without the media server, and 1080p30 has not been measured (A51 showed the test host could not carry two 720p programmes). |
| "Published business hours" for Studio priority support | Studio plan card | No business hours are published anywhere yet. |
| Self-hosting terms (licence, access to the code) | FAQ "What does self-hosting mean?" | "Terms not published yet; contact us". |
| Who owns uploaded footage and graphics | Not on the site | The FAQ question is held back until there are approved terms. |
| Privacy policy and terms of service | Not on the site, and no footer links | The contact page says what happens to a message (stored with a reference, emailed to the team inbox, read by site staff, deleted after 365 days, no mailing list). Approved policy pages are still needed before selling the service; add them to `FOOTER` in `nav.ts` once they exist. |
| Testimonials, customer logos, usage numbers | Not on the site | None are shown. Add only approved quotes and logos with permission. |
| Live footage on the homepage | Homepage hero and sport pages | The preview plays the real renderer over an illustrated pitch (`public/site/scene-pitch.svg`, `scene-court.svg`). Replace with licensed footage of a real match if one is available. |
| Sign-in providers | `/login`, `/register`, Settings → Security | Google, Apple, Microsoft and Facebook buttons appear only when their client ID and secret are set (see `docs/deploy-hosted.md`); text-message codes only with `SMS_PROVIDER=twilio` and the `TWILIO_*` settings. Email codes, passwords and passkeys need nothing extra. |
| Support model and response times | `/contact`, FAQ "How do I get help on matchday?" | No response times are promised; no live matchday support. |
| Original logo files | Header, favicon, share image | A vector redraw of the supplied logo. Replace with the master files if they differ. |
| Launch indexing and the public address | `SITE_INDEXING`, `PUBLIC_WEB_URL` | Indexing is off. |
| First-setup time | FAQ "How long does the first setup take?" | Not measured, and the answer says so. Time a representative new user before publishing a number. |

## The graphics video

The showcase plays `apps/web/public/media/matchframe-looks.mp4` (with `matchframe-looks.jpg` as its
poster): about 54 seconds of MatchFrame's own renderer playing the Premier, Liga, Major, Southern, Continental,
Primetime and Meister looks with fictional teams, recorded from the `/reel` page. It plays muted on a loop while on
screen, never for visitors who prefer reduced motion, and stays paused once a visitor pauses it. Nothing loads from a
third party; the content-security policy no longer allows any outside frame.

After changing a look or the reel's sequence (`apps/web/app/(render)/reel/page.tsx`), record it again with the app
running and ffmpeg installed: `BASE_URL=http://localhost:3000 pnpm record:reel`. The recorder plays the reel at a
quarter speed while Chromium captures it and puts each frame back on the reel's own time, so the video is a smooth
30 frames a second. Open `/reel` to watch the sequence live.

## Checks

`tests/e2e/specs/public-site.spec.ts` (signed out): MatchFrame branding and one heading on every page; every
header and footer link returns 200; robots and sitemap; the light/dark switch and that it is remembered; at 390 px
with reduced motion, no sideways scrolling on seven pages, the mobile menu and the interactive preview (a goal
changes the score and puts the goal graphic on air, Reset puts it back); FAQ search and deep links; docs search;
pricing (monthly and yearly, the annual charge, *Recommended for clubs*, the plan carried to sign-up, the comparison
and optional services); the contact form validating, keeping what was typed, storing the enquiry with a reference,
arriving in Mailpit with the sender as reply-to, and being marked replied in the staff console (or saying it is not
connected). The showcase video and its poster are served from the site.

`tests/e2e/specs/sign-in.spec.ts`: from pricing to an account with an email code, onboarding, the plan reminder,
signing back in with a code, and the last-used method remembered. `tests/integration/contact.test.ts` and
`tests/integration/sign-in.test.ts` cover delivery and retries, the configuration states, email and text-message
codes, two-step sign-in after a code or a provider, and which options the sign-in page offers.
