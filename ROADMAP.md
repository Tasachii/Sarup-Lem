# สรุปเล่ม — Roadmap

Where the project goes from here, in shippable stages. v1.0 is done and works; every
stage after it is optional and independent — pick by goal, not by order. Effort sizes
assume one developer who knows the codebase (see [`PROJECT_GUIDE.md`](PROJECT_GUIDE.md)
for the seams each item plugs into).

| Version | Theme | Goal |
|---|---|---|
| **v1.0** ✅ | Core product | Summarize any document completely, on localhost, with cost transparency |
| **v1.1** | Prove it | Validate the core promise with real runs; polish what that reveals |
| **v2.0** | Power features | Remove the known product limitations |
| **v2.5** | Friends & family | Safe to share with a handful of trusted users |
| **v3.0** | Public | Safe to put on the open internet |

---

## v1.0 — Shipped ✅

Multi-format upload (PDF incl. scans / DOCX / TXT / MD) → token count + THB price
confirmation → three detail levels → streaming summary with a stop button → document Q&A
with prompt caching → local history → Markdown export. Offline test suite + CI. Full
docs (README, DESCRIPTION, PROJECT_GUIDE).

---

## v1.1 — Prove it (needs an API key, ~1 day)

The one thing v1.0 never did: run a real summary. Everything in this stage is about
closing that gap.

- **End-to-end validation** — summarize 2–3 real books at each detail level; check the
  summary's `##` headings against each book's table of contents. This is the acceptance
  test for the core promise ("ไม่ตกหล่น").
- **Verification pass (the completeness guarantee, made real)** — after the summary
  stream ends, run one cheap follow-up call: *"List the document's chapters/sections;
  for each, mark whether the summary above covers it."* Surface the result as a coverage
  checklist under the summary. The chat endpoint already has everything needed
  (document + cache + question) — this is mostly a prompt plus a small UI block.
- **Real screenshots** — capture the confirmation card, a streaming summary, and a Q&A
  thread; add them to `DESCRIPTION.md` (currently it only shows the empty home screen).
- **Tune the prompts with evidence** — if validation finds weak spots (e.g. late
  chapters getting thin), adjust `SUMMARY_INSTRUCTIONS` in `lib/summarize.ts` and re-run.
  Prompt changes are one-file edits by design.
- **Live exchange rate** — replace the fixed 36 THB/USD with a daily-cached rate fetch,
  falling back to the constant offline. Small, but the price card is the product's
  centerpiece, so it should be right.

---

## v2.0 — Power features (each independent, ~½–2 days apiece)

- **Auto-chunking for giant books (>1M tokens)** — today these are rejected. Plan:
  when `analyze` flags an oversized document, split the extracted text at chapter-ish
  boundaries (~700K tokens per chunk), summarize chunks sequentially with the same level
  instruction, then run a final synthesis pass over the chunk summaries. The seam is
  `summarize/route.ts`; the streaming contract with the UI doesn't change (stream chunk
  summaries as they come, then the synthesis). Costs scale linearly — keep the price
  estimate honest by multiplying in `estimateCost`.
- **Q&A from history** — today chat dies when the original `File` is gone. Plan: keep
  the *extracted text* (not the file) in the history entry, or upload the document once
  to Anthropic's Files API and store the `file_id`. Either way `chat/route.ts` gains a
  "no file, use stored content" path. Storing extracted text in `localStorage` is the
  zero-infrastructure version (watch the 5MB quota — store compressed or cap per entry).
- **Cancel for chat + regenerate** — the summary has a stop button; chat should too,
  plus a "ตอบใหม่" that re-asks the last question. Same `AbortController` pattern,
  already proven in `page.tsx`.
- **Summary export as PDF** — print stylesheet for the paper card +
  `window.print()` is 90% of the value for 5% of the work of a real PDF pipeline.
- **EPUB support** — one new branch in `extractFromFile()` (epub is a zip of XHTML —
  `jszip` + strip tags), one fixture, one test case, add `.epub` to the `accept` list.
- **Compare levels** — let the user run Brief first (cheap), then upgrade the same
  document to Standard/Detailed without re-uploading; cache the extraction server-side
  for a few minutes so the second run skips straight to the model call.

---

## v2.5 — Friends & family (~1 day total, do all four together)

Goal: a deployed URL a few trusted people can use **without being able to drain your
API credit**. See PROJECT_GUIDE §13 for why the app is localhost-only today.

1. **Spending limit in the Anthropic Console** — the hard backstop. Do this first;
   it's a console setting, not code.
2. **Password gate** — a Next.js middleware checking a shared secret cookie against
   `APP_PASSWORD` env var; a tiny `/login` page sets it. Not real auth — just keeps
   strangers out.
3. **Rate limiting** — per-IP daily caps (e.g. 5 summaries/day) with an in-memory or
   KV counter, returned as a friendly Thai error via the existing `friendlyError` path.
4. **Deploy** — Vercel or Railway. Two platform gotchas to solve at the same time:
   request-body limits (~4.5MB on Vercel) break large uploads — either host on a
   platform without the limit or move uploads to blob storage; and `maxDuration` for
   long streams needs a paid tier or a platform with no function timeout.

---

## v3.0 — Public (1–2 weeks, only if real demand exists)

Everything in v2.5, replaced by the grown-up version:

- **Real authentication** — NextAuth (Google sign-in). Every request belongs to a user.
- **The billing question — decide the model first, it shapes everything:**
  - **BYOK (recommended for this project):** each user pastes their own Anthropic API
    key (stored encrypted per user, or kept client-side and forwarded per request).
    Spending becomes the user's problem; you only need auth + light quotas. This is the
    realistic path for a free/portfolio product.
  - **You pay + quotas/subscription:** free tier (e.g. 3 books/month) tracked in a DB,
    paid tier via Stripe. Real billing work — only worth it with real users.
- **Database** (Postgres, or SQLite via litestream) — users, usage records, and
  server-side summary history (replacing `localStorage`, making history portable
  across devices and enabling Q&A-from-history properly).
- **Server-side document storage** — upload once per session (blob storage or
  Anthropic Files API), so chat stops re-sending 20MB scans and body-size limits stop
  mattering.
- **Observability** — request logging with per-user token usage, error alerting, and a
  tiny admin page showing spend per day. You cannot run a paid-API product blind.

---

## Non-goals (deliberately out of scope)

- **Mobile app** — the web app is responsive; a native wrapper adds maintenance for
  no new capability.
- **Multi-model support** — one well-tuned model beats a model picker; revisit only if
  pricing shifts dramatically.
- **Accounts before v3.0** — every stage before "Public" works without a user system,
  and adding one early would slow everything else down.
