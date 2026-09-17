// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 CLSOFTLAB (씨엘소프트랩), Dr. Lee Il-guk (이일국)
//
// Cloudflare Workers variant of the Soft Care Food AI proxy (무인 = free hosting, no server
// to babysit). Deploy once with Wrangler and the app calls Claude with no box to maintain.
//
//   POST /api/ai   body: { task, payload }   -> streams Claude's text (plain text) back
//
// Calls the Anthropic REST API directly. The API key is the Worker secret ANTHROPIC_API_KEY
// (set via `wrangler secret put ANTHROPIC_API_KEY`) and stays server-side ONLY — never in the
// browser or the repo. Same task routing + model / prompt-caching / Haiku rules as index.mjs.
//
// Deploy (free tier):
//   cd server
//   npx wrangler secret put ANTHROPIC_API_KEY     # paste your key (stored encrypted)
//   npx wrangler deploy
// Then set ai/config.js -> AI_ENDPOINT = "https://<your-worker>.workers.dev/api/ai".

const MODEL_DEFAULT = "claude-haiku-4-5"; // cost-first; raise to claude-sonnet-5 / claude-opus-5
const MAX_TOKENS_BY_TASK = { chat: 700, explain: 700, cooking: 800 };

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

export default {
  async fetch(request, env) {
    const cors = {
      "Access-Control-Allow-Origin": env.CORS_ORIGIN || "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

    const url = new URL(request.url);
    if (request.method !== "POST" || url.pathname !== "/api/ai") {
      return new Response("Not found. Use POST /api/ai", { status: 404, headers: cors });
    }
    if (!env.ANTHROPIC_API_KEY) {
      // Never breaks: tell the browser to fall back to the offline mock.
      return json({ fallback: true, reason: "no_key" }, 502, cors);
    }

    let body;
    try { body = await request.json(); } catch { body = {}; }
    const task = body.task;
    const payload = body.payload || {};
    const model = env.AI_MODEL || MODEL_DEFAULT;
    const isHaiku = model.startsWith("claude-haiku");
    const system = SYSTEMS[task] || SYSTEMS.chat;
    const maxTokens = MAX_TOKENS_BY_TASK[task] || 700;

    const reqBody = {
      model,
      max_tokens: maxTokens,
      // Prompt caching on the stable per-task system prompt.
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: buildUserPrompt(task, payload) }],
      stream: true,
    };
    // Haiku 4.5 does NOT accept adaptive thinking / effort (would 400).
    if (!isHaiku) {
      reqBody.thinking = { type: "adaptive" };
      reqBody.output_config = { effort: env.AI_EFFORT || "low" };
    }

    let upstream;
    try {
      upstream = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": env.ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify(reqBody),
      });
    } catch {
      return json({ fallback: true, reason: "upstream_error" }, 502, cors);
    }

    if (!upstream.ok || !upstream.body) {
      return json({ fallback: true, reason: "upstream_error" }, upstream.status === 429 ? 429 : 502, cors);
    }

    // Relay the Anthropic SSE stream as PLAIN TEXT deltas (compatible with ai/ai.js reader).
    const textStream = upstream.body
      .pipeThrough(new TextDecoderStream())
      .pipeThrough(sseToTextTransform());

    return new Response(textStream, {
      status: 200,
      headers: { ...cors, "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-cache" },
    });
  },
};

// Parse Anthropic SSE lines and emit only the assistant text deltas as plain text.
function sseToTextTransform() {
  const encoder = new TextEncoder();
  let buf = "";
  return new TransformStream({
    transform(chunk, controller) {
      buf += chunk;
      const lines = buf.split("\n");
      buf = lines.pop() || ""; // keep the trailing partial line
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const data = trimmed.slice(5).trim();
        if (!data || data === "[DONE]") continue;
        try {
          const evt = JSON.parse(data);
          if (evt.type === "content_block_delta" && evt.delta && typeof evt.delta.text === "string") {
            controller.enqueue(encoder.encode(evt.delta.text));
          }
        } catch { /* ignore keep-alive / non-JSON lines */ }
      }
    },
  });
}

function json(obj, status, cors) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...cors, "Content-Type": "application/json; charset=utf-8" },
  });
}

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
