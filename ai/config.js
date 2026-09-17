// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 CLSOFTLAB (씨엘소프트랩), Dr. Lee Il-guk (이일국)
//
// AI layer configuration.
//
// AI_ENDPOINT: when EMPTY (""), the app runs in DEMO mode and uses a deterministic,
// offline Korean MockProvider (see ai/ai.js) — no network, no key, no cost.
//
// To enable REAL Claude responses, run the backend proxy in `server/` and set this to
// its POST URL, e.g. "http://localhost:8787/api/ai".
//
// SECURITY: the API key lives ONLY on the server (server/.env → ANTHROPIC_API_KEY).
// NEVER put an Anthropic API key in this file, in any browser code, or in the repo.
export const AI_ENDPOINT = "";
