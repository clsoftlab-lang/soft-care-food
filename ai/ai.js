// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 CLSOFTLAB (씨엘소프트랩), Dr. Lee Il-guk (이일국)
//
// Pluggable AI layer for the Soft Care Food demo.
//
//   askAI(task, payload, { onToken }) -> Promise<string>
//
// DEMO mode (AI_ENDPOINT === ""): a deterministic, offline Korean MockProvider that
// reuses the app's own product catalog and the pure meal recommender in
// modules/recommend.js. No network, no API key, no cost — safe for GitHub Pages/CI.
//
// REAL mode (AI_ENDPOINT set): POSTs { task, payload } to the backend proxy and streams
// the text response. The Anthropic API key never leaves the server (see server/index.mjs).
//
// Every generated answer carries a NOT-medical/nutritional-advice disclaimer.

import { AI_ENDPOINT } from "./config.js";
import { recommend, targetSoftness } from "../modules/recommend.js";

const DISCLAIMER =
  "\n\n※ 안내: 본 답변은 의료·영양 처방이 아니며 참고용 예시입니다. " +
  "삼킴장애(연하곤란)나 질환이 있는 경우 식단 변경 전 반드시 의사·언어재활사·영양사 등 전문가와 상담하세요.";

const SOFT_LABEL = { 1: "1단계(쉽게 씹음)", 2: "2단계(잇몸으로 으깸)", 3: "3단계(혀로 으깸)", 4: "4단계(씹지 않아도 됨)" };
const won = (n) => Number(n).toLocaleString("ko-KR") + "원";

/**
 * Ask the AI layer. Returns the full text; if onToken is given, it is called with
 * incremental chunks as they arrive (real backend) or are simulated (mock).
 * @param {"chat"|"explain"|"cooking"} task
 * @param {object} payload task-specific input
 * @param {{onToken?: (chunk: string) => void}} [opts]
 * @returns {Promise<string>}
 */
export async function askAI(task, payload = {}, { onToken } = {}) {
  // REAL mode: try the backend first, but AUTO-FALL BACK to the offline mock on any
  // failure / 429 {fallback:true} / network error, so the app never breaks (무인).
  if (AI_ENDPOINT) {
    try {
      return await streamFromBackend(task, payload, onToken);
    } catch (err) {
      // Swallow and fall through to the deterministic mock below.
      if (typeof console !== "undefined" && console.warn) {
        console.warn("[soft-care-food] AI backend unavailable — falling back to offline mock:", err && err.message ? err.message : err);
      }
    }
  }
  const text = await mockRespond(task, payload);
  return streamSimulated(text, onToken);
}

// ---------------- Real backend (streaming) ----------------
async function streamFromBackend(task, payload, onToken) {
  const res = await fetch(AI_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ task, payload }),
  });
  // 429 (rate limit / monthly cap) and any non-OK status -> signal fallback to the mock.
  // (The proxy/worker return { fallback: true } JSON; we don't need to parse it — any
  //  non-OK response triggers the mock fallback in askAI.)
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`AI 백엔드 오류 ${res.status}${detail ? ": " + detail : ""}`);
  }
  if (!res.body || typeof res.body.getReader !== "function") {
    const text = await res.text();
    if (onToken) onToken(text);
    return text;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let full = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value, { stream: true });
    if (chunk) { full += chunk; if (onToken) onToken(chunk); }
  }
  return full;
}

// ---------------- Mock streaming simulation ----------------
function streamSimulated(text, onToken) {
  if (!onToken) return Promise.resolve(text);
  return new Promise((resolve) => {
    const tokens = text.match(/\S+\s*|\s+/g) || [text];
    let i = 0;
    const tick = () => {
      if (i >= tokens.length) return resolve(text);
      onToken(tokens[i++]);
      setTimeout(tick, 14);
    };
    tick();
  });
}

// ---------------- Product access (reuses the app catalog) ----------------
let _productCache = null;
async function getProducts(payload) {
  if (Array.isArray(payload.products) && payload.products.length) return payload.products;
  if (_productCache) return _productCache;
  const res = await fetch("data/products.json");
  if (!res.ok) throw new Error(`상품 데이터를 불러오지 못했습니다: ${res.status}`);
  _productCache = await res.json();
  return _productCache;
}

// ---------------- MockProvider (deterministic Korean) ----------------
async function mockRespond(task, payload) {
  const products = await getProducts(payload);
  if (task === "chat") return mockChat(payload, products);
  if (task === "explain") return mockExplain(payload, products);
  if (task === "cooking") return mockCooking(payload, products);
  return "지원하지 않는 요청입니다." + DISCLAIMER;
}

function surveyFrom(payload) {
  return {
    chewing: Number(payload.chewing || 1),
    swallowing: Number(payload.swallowing || 1),
    conditions: payload.conditions || [],
    allergies: payload.allergies || [],
    goals: payload.goals || [],
  };
}

// (1) AI 개호식 상담 챗봇
function mockChat(payload, products) {
  const survey = surveyFrom(payload);
  const t = targetSoftness(survey.chewing, survey.swallowing);
  const results = recommend(products, survey, 3);
  const msg = String(payload.message || "").trim();

  const lines = [];
  lines.push("안녕하세요. 어르신의 씹기·삼킴 상태를 바탕으로 부드러운 케어식(연화식)을 안내해 드리겠습니다.");
  if (msg) lines.push(`\n말씀하신 내용: “${msg}”`);
  lines.push(
    `\n입력하신 상태 — 씹기 ${survey.chewing}단계 · 삼킴 ${survey.swallowing}단계 → 권장 연화 ${SOFT_LABEL[t]} 이상을 추천합니다.`
  );
  if (survey.swallowing >= 3) {
    lines.push("삼킴이 자주 어려우신 편이라, 목넘김을 돕는 ‘삼킴보조’ 설계 식품과 걸쭉한 형태를 우선하시길 권합니다. 식사 시 상체를 세우고 한 번에 조금씩, 천천히 드시게 도와주세요.");
  }
  if (survey.conditions.includes("고혈압") || survey.conditions.includes("신장질환") || survey.conditions.includes("당뇨")) {
    lines.push("선택하신 질환을 고려해 나트륨이 낮은(저염) 상품을 우선했습니다.");
  }
  if (survey.conditions.includes("근감소") || survey.goals.includes("고단백")) {
    lines.push("회복·근력 유지를 위해 단백질이 넉넉한 상품에 가점을 두었습니다.");
  }
  if (survey.allergies.length) lines.push(`알레르기(${survey.allergies.join(", ")}) 성분이 든 상품은 결과에서 완전히 제외했습니다.`);

  if (results.length === 0) {
    lines.push("\n현재 조건(특히 알레르기 제외)에 맞는 상품을 찾지 못했습니다. 알레르기 조건을 조정해 다시 시도해 보세요.");
  } else {
    lines.push("\n추천 상품:");
    results.forEach(({ product, reasons }, i) => {
      lines.push(`${i + 1}. ${product.name} (${SOFT_LABEL[product.softness]}, ${won(product.price)}) — ${reasons.slice(0, 2).join(", ")}`);
    });
    lines.push("\n상단 검색창이나 상세 페이지에서 원재료·알레르기·데우는 법을 확인하신 뒤 담아 주세요.");
  }
  return lines.join("\n") + DISCLAIMER;
}

// (2) 어르신 맞춤 식단 추천 설명
function mockExplain(payload, products) {
  const survey = surveyFrom(payload.survey || payload);
  const t = targetSoftness(survey.chewing, survey.swallowing);
  const results = recommend(products, survey, Number(payload.limit || 3));

  const lines = [];
  lines.push("맞춤 식단 추천 근거를 설명해 드립니다.");
  lines.push(
    `씹기 ${survey.chewing}단계·삼킴 ${survey.swallowing}단계이시므로, 안전을 위해 최소 ${SOFT_LABEL[t]} 이상으로 부드러운 식품을 골랐습니다. ` +
    "권장 단계보다 부드러운 식품은 목넘김 여유를 주고, 단단한 식품은 사레·질식 위험을 높이므로 제외하거나 순위를 낮췄습니다."
  );
  if (results.length === 0) {
    lines.push("현재 조건에 맞는 상품이 없어 설명할 추천 결과가 없습니다. 알레르기 등 조건을 조정해 보세요.");
    return lines.join("\n") + DISCLAIMER;
  }
  lines.push("\n각 추천 상품을 고른 이유:");
  results.forEach(({ product, reasons }, i) => {
    const why = reasons.length ? reasons.join(", ") : "전반적으로 어르신 상태에 무난함";
    lines.push(`• ${product.name} — ${why}. (단백질 ${product.protein}g, 나트륨 ${product.sodium}mg, ${product.kcal}kcal)`);
  });
  lines.push("\n하루 총량과 수분 섭취, 삼킴 자세를 함께 살펴 주시고, 상태 변화가 있으면 전문가와 상의해 단계를 조정하세요.");
  return lines.join("\n") + DISCLAIMER;
}

// (3) 조리/데우기 안내 생성
function mockCooking(payload, products) {
  const product =
    payload.product ||
    products.find((p) => p.id === payload.productId) ||
    products[0];
  if (!product) return "대상 상품을 찾을 수 없습니다." + DISCLAIMER;

  const lines = [];
  lines.push(`‘${product.name}’ 조리·데우기 안내 (${SOFT_LABEL[product.softness]})`);
  lines.push("\n준비:");
  lines.push("1) 냉동/냉장 보관 상태를 확인하고, 겉포장을 제거합니다.");
  lines.push("2) 전자레인지 사용 시 용기가 전자레인지 사용 가능한지 확인하고 뚜껑을 살짝 열어 김이 빠지게 합니다.");
  lines.push("\n데우기:");
  lines.push(`• 제조사 권장: ${product.heating}`);
  lines.push("• 중간에 한 번 저어 열이 고르게 퍼지게 하고, 다시 데워 전체가 따뜻(약 65℃ 이상)해지도록 합니다.");
  if (product.softness >= 3 || (product.purposes || []).includes("삼킴보조")) {
    lines.push("• 삼킴이 어려우신 분께 드릴 때는 너무 묽어지지 않게 농도를 확인하고, 필요하면 시판 점도증진제로 걸쭉함을 맞춰 주세요.");
  } else {
    lines.push("• 너무 단단해지지 않도록 과도한 가열을 피하고, 큰 덩어리는 숟가락으로 잘게 으깨 드리세요.");
  }
  lines.push("\n드리기 전:");
  lines.push("• 반드시 보호자가 먼저 온도를 확인해 화상을 예방하세요(특히 전자레인지는 부분 과열이 생길 수 있습니다).");
  lines.push("• 상체를 세운 자세에서 한 스푼씩 천천히, 삼킨 것을 확인한 뒤 다음 스푼을 드립니다.");
  lines.push("• 남은 음식은 재가열해 재보관하지 말고 폐기하세요.");
  return lines.join("\n") + DISCLAIMER;
}
