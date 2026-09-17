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
const MODEL = process.env.AI_MODEL || "claude-opus-5";
const ALLOW_ORIGIN = process.env.CORS_ORIGIN || "*";

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
  console.error("[soft-care-food] ANTHROPIC_API_KEY is not set. Copy .env.example to .env and add your key.");
  process.exit(1);
}
const client = new Anthropic({ apiKey });

// Task-specific system prompts. Every task must label output as NOT medical/nutritional advice.
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

const server = http.createServer(async (req, res) => {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", ALLOW_ORIGIN);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

  if (req.method === "POST" && req.url === "/api/ai") {
    try {
      const { task, payload } = await readJson(req);
      const system = SYSTEMS[task] || SYSTEMS.chat;
      const messages = [{ role: "user", content: buildUserPrompt(task, payload) }];

      res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-cache" });

      const stream = client.messages.stream({
        model: MODEL,
        max_tokens: 2048,
        thinking: { type: "adaptive" },
        system,
        messages,
      });
      stream.on("text", (chunk) => res.write(chunk));
      await stream.finalMessage();
      res.end();
    } catch (err) {
      console.error("[soft-care-food] AI error:", err?.message || err);
      if (!res.headersSent) res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("AI 처리 중 오류가 발생했습니다.");
    }
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("Not found. Use POST /api/ai");
});

server.listen(PORT, () => {
  console.log(`[soft-care-food] AI proxy on http://localhost:${PORT}  (model: ${MODEL})`);
  console.log(`  Set AI_ENDPOINT="http://localhost:${PORT}/api/ai" in ai/config.js to enable real AI.`);
});

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
