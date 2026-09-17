// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 CLSOFTLAB (씨엘소프트랩), Dr. Lee Il-guk (이일국)
//
// Project self-check: JSON validity, JS syntax, required HTML containers, recommender unit tests.
// Run: node check.mjs

import { readFileSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { recommend, scoreProduct, targetSoftness } from "./modules/recommend.js";
import { AI_ENDPOINT } from "./ai/config.js";

const ROOT = dirname(fileURLToPath(import.meta.url));
let pass = 0;
let fail = 0;
const fails = [];

function ok(cond, msg) {
  if (cond) { pass++; }
  else { fail++; fails.push(msg); console.error("  ✗ " + msg); }
}

// ---------- 1. JSON files parse ----------
console.log("\n[1] JSON 파싱 검사");
const dataDir = join(ROOT, "data");
const jsonFiles = readdirSync(dataDir).filter((f) => f.endsWith(".json"));
ok(jsonFiles.length >= 1, "data/ 폴더에 JSON 파일이 있어야 함");
const data = {};
for (const f of jsonFiles) {
  try {
    data[f] = JSON.parse(readFileSync(join(dataDir, f), "utf8"));
    console.log("  ✓ " + f + " 파싱 OK");
    pass++;
  } catch (e) {
    ok(false, `${f} JSON 파싱 실패: ${e.message}`);
  }
}

// ---------- 2. Product data sanity ----------
console.log("\n[2] 상품 데이터 검사");
const products = data["products.json"] || [];
ok(Array.isArray(products) && products.length >= 30, `상품 30개 이상 (현재 ${products.length})`);
const ids = new Set();
for (const p of products) {
  ok(!ids.has(p.id), `상품 id 중복: ${p.id}`);
  ids.add(p.id);
  ok(typeof p.name === "string" && p.name.length > 0, `상품 이름 필요: ${p.id}`);
  ok(p.softness >= 1 && p.softness <= 4, `연화 단계 1~4: ${p.id}`);
  ok(typeof p.price === "number" && p.price > 0, `가격 필요: ${p.id}`);
  ok(Array.isArray(p.purposes), `영양목적 배열 필요: ${p.id}`);
  ok(Array.isArray(p.reviews) && p.reviews.length >= 1, `리뷰 필요: ${p.id}`);
}
const plans = data["plans.json"] || [];
ok(Array.isArray(plans) && plans.length >= 2, `구독 플랜 2개 이상 (현재 ${plans.length})`);

// ---------- 3. node --check on every JS/MJS ----------
console.log("\n[3] JS 문법 검사 (node --check)");
function walk(dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === ".git") continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(full));
    else if (/\.(mjs|js)$/.test(e.name)) out.push(full);
  }
  return out;
}
for (const jsFile of walk(ROOT)) {
  try {
    execFileSync(process.execPath, ["--check", jsFile], { stdio: "pipe" });
    console.log("  ✓ " + jsFile.replace(ROOT, ".").replace(/\\/g, "/"));
    pass++;
  } catch (e) {
    ok(false, `문법 오류 ${jsFile}: ${e.stderr ? e.stderr.toString() : e.message}`);
  }
}

// ---------- 4. index.html required containers ----------
console.log("\n[4] index.html 필수 컨테이너 검사");
const html = readFileSync(join(ROOT, "index.html"), "utf8");
const required = ["id=\"view\"", "id=\"logo-slot\"", "id=\"search\"", "id=\"cart-badge\"", "id=\"wish-badge\"", "id=\"bigtext-btn\"", "id=\"reset-btn\"", "app.js"];
for (const r of required) ok(html.includes(r), `index.html 에 ${r} 필요`);
ok(html.includes("건강") || html.toLowerCase().includes("disclaimer") || html.includes("전문가"), "건강 안내(disclaimer) 문구 필요");

// ---------- 5. Recommender unit tests ----------
console.log("\n[5] 식단 추천 엔진 단위 테스트");

// targetSoftness maps difficulty -> softness
ok(targetSoftness(1, 1) === 1, "쉬운 씹기/삼킴 → 1단계");
ok(targetSoftness(4, 1) === 4, "심한 저작곤란 → 4단계");
ok(targetSoftness(2, 4) === 4, "삼킴 심각이 더 우선 → 4단계");
ok(targetSoftness(3, 2) === 3, "씹기 3 삼킴 2 → 3단계");

// allergen hard-filter blocks the product
const milkProd = products.find((p) => p.allergens.includes("우유"));
if (milkProd) {
  const r = scoreProduct(milkProd, { chewing: 3, swallowing: 3, allergies: ["우유"], conditions: [], goals: [] });
  ok(r.blocked === true, "알레르기(우유) 포함 상품은 차단되어야 함");
}
const recWithAllergy = recommend(products, { chewing: 2, swallowing: 2, allergies: ["우유"], conditions: [], goals: [] }, 50);
ok(recWithAllergy.every((x) => !x.product.allergens.includes("우유")), "추천 결과에 우유 알레르겐 없음");

// dysphagia (swallowing>=3) surfaces swallow-support items near the top
const dys = recommend(products, { chewing: 3, swallowing: 4, allergies: [], conditions: [], goals: [] }, 6);
ok(dys.length > 0, "삼킴 곤란 추천 결과 존재");
ok(dys[0].product.softness >= 3, "삼킴 곤란 최상위 추천은 3단계 이상");
ok(dys.slice(0, 3).some((x) => x.product.purposes.includes("삼킴보조")), "삼킴 곤란 상위 추천에 삼킴보조 포함");

// low-salt preference for hypertension: top results are lower sodium than the catalog average
const catalogAvgNa = products.reduce((a, p) => a + p.sodium, 0) / products.length;
const lowSalt = recommend(products, { chewing: 2, swallowing: 2, allergies: [], conditions: ["고혈압"], goals: [] }, 6);
const topNaAvg = lowSalt.reduce((a, x) => a + x.product.sodium, 0) / lowSalt.length;
ok(topNaAvg < catalogAvgNa, `고혈압 추천 평균 나트륨(${topNaAvg.toFixed(0)}) < 전체 평균(${catalogAvgNa.toFixed(0)})`);

// high-protein goal: top result is protein-rich
const hp = recommend(products, { chewing: 2, swallowing: 2, allergies: [], conditions: [], goals: ["고단백"] }, 6);
ok(hp[0].product.protein >= 12, "고단백 목표 최상위 추천 단백질 >= 12g");

// scoring is deterministic
const s1 = scoreProduct(products[0], { chewing: 2, swallowing: 2, allergies: [], conditions: [], goals: [] }).score;
const s2 = scoreProduct(products[0], { chewing: 2, swallowing: 2, allergies: [], conditions: [], goals: [] }).score;
ok(s1 === s2, "동일 입력은 동일 점수(결정론적)");

// reasons are attached
ok(hp[0].reasons.length >= 1, "추천 결과에 이유(reasons) 포함");

// ---------- 6. AI layer checks ----------
console.log("\n[6] AI 계층 검사");

// 6a. node --check on ai/ and server/ (explicitly, in addition to the full walk above).
for (const dir of ["ai", "server"]) {
  const full = join(ROOT, dir);
  let files = [];
  try { files = walk(full); } catch { /* dir may not exist */ }
  ok(files.length >= 1, `${dir}/ 폴더에 JS/MJS 파일이 있어야 함`);
  for (const jsFile of files) {
    try {
      execFileSync(process.execPath, ["--check", jsFile], { stdio: "pipe" });
      console.log("  ✓ node --check " + jsFile.replace(ROOT, ".").replace(/\\/g, "/"));
      pass++;
    } catch (e) {
      ok(false, `문법 오류 ${jsFile}: ${e.stderr ? e.stderr.toString() : e.message}`);
    }
  }
}

// 6b. AI_ENDPOINT must be empty (demo=mock; real endpoint is opt-in and never committed).
ok(AI_ENDPOINT === "", `ai/config.js 의 AI_ENDPOINT 는 비어("") 있어야 함 (현재: ${JSON.stringify(AI_ENDPOINT)})`);

// 6c. No real Anthropic API key committed anywhere.
const KEY_RE = new RegExp("sk-" + "ant-[A-Za-z0-9_-]{20,}");
function walkAll(dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === ".git" || e.name === "dist") continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) out.push(...walkAll(full));
    else if (/\.(mjs|js|json|md|html|css|txt|example)$/.test(e.name) || e.name === ".env.example") out.push(full);
  }
  return out;
}
let keyHits = 0;
for (const f of walkAll(ROOT)) {
  const rel = f.replace(ROOT, ".").replace(/\\/g, "/");
  if (rel.endsWith("/check.mjs")) continue; // this file legitimately holds the split pattern string
  if (KEY_RE.test(readFileSync(f, "utf8"))) { keyHits++; ok(false, `실제 API 키 형식이 발견됨: ${rel}`); }
}
ok(keyHits === 0, "저장소에 실제 Anthropic API 키 형식이 없어야 함");

// ---------- Summary ----------
console.log(`\n결과: ${pass} 통과, ${fail} 실패`);
if (fail > 0) {
  console.error("\n실패 항목:\n - " + fails.join("\n - "));
  process.exit(1);
}
console.log("모든 검사 통과 ✅");
