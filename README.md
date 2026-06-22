# สรุปเล่ม (Sarup Lem) — AI Book Summarizer

![Home screen](docs/screenshots/home.png)

## Project Description

- Project by: Phasathat Jaruchitsophon
- Project Type: Web Application (AI Document Summarizer)

สรุปเล่ม ("Summarize the Book") is a Thai-language web application that summarizes large documents and books without missing content. Users drop in a PDF, DOCX, TXT, or Markdown file; the app counts the document's tokens and shows an estimated cost in Thai Baht **before** any AI call is made, then streams a complete chapter-by-chapter summary in real time using Claude Sonnet 4.6. After summarizing, users can chat with the document to ask follow-up questions (powered by prompt caching, so repeated questions on the same document cost ~90% less), browse past summaries from local history, and export results as Markdown.

---

## Installation

Requirements: **Node.js 20+ (CI uses 22)** and **npm** (download from https://nodejs.org), plus an **Anthropic API key** (create one at https://platform.claude.com).

To clone this project:

```sh
git clone https://github.com/Tasachii/book-summarizer.git
cd book-summarizer
```

To install dependencies and create your environment file:

Windows:

```bat
npm install
copy .env.example .env.local
```

Mac:

```sh
npm install
cp .env.example .env.local
```

Then open `.env.local` in any text editor and paste your API key:

```
ANTHROPIC_API_KEY=sk-ant-your-key-here
```

---

## Running Guide

Development mode (hot reload) — same command on Windows and Mac:

```sh
npm run dev
```

Production mode:

```sh
npm run build
npm run start
```

Then open **http://localhost:3000** in your browser.

To run the test suite (works without an API key — fixtures are included in `test/fixtures/`):

```sh
npm test            # Vitest unit + route + component tests
npm run test:watch  # watch mode
npm run test:cov    # with coverage report (lines 80 / funcs 85 / branches 75 gate)
```

The legacy extraction smoke-script is still available via `npm run test:extract`.

---

## ⚠️ Deploying: do NOT expose these endpoints publicly without rate limiting

**The `/api/analyze`, `/api/summarize`, and `/api/chat` routes call the Anthropic API and spend real credits on every request.** `analyze` also performs a billable `countTokens` round-trip per upload, and `chat` re-sends the document each turn (kept cheap only by prompt caching). If these routes are reachable by the public internet without throttling, anyone can drain your account's credits.

This repo ships a **simple in-memory per-IP rate limiter** in `src/proxy.ts` (Next.js 16 renamed `middleware` → `proxy`) that caps each IP to **10 requests/minute** across the three paid routes. This is a single-instance safeguard for self-hosting; **it does NOT cover multi-instance / serverless deployments** (e.g. Vercel), where each instance keeps its own counter.

Before any public deployment you **must** add one of:

- A distributed rate limiter (e.g. Upstash `@upstash/ratelimit`) keyed by IP, **or**
- An auth gate / shared-secret header in front of the routes, **and**
- A reverse-proxy / `Content-Length` body-size cap (uploads are also bounded server-side to **25 MB** via `MAX_UPLOAD_BYTES`).

---

## Tutorial / Usage

1. **Upload** — Drag a `.pdf`, `.docx`, `.txt`, or `.md` file onto the drop zone (or click to browse).
2. **Review the cost** — The app counts tokens and shows the estimated price in THB/USD. Nothing is charged yet.
3. **Pick a detail level** — *Brief* (overview + key points, cheapest), *Standard* (full chapter-by-chapter summary), or *Detailed* (deep dive with examples and quotes). The cost estimate updates as you switch.
4. **Summarize** — Press "เริ่มสรุป" and watch the summary stream onto the paper card in real time.
5. **Ask follow-up questions** — Type questions in the chat box below the finished summary (e.g. "ขยายความบทที่ 3"). The first question pays the full document read; later questions are ~90% cheaper thanks to prompt caching.
6. **Save / revisit** — Copy the summary, download it as `.md`, or reopen it later from the history list on the home screen (stored in your browser, free to re-read).

