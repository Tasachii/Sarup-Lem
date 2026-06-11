# สรุปเล่ม (Sarup Lem) — Project Guide

This is the one document to read to understand the whole project: what สรุปเล่ม is, how the
repository is laid out, how every piece of code works, how data flows end to end, and how
to develop, test, and extend it. It complements the other docs rather than replacing them:

| Document | What it covers |
|---|---|
| [`README.md`](README.md) | User-facing overview, installation, usage |
| [`DESCRIPTION.md`](DESCRIPTION.md) | Project concept, objectives, architecture diagram, credits |
| [`ROADMAP.md`](ROADMAP.md) | Future development plan (v1.1 → v3.0), staged by goal |
| **This file** | How the code actually works, file by file |

---

## 1. What สรุปเล่ม is

สรุปเล่ม ("Summarize the Book") is a **single-machine web app** that turns large documents —
books, lecture notes, reports — into complete, structured Thai summaries:

- Drop in a **PDF, DOCX, TXT, or Markdown** file (scanned/image-only PDFs included).
- See the document's exact **token count and price in THB before anything is charged**.
- Pick a detail level, then watch a **chapter-by-chapter summary stream in real time**.
- **Chat with the document** afterwards — follow-up questions cost ~10% of the first one
  thanks to prompt caching.
- Reopen past summaries from a **local history** at no cost.

Everything runs as one Next.js app. The browser never talks to Anthropic directly; the
three API route handlers are the only place the API key exists, and the key never leaves
the server. There is no database — documents are processed in memory per request, and the
only persistent state is the summary history in the browser's `localStorage`.

The core principle: **no surprise spending.** Every path that costs money is preceded by
an explicit token count + price estimate that the user must confirm, and a failed run is
never silently billed twice (the user sees the error and decides).

```
Browser (page.tsx)
  │  FormData: file                       ┌──────────────────────────────┐
  ├─────────────► /api/analyze ──────────►│                              │
  │  FormData: file + level               │   Anthropic API              │
  ├─────────────► /api/summarize ────────►│   Claude Sonnet 4.6          │
  │  FormData: file + history + question  │   (count_tokens /            │
  ├─────────────► /api/chat ─────────────►│    messages.stream)          │
  │                                       └──────────────────────────────┘
  └── localStorage: summary history (client-only, max 30 entries)
```

## 2. Repository map

```
book-summarizer/
├── package.json                  # Next.js 16 app — dev/build/start scripts
├── .env.example                  # template: ANTHROPIC_API_KEY=
├── .env.local                    # your real key (gitignored)
├── docs/screenshots/home.png     # screenshot used by README/DESCRIPTION
├── .github/workflows/ci.yml      # CI: npm ci → build → test on every push/PR
├── scripts/
│   └── qa-extract.mts            # offline test suite for the extraction layer
├── test/fixtures/                # committed fixtures: txt/md/docx, text PDF,
│                                 #   scanned PDF, unsupported type, empty file
│
└── src/
    ├── lib/
    │   ├── extract.ts            # extractFromFile(): file → text | base64 PDF
    │   │                         # toUserContent(): build API content blocks
    │   ├── summarize.ts          # model id, pricing, detail levels, prompts,
    │   │                         #   estimateCost() — shared by client & server
    │   └── errors.ts             # friendlyError(): API errors → Thai messages
    │
    └── app/
        ├── layout.tsx            # root layout: Trirong + Anuphan fonts, Thai metadata
        ├── globals.css           # theme variables, grain, animations, markdown styles
        ├── page.tsx              # the entire client UI (one state machine)
        └── api/
            ├── analyze/route.ts  # token count + validation (the "price tag" step)
            ├── summarize/route.ts# streaming summary at a chosen detail level
            └── chat/route.ts     # streaming Q&A with prompt caching
```

Three layers, one direction of dependency: `page.tsx` → route handlers → `lib/*`.
The `lib` modules contain no I/O of their own (besides extraction) and are imported by
both sides — `estimateCost()` runs in the browser, the prompts run on the server.

## 3. The extraction layer (`src/lib/extract.ts`)

`extractFromFile(file)` is the single entry point for every uploaded file. It returns a
discriminated union, and the rest of the system branches on `kind`:

| Input | Result |
|---|---|
| `.txt` / `.md` | `{kind: "text"}` — UTF-8 decode, trimmed; empty file throws `ไฟล์ว่างเปล่า` |
| `.docx` | `{kind: "text"}` — extracted with mammoth (`extractRawText`) |
| `.pdf` with a text layer | `{kind: "text"}` — extracted with unpdf, all pages merged |
| `.pdf` with (almost) no text layer | `{kind: "pdf-native", base64}` — the raw file, base64-encoded |
| anything else | throws `รองรับเฉพาะไฟล์ .pdf .docx .txt และ .md` |

The PDF branch embodies one heuristic: if the extracted text is **shorter than 500
characters**, the file is assumed to be a scan (photographed/image-only pages), and the
whole PDF is sent to the model as a native document block instead — Claude reads the page
images directly with vision. Native mode is capped at **20 MB** (larger scans throw with
advice to split the file). Text mode has no size cap of its own; the real limit is the
950K-token guard in `/api/analyze` (§4).

`toUserContent(extracted, instruction, {cache?})` builds the `content` array for the API.
It deliberately produces **two blocks** — the document (text block wrapped in
`<document>` tags, or a native PDF document block) and the instruction/question as a
separate text block. Keeping them separate is what makes prompt caching work in §6: the
`cache_control` marker goes on the document block, so the question can change without
invalidating the cached document.

## 4. `/api/analyze` — the price tag

Runs before any paid summarization. Steps:

1. Reject immediately if `ANTHROPIC_API_KEY` is unset (clear Thai message).
2. `extractFromFile()` — all file-type errors surface here, before any API call.
3. Call Anthropic **`count_tokens`** with exactly the content `summarize` would send.
   This is the document's true size as the model sees it — not an estimate.
4. Reject documents over **950,000 tokens** (a safety margin under the model's 1M
   context window) with advice to split the file.
5. Return `{fileName, kind, inputTokens}`.

Cost math happens **client-side**: `estimateCost(inputTokens, level)` in
`lib/summarize.ts` computes `inputTokens × $3/M + estimatedOutput(level) × $15/M`,
converted at a fixed 36 THB/USD. Because the function is shared code, the number the user
sees updates instantly when they switch detail levels — no second server round-trip.

## 5. `/api/summarize` — the streaming summary

Receives the file again (the app is stateless server-side; the file lives in the
browser's memory between steps) plus a `level` field, validated against the three known
levels and defaulting to `standard`.

The Anthropic call:

- model `claude-sonnet-4-6`, adaptive thinking, effort `medium` — a deliberate
  cost/quality middle ground for summarization work;
- `max_tokens` from the level (8K brief / 32K standard / 56K detailed);
- system prompt = the "iron rules" (§7), user content = document + level instruction.

The response is piped back as a plain `text/plain` **`ReadableStream`**: the SDK's
`stream.on("text")` callback enqueues each delta into the HTTP response as it arrives,
so the browser renders words as the model writes them. Thinking deltas are not forwarded
— only final text. If the client disconnects, the stream's `cancel()` hook calls
`msgStream.abort()` so the upstream API call stops too.

**Error handling inside a stream is special.** Once streaming has started the HTTP status
is already sent, so a mid-stream failure can't become a 500. Instead the route appends a
Markdown blockquote — `> ⚠️ <friendly Thai message>` — to the stream and closes it. The
client recognizes this convention (§8): a summary that *starts* with the warning marker
is a failure and is **not** saved to history.

## 6. `/api/chat` — Q&A with prompt caching

The chat endpoint receives the file, the prior conversation (`history` array of
`{role, content}` turns, validated defensively), and the new `question`. It rebuilds the
Anthropic conversation like this:

```
messages[0] (user):  [ document block (cache_control: ephemeral),  first question ]
messages[1] (assistant): first answer
messages[2] (user): second question
...
last (user): the new question
```

The document is embedded **once, in the first user turn, with a `cache_control` marker**.
Anthropic caches the request prefix up to that marker for ~5 minutes. On every follow-up
question the prefix (system prompt + document block) is byte-identical — the extraction
is deterministic, and `toUserContent` keeps the changing question in a separate block —
so the API serves the document from cache at ~10% of the normal input price. This is the
entire mechanism behind "follow-up questions are ~90% cheaper"; there is no other state.

The Q&A system prompt instructs the model to answer **from the document**, to say
"ไม่มีระบุในเอกสาร" when the document doesn't contain the answer, and to cite
chapters/sections when it can. Answers are capped at 8K tokens and streamed exactly like
summaries (same `> ⚠️` error convention, rendered into the chat bubble).

## 7. Prompt design (`src/lib/summarize.ts`)

This module is the project's domain knowledge in one place: model id, pricing constants,
the token ceiling, the three levels, and all prompts.

**The system prompt** frames the model as a professional Thai editor and sets "iron
rules" aimed squarely at the completeness problem: cover *every* chapter and section in
original order, never skip any part, always preserve numbers/statistics/names/definitions/
counter-arguments, keep technical terms in their original language with Thai glosses,
output Markdown only.

**The three levels** differ in both instruction and output budget:

| Level | Structure requested | Est. output | `max_tokens` |
|---|---|---|---|
| `brief` | Overview → 10–15 key bullets (explicitly told not to bias toward early chapters) → 3–5 must-remember facts | ~3K | 8K |
| `standard` | Overview → per-chapter summary (`##` per real chapter, none skipped) → key insights → reference table of names/numbers/terms | ~10K | 32K |
| `detailed` | Standard structure, plus: 2–4 paragraphs per chapter, every step of any framework/method, significant quotes as blockquotes | ~20K | 56K |

The two-tier output (overview, then per-section summaries in original order) is also a
**verifiability device**: a reader can scan the `##` headings against the book's table of
contents and immediately see if anything is missing.

## 8. The UI (`src/app/page.tsx`)

The whole interface is one client component built around a five-phase state machine:

```
idle ──upload──► analyzing ──ok──► ready ──confirm──► summarizing ──stream ends──► done
  ▲                  │ error            │ error  ▲                                   │
  └──────────────────┴──────────────────┴────────┘◄──── "summarize again" ───────────┘
```

- **idle** — the drag-and-drop zone (also a click-to-browse button), plus the history
  list when any entries exist.
- **analyzing** — spinner while `/api/analyze` runs.
- **ready** — the confirmation card: file name, token count, the **level selector**
  (three buttons rendered from `Object.keys(LEVELS)`, so adding a level in `lib`
  automatically adds a button), and the price estimate that recomputes on every level
  switch. Nothing has been charged yet.
- **summarizing** — the client reads the response body with a `ReadableStream` reader,
  decodes chunks, and re-renders the Markdown view on every chunk; a blinking caret marks
  the stream as live. The accumulated text also lives in a local variable (`acc`) so the
  final, complete string is available synchronously when the stream ends. A **stop
  button** aborts the fetch via `AbortController` — the server's stream `cancel()` hook
  aborts the upstream Anthropic call, so spending stops; any partial summary stays
  visible (marked "หยุดการสรุปก่อนจบ") but is never saved to history.
- **done** — toolbar appears (copy / download `.md` / start over), and the **Q&A chat**
  section mounts below the summary.

**History** is a `localStorage` array (key `saruplem-history`, max 30 entries, newest
first) of `{id, fileName, date, level, summary}`. It is written when a stream completes —
unless the result is empty or starts with the `> ⚠️` failure marker. A
quota-exceeded write retries once with the list halved. Opening a history entry re-enters
`done` in a read-only mode: the original `File` object is gone, so the chat box is
replaced by a note explaining that Q&A needs the file re-uploaded.

**Chat** keeps its thread in React state only (intentionally not persisted — answering
requires the original file anyway). Sending a question appends a user turn and an empty
assistant turn, then streams the answer into that last turn chunk by chunk. While
streaming, the input is disabled and the bubble shows the caret.

**Design system** (`globals.css` + `layout.tsx`): a "midnight library" theme — warm
near-black ink background with a radial amber lamp glow and an SVG-noise grain overlay;
Trirong (Thai serif) for display type, Anuphan for body; summaries render on a
paper-colored card with print-like Markdown styles (amber-ruled `h1`, serif headings,
styled tables/blockquotes). Animations are CSS-only: staggered fade-up on load, pulsing
glow on the pay button, blinking stream caret.

## 9. Error handling (`src/lib/errors.ts`)

Raw Anthropic SDK errors are developer-speak (`401 {"type":"error",...}`). Every catch
path in the three routes funnels through `friendlyError()`, which pattern-matches the
message and returns an actionable Thai sentence:

| Detected | User sees |
|---|---|
| `authentication_error` / invalid key | "API key ไม่ถูกต้อง — ตรวจสอบ ANTHROPIC_API_KEY ในไฟล์ .env.local" |
| `credit balance` | "เครดิต Anthropic หมด — เติมเงินได้ที่ platform.claude.com" |
| `rate_limit_error` | "เรียกใช้งานถี่เกินไป — รอสักครู่แล้วลองใหม่" |
| `overloaded_error` | "ระบบ AI กำลังหนาแน่น — ลองใหม่อีกครั้ง" |
| `request_too_large` | "เอกสารใหญ่เกินไปสำหรับคำขอเดียว — ลองแบ่งไฟล์เป็นส่วนย่อย" |
| anything else | the original message, or a per-route Thai fallback |

Errors before streaming starts become proper JSON `{error}` responses with real status
codes; errors after streaming starts use the in-band `> ⚠️` convention (§5).

## 10. Cross-cutting design decisions

**Pay nothing without a confirmation.** The analyze step exists purely so the user sees
the exact token count and a price *before* committing. `count_tokens` itself is free.
This shapes the whole UX: the state machine has a deliberate stop at `ready`.

**The file never leaves the browser between steps.** There is no server-side upload
store; each endpoint receives the file again as `FormData`. This keeps the server
stateless and the privacy story simple (documents exist server-side only for the duration
of one request), at the cost of re-uploading per chat question — an accepted trade-off
for a localhost app (see §12 for what would change in deployment).

**Document and instruction live in separate content blocks.** A single concatenated
block would make every question a brand-new prefix and break prompt caching. The split in
`toUserContent` is small but load-bearing.

**Streams report errors in-band.** HTTP status is committed before a stream fails, so
failures travel as visible text with a recognizable marker, and the client uses that
marker to keep garbage out of history.

**Shared cost code, not duplicated.** `estimateCost` and the level table are one module
imported by both the browser (live preview) and any server code that needs it — the
numbers can't drift apart.

**Honest fallback for scanned PDFs.** Rather than failing on image-only PDFs (the common
case for photographed books), the app switches to vision reading — more expensive per
page, but it works, and the UI labels it ("อ่านจากไฟล์ PDF โดยตรง").

## 11. End-to-end walkthroughs

**A normal book.** User drops `book.pdf` → `analyze`: unpdf finds a text layer
(≥500 chars) → `count_tokens` says 180,000 tokens → UI shows ~฿24 at Standard; user
switches to Detailed, price updates to ~฿30 instantly (client-side math) → "เริ่มสรุป" →
`summarize` streams; the paper card fills chapter by chapter → stream ends; toolbar
appears; entry saved to history → user downloads `สรุป-book.md`.

**A scanned PDF.** Same flow, but extraction finds 0 chars of text → file is ≤20 MB, so
`{kind: "pdf-native"}` → the confirmation card shows "อ่านจากไฟล์ PDF โดยตรง (ไฟล์สแกน)" →
the model reads page images with vision; everything downstream is identical.

**Two chat questions.** After the summary, user asks "บทที่ 3 พูดถึงอะไร" → `chat` builds
`[document(cache_control) + question]`, the API **writes** the document to cache (first
question pays full price + small write premium) and streams the answer → user asks a
follow-up within 5 minutes → the rebuilt conversation has a byte-identical prefix, the
API **reads** the document from cache (~10% price), only the new turns are processed
fresh.

**A failure.** Key has no credit → `summarize` stream fails immediately → the stream
carries `> ⚠️ เครดิต Anthropic หมด — เติมเงินได้ที่ platform.claude.com` and closes →
the UI shows it on the paper card, the history guard sees the marker and saves nothing →
user fixes billing and presses "เริ่มสรุป" again from the same `ready` card.

## 12. Developing and testing

```bash
npm install                                  # Node 18+
cp .env.example .env.local                   # then paste your Anthropic API key
npm run dev                                  # dev server with hot reload, :3000
npm run build && npm run start               # production build + serve
npm test                                     # extraction test suite (no API key needed)
```

| Env var | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | The only secret. Server-side only — never exposed to the browser. |

**Testing strategy.** The extraction layer has a real test suite
(`scripts/qa-extract.mts` + committed fixtures in `test/fixtures/`): seven cases covering
txt/md/docx, a text-layer PDF (generated with Chrome's print-to-pdf so it has a genuine
text layer), a scanned PDF (must fall back to `pdf-native`), an unsupported type, and an
empty file — all runnable offline. GitHub Actions (`.github/workflows/ci.yml`) runs
`npm ci → build → test` on every push. Route behavior (validation order, error shapes, the in-band stream
error convention) was verified against a running server with a dummy key, which exercises
every code path except real model output. Anything involving actual summaries (quality,
caching hit rates, real cost) requires a funded key and is tested manually.

**Money-aware testing tip:** use a small `.txt` file and the `brief` level — a full
end-to-end run costs well under ฿1.

## 13. How to extend it

- **A new detail level** — add one entry to `LEVELS` and `SUMMARY_INSTRUCTIONS` in
  `lib/summarize.ts`. The level selector, cost preview, and `summarize` validation all
  derive from those tables; no other file changes.
- **A new file type** (e.g. EPUB) — add a branch in `extractFromFile()` that produces
  `{kind: "text"}`, and add the extension to the `accept` attribute in `page.tsx` and the
  error message listing supported types. Add a fixture + case to `qa-extract.mts`.
- **A different model** — change `MODEL` and the two pricing constants in
  `lib/summarize.ts`; revisit `max_tokens` per level against the new model's output cap.
- **Auto-chunking for >1M-token books** — the natural seam is in `summarize/route.ts`:
  when `analyze` flags an oversized document, split the extracted text, run per-chunk
  summaries, then a final synthesis pass. The UI's streaming contract wouldn't change.
- **Deploying publicly** — three prerequisites, in order: authentication, per-user rate
  limiting/quotas (every request spends *your* API credit), and replacing the
  re-upload-per-request model with server-side file storage (or Anthropic's Files API)
  so chat doesn't re-send 20 MB scans. Until then the app is localhost-by-design.
