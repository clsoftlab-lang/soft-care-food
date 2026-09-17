<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- Copyright 2026 CLSOFTLAB (씨엘소프트랩), Dr. Lee Il-guk (이일국) -->

# Soft Care Food — AI Proxy (backend)

A tiny Node HTTP server that lets the browser app call **Claude** without ever exposing the
Anthropic API key. The frontend runs in **mock mode** by default; this proxy is only needed to
enable **real** AI responses.

> ⚠️ This service returns AI text only. It is **not medical or nutritional advice**. For dysphagia
> (swallowing difficulty) or any medical condition, consult a physician, speech-language
> pathologist, or registered dietitian.

## What it does

- Exposes `POST /api/ai` with body `{ "task": "chat" | "explain" | "cooking", "payload": { ... } }`.
- Calls the Anthropic SDK with **model `claude-opus-5`**, adaptive thinking, and **streams** the
  text back to the browser.
- Reads the API key from `ANTHROPIC_API_KEY` — **server-side only**.

## Setup

```bash
cd server
cp .env.example .env        # then edit .env and paste your real key
npm install                 # installs @anthropic-ai/sdk
npm start                   # -> http://localhost:8787  (POST /api/ai)
```

`npm start` loads `./.env` automatically (a `node --env-file=.env index.mjs` invocation works too).

## Enable real AI in the frontend

Edit `../ai/config.js`:

```js
export const AI_ENDPOINT = "http://localhost:8787/api/ai";
```

Reload the app; the AI features now stream real Claude responses. Set it back to `""` for mock mode.

## Security

- **Keys are server-side only.** The key lives in `server/.env` (git-ignored) and never reaches the
  browser, the frontend bundle, or the repository.
- Never hard-code a key in `ai/config.js` or any client file.
- In production, restrict `CORS_ORIGIN` to your site's origin instead of `*`.

## Environment variables

| Variable            | Default          | Purpose                                  |
| ------------------- | ---------------- | ---------------------------------------- |
| `ANTHROPIC_API_KEY` | *(required)*     | Your Anthropic API key (secret).         |
| `AI_MODEL`          | `claude-opus-5`  | Model id.                                |
| `PORT`              | `8787`           | Port the proxy listens on.               |
| `CORS_ORIGIN`       | `*`              | Allowed browser origin.                  |

## License

Apache-2.0. Not an official Anthropic product.
