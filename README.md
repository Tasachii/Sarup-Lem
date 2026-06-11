# สรุปเล่ม (Sarup Lem) — AI Book Summarizer

## Project Description

- Project by: Phasathat Jaruchitsophon
- Project Type: Web Application (AI Document Summarizer)

สรุปเล่ม ("Summarize the Book") is a Thai-language web application that summarizes large documents and books without missing content. Users drop in a PDF, DOCX, TXT, or Markdown file; the app counts the document's tokens and shows an estimated cost in Thai Baht **before** any AI call is made, then streams a complete chapter-by-chapter summary in real time using Claude Sonnet 4.6. After summarizing, users can chat with the document to ask follow-up questions (powered by prompt caching, so repeated questions on the same document cost ~90% less), browse past summaries from local history, and export results as Markdown.

---

## Installation

Requirements: **Node.js 18+** and **npm** (download from https://nodejs.org), plus an **Anthropic API key** (create one at https://platform.claude.com).

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

To run the file-extraction test suite (works without an API key):

```sh
npx tsx scripts/qa-extract.mts <path-to-fixture-folder>
```

---

## Tutorial / Usage

1. **Upload** — Drag a `.pdf`, `.docx`, `.txt`, or `.md` file onto the drop zone (or click to browse).
2. **Review the cost** — The app counts tokens and shows the estimated price in THB/USD. Nothing is charged yet.
3. **Pick a detail level** — *Brief* (overview + key points, cheapest), *Standard* (full chapter-by-chapter summary), or *Detailed* (deep dive with examples and quotes). The cost estimate updates as you switch.
4. **Summarize** — Press "เริ่มสรุป" and watch the summary stream onto the paper card in real time.
5. **Ask follow-up questions** — Type questions in the chat box below the finished summary (e.g. "ขยายความบทที่ 3"). The first question pays the full document read; later questions are ~90% cheaper thanks to prompt caching.
6. **Save / revisit** — Copy the summary, download it as `.md`, or reopen it later from the history list on the home screen (stored in your browser, free to re-read).

---

## Features

- **Multi-format ingestion** — PDF (text-based *and* scanned/image-only), DOCX, TXT, Markdown. Scanned PDFs up to 20 MB are sent to the model as raw documents so it can read them visually.
- **Cost transparency** — Token counting via the Anthropic `count_tokens` endpoint and a THB price estimate shown *before* every paid action; the user always confirms first.
- **Three summary depths** — Brief / Standard / Detailed, each with its own prompt structure and output budget.
- **Complete, structured summaries** — Overview → per-chapter summary covering every section → key insights → reference table of names, numbers, and terms.
- **Real-time streaming** — Summaries and chat answers render token-by-token.
- **Document Q&A with prompt caching** — Chat with the uploaded document; the document block is cached server-side (5-minute TTL) so follow-up questions avoid re-paying for the full document.
- **Local summary history** — Up to 30 past summaries kept in `localStorage`, with re-open and delete.
- **Friendly error handling** — API problems (invalid key, no credit, rate limit, overload) are translated into actionable Thai messages.

---

## Known Bugs

No known bugs at the time of writing. Current **limitations** (by design):

- Documents longer than ~950K tokens (very thick books) are rejected with a notice instead of being auto-split.
- Scanned PDFs are limited to 20 MB and roughly 100 pages per request (Anthropic native-PDF limit).
- Q&A is only available right after summarizing a live file — history entries store the summary text only, so you must re-upload the file to ask new questions.
- Summary history lives in the browser's `localStorage`; clearing browser data deletes it.

---

## Unfinished Works

- Automatic chunk-and-merge summarization for documents that exceed the 1M-token context window.
- Authentication and per-user rate limiting (required before deploying publicly — currently intended for localhost use only).
- End-to-end tests against the live Anthropic API (current test suite covers extraction and route validation offline).
- Configurable THB exchange rate (currently fixed at 36 THB/USD for estimates).

---

## External sources

Acknowledge to:

1. [Next.js](https://nextjs.org) — React framework (App Router, Turbopack) [MIT]
2. [Anthropic TypeScript SDK](https://github.com/anthropics/anthropic-sdk-typescript) — Claude API client, streaming, token counting [MIT]
3. [unpdf](https://github.com/unjs/unpdf) — PDF text extraction [MIT]
4. [mammoth.js](https://github.com/mwilliamson/mammoth.js) — DOCX text extraction [BSD-2-Clause]
5. [react-markdown](https://github.com/remarkjs/react-markdown) — Markdown rendering [MIT]
6. [Tailwind CSS](https://tailwindcss.com) — styling [MIT]
7. [Trirong](https://fonts.google.com/specimen/Trirong) and [Anuphan](https://fonts.google.com/specimen/Anuphan) — Thai typefaces via Google Fonts [SIL OFL 1.1]
