// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 CLSOFTLAB (씨엘소프트랩), Dr. Lee Il-guk (이일국)
//
// Backend proxy for the Soft Care Food AI layer.
//
//   POST /api/ai   body: { task, payload }   -> streams Claude's text response
//
// The Anthropic API key is read from the environment (ANTHROPIC_API_KEY) and stays on
// the server ONLY. The browser never sees it. See README.md and .env.example.
//
// COST-EFFICIENT & AUTONOMOUS (무인·저비용):
//   - Cost-first default model claude-haiku-4-5 (raise via AI_MODEL to claude-sonnet-5 /
//     claude-opus-5 for higher quality).
//   - Prompt caching on the stable per-task system prompt (cache_control: ephemeral).
//   - Modest per-task max_tokens output cap.
//   - Guardrails: per-IP rate limit + a monthly token budget; over budget -> HTTP 429
//     { fallback: true } so the browser auto-falls back to the offline mock (never breaks).
//
// Run:  npm install  &&  npm start        (loads ./.env if present; also honors --env-file)
// NOTE: intentionally NOT installed or invoked in CI (no key, no network).

import http from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import Anthropic from "@anthropic-ai/sdk";

const ROOT = dirname(fileURLToPath(import.meta.url));

// Minimal .env loader (no dependency). `node --env-file=.env` also works and wins.
loadDotEnv(join(ROOT, ".env"));

const PORT = Number(process.env.PORT || 8787);
// Cost-first default. AI_MODEL may be raised to `claude-sonnet-5` or `claude-opus-5`
// for higher quality (at higher token cost).
const MODEL = process.env.AI_MODEL || "claude-haiku-4-5";
const ALLOW_ORIGIN = process.env.CORS_ORIGIN || "*";

// ---- Cost guardrails ----
const RATE_LIMIT_PER_MIN = Number(process.env.AI_RATE_LIMIT_PER_MIN || 20); // requests / IP / minute
// Monthly token budget (input+output). When exceeded -> 429 { fallback: true }.
const MONTHLY_TOKEN_CAP = Number(process.env.AI_MONTHLY_TOKEN_CAP || 2000000);
// Modest default output cap; only raise per task where a task truly needs it.
const MAX_TOKENS = Number(process.env.AI_MAX_TOKENS || 700);

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
  console.error("[soft-care-food] ANTHROPIC_API_KEY is not set. Copy .env.example to .env and add your key.");
  process.exit(1);
}
const client = new Anthropic({ apiKey });

// Task-specific system prompts. Every task must label output as NOT medical/nutritional advice.
// These strings are STABLE per task, so they are sent as a cache-controlled system block.
const SYSTEMS = {
  chat:
    "당신은 '웰니스 개호식품(Soft Care Food)'의 연화식(부드러운 케어식) 상담 도우미입니다. " +
    "어르신의 씹기(저작)·삼킴(연하) 수준과 질환·알레르기·목표를 고려해 안전하고 부드러운 식품과 식사 방법을 한국어로 친절히 안내하세요. " +
    "알레르기 성분이 든 식품은 절대 권하지 마세요. 답변 끝에 '본 답변은 의료·영양 처방이 아니며, 삼킴장애 등은 전문가와 상담하세요'라는 안내를 반드시 포함하세요.",
  explain:
    "당신은 연화식 맞춤 식단 추천의 근거를 쉬운 한국어로 설명하는 도우미입니다. " +
    "씹기·삼킴 수준에 맞춘 연화 단계, 저염·고단백 등 선택 이유를 어르신 보호자가 이해하기 쉽게 설명하세요. " +
    "답변 끝에 의료·영양 처방이 아니라는 안내와 전문가 상담 권고를 반드시 포함하세요.",
  cooking:
    "당신은 연화식 제품의 조리·데우기 방법을 단계별로 안내하는 도우미입니다. " +
    "보관 상태 확인, 데우기, 삼킴 안전(온도 확인·자세·농도)을 한국어로 명확히 안내하세요. " +
    "답변 끝에 의료·영양 처방이 아니라는 안내와 전문가 상담 권고를 반드시 포함하세요.",
};

// Per-task output caps (fall back to MAX_TOKENS). Keep modest to control cost.
const MAX_TOKENS_BY_TASK = { chat: 700, explain: 700, cooking: 800 };

// Haiku 4.5 does NOT accept adaptive thinking / effort — sending them yields a 400.
const isHaiku = MODEL.startsWith("claude-haiku");

// ---- In-memory guardrail state (resets on restart) ----
const rl = new Map(); // ip -> { count, windowStart }
let monthKey = currentMonthKey();
let tokensThisMonth = 0;

const server = http.createServer(async (req, res) => {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", ALLOW_ORIGIN);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

  if (req.method === "POST" && req.url === "/api/ai") {
    // Guardrail 1: per-IP rate limit.
    if (!allowRequest(clientIp(req))) {
      res.writeHead(429, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ fallback: true, reason: "rate_limit" }));
      return;
    }
    // Guardrail 2: monthly token budget.
    rollMonthIfNeeded();
    if (tokensThisMonth >= MONTHLY_TOKEN_CAP) {
      res.writeHead(429, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ fallback: true, reason: "monthly_cap" }));
      return;
    }

    try {
      const { task, payload } = await readJson(req);
      const system = SYSTEMS[task] || SYSTEMS.chat;
      const messages = [{ role: "user", content: buildUserPrompt(task, payload) }];
      const maxTokens = MAX_TOKENS_BY_TASK[task] || MAX_TOKENS;

      res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-cache" });

      const params = {
        model: MODEL,
        max_tokens: maxTokens,
        // Prompt caching: the stable per-task system prompt is cached so repeated calls
        // read from cache and cost less.
        system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
        messages,
      };
      // Adaptive thinking / effort only for models that accept them (NOT Haiku 4.5).
      if (!isHaiku) {
        params.thinking = { type: "adaptive" };
        params.output_config = { effort: process.env.AI_EFFORT || "low" };
      }

      const stream = client.messages.stream(params);
      stream.on("text", (chunk) => res.write(chunk));
      const finalMsg = await stream.finalMessage();

      // Accumulate token usage from the final message for the monthly budget.
      const u = finalMsg && finalMsg.usage ? finalMsg.usage : {};
      const used =
        (u.input_tokens || 0) +
        (u.output_tokens || 0) +
        (u.cache_creation_input_tokens || 0) +
        (u.cache_read_input_tokens || 0);
      tokensThisMonth += used;

      res.end();
    } catch (err) {
      console.error("[soft-care-food] AI error:", err?.message || err);
      if (!res.headersSent) {
        // Signal the browser to auto-fall back to the offline mock (무인: never breaks).
        res.writeHead(502, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ fallback: true, reason: "upstream_error" }));
      } else {
        res.end();
      }
    }
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("Not found. Use POST /api/ai");
});

server.listen(PORT, () => {
  console.log(`[soft-care-food] AI proxy on http://localhost:${PORT}  (model: ${MODEL}${isHaiku ? ", no thinking/effort" : ", adaptive thinking"})`);
  console.log(`  Guardrails: ${RATE_LIMIT_PER_MIN}/min per IP, monthly cap ${MONTHLY_TOKEN_CAP.toLocaleString()} tokens, max_tokens ~${MAX_TOKENS}.`);
  console.log(`  Set AI_ENDPOINT="http://localhost:${PORT}/api/ai" in ai/config.js to enable real AI.`);
});

// ---------------- guardrail helpers ----------------
function clientIp(req) {
  const xff = req.headers["x-forwarded-for"];
  if (typeof xff === "string" && xff.length) return xff.split(",")[0].trim();
  return req.socket?.remoteAddress || "unknown";
}

function allowRequest(ip) {
  const now = Date.now();
  const rec = rl.get(ip);
  if (!rec || now - rec.windowStart >= 60000) {
    rl.set(ip, { count: 1, windowStart: now });
    return true;
  }
  if (rec.count >= RATE_LIMIT_PER_MIN) return false;
  rec.count += 1;
  return true;
}

function currentMonthKey() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${d.getUTCMonth()}`;
}
function rollMonthIfNeeded() {
  const k = currentMonthKey();
  if (k !== monthKey) { monthKey = k; tokensThisMonth = 0; }
}

// ---------------- helpers ----------------
function buildUserPrompt(task, payload = {}) {
  const p = payload || {};
  if (task === "cooking") {
    const prod = p.product || {};
    return [
      "다음 연화식 제품의 조리·데우기 방법을 단계별로 안내해 주세요.",
      `제품명: ${prod.name || p.productId || "(미상)"}`,
      prod.softness ? `연화 단계: ${prod.softness}` : "",
      prod.category ? `분류: ${prod.category}` : "",
      prod.heating ? `제조사 데우기 안내: ${prod.heating}` : "",
      (prod.purposes && prod.purposes.length) ? `영양 목적: ${prod.purposes.join(", ")}` : "",
    ].filter(Boolean).join("\n");
  }
  const s = p.survey || p;
  const parts = [
    task === "explain" ? "다음 어르신 상태에 대한 맞춤 식단 추천 근거를 설명해 주세요." : "다음 어르신 상태에 맞는 부드러운 케어식을 상담해 주세요.",
    `씹기(저작) 수준: ${s.chewing ?? "?"} (1 쉬움 ~ 4 거의 못 씹음)`,
    `삼킴(연하) 수준: ${s.swallowing ?? "?"} (1 문제없음 ~ 4 매우 어려움)`,
    (s.conditions && s.conditions.length) ? `질환: ${s.conditions.join(", ")}` : "질환: 없음/미선택",
    (s.allergies && s.allergies.length) ? `알레르기(반드시 제외): ${s.allergies.join(", ")}` : "알레르기: 없음",
    (s.goals && s.goals.length) ? `목표: ${s.goals.join(", ")}` : "",
  ];
  if (p.message) parts.push(`추가 질문: ${p.message}`);
  if (Array.isArray(p.candidates) && p.candidates.length) {
    parts.push("참고 후보 상품: " + p.candidates.map((c) => c.name || c).join(", "));
  }
  return parts.filter(Boolean).join("\n");
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (c) => {
      body += c;
      if (body.length > 1e6) { reject(new Error("payload too large")); req.destroy(); }
    });
    req.on("end", () => { try { resolve(JSON.parse(body || "{}")); } catch (e) { reject(e); } });
    req.on("error", reject);
  });
}

function loadDotEnv(path) {
  let raw;
  try { raw = readFileSync(path, "utf8"); } catch { return; }
  for (const line of raw.split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (!m) continue;
    let val = m[2];
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    if (!(m[1] in process.env)) process.env[m[1]] = val;
  }
}
