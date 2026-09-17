// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 CLSOFTLAB (씨엘소프트랩), Dr. Lee Il-guk (이일국)
//
// App entry: loads data, wires a hash router and renders all views. No build step (native ES modules).

import * as store from "./modules/store.js";
import { recommend, targetSoftness } from "./modules/recommend.js";
import { productArt, softnessMeter, logo, starRating } from "./modules/svg.js";
import { askAI } from "./ai/ai.js";
import { AI_ENDPOINT } from "./ai/config.js";

const state = { products: [], plans: [], survey: null, meta: null };

const el = (id) => document.getElementById(id);
const won = (n) => n.toLocaleString("ko-KR") + "원";
const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

async function loadJSON(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json();
}

async function boot() {
  el("logo-slot").innerHTML = logo();
  try {
    const [products, plans, survey, meta] = await Promise.all([
      loadJSON("data/products.json"),
      loadJSON("data/plans.json"),
      loadJSON("data/survey.json"),
      loadJSON("data/meta.json"),
    ]);
    state.products = products;
    state.plans = plans;
    state.survey = survey;
    state.meta = meta;
  } catch (err) {
    el("view").innerHTML = `<p class="error">데이터를 불러오지 못했습니다: ${esc(err.message)}<br>
      로컬 서버(예: <code>python -m http.server</code>)로 실행해 주세요.</p>`;
    return;
  }

  applyBigText();
  store.subscribe(() => {
    updateBadges();
  });
  window.addEventListener("hashchange", route);
  wireHeader();
  updateBadges();
  route();
}

function wireHeader() {
  el("search").addEventListener("input", () => {
    if (location.hash.startsWith("#/product") || !location.hash || location.hash === "#/") {
      if (!location.hash || location.hash === "#/") renderCatalog();
      else location.hash = "#/";
    } else {
      location.hash = "#/";
    }
  });
  el("bigtext-btn").addEventListener("click", () => {
    store.toggleBigText();
    applyBigText();
  });
  el("reset-btn").addEventListener("click", () => {
    if (confirm("데모 데이터(장바구니·찜·설문·구독)를 모두 초기화할까요?")) {
      store.resetDemo();
      el("search").value = "";
      applyBigText();
      location.hash = "#/";
      route();
    }
  });
}

function applyBigText() {
  const on = store.getState().bigText;
  document.documentElement.classList.toggle("big-text", on);
  el("bigtext-btn").setAttribute("aria-pressed", String(on));
}

function updateBadges() {
  el("cart-badge").textContent = store.cartCount();
  el("wish-badge").textContent = store.getState().wishlist.length;
}

// ---------------- Router ----------------
function route() {
  const hash = location.hash || "#/";
  const [path, arg] = hash.replace(/^#\//, "").split("/");
  window.scrollTo(0, 0);
  if (path === "product" && arg) return renderProduct(arg);
  if (path === "cart") return renderCart();
  if (path === "plans") return renderPlans();
  if (path === "survey") return renderSurvey();
  if (path === "ai") return renderAi();
  if (path === "wishlist") return renderWishlist();
  return renderCatalog();
}

// ---------------- Catalog ----------------
const filters = { softness: "", purpose: "", category: "", sort: "recommend" };

function renderCatalog() {
  const q = el("search").value.trim().toLowerCase();
  let list = state.products.slice();

  if (q) list = list.filter((p) => (p.name + " " + p.ingredients.join(" ") + " " + p.tags.join(" ")).toLowerCase().includes(q));
  if (filters.softness) list = list.filter((p) => String(p.softness) === filters.softness);
  if (filters.purpose) list = list.filter((p) => p.purposes.includes(filters.purpose));
  if (filters.category) list = list.filter((p) => p.category === filters.category);

  list.sort((a, b) => {
    if (filters.sort === "price-asc") return a.price - b.price;
    if (filters.sort === "price-desc") return b.price - a.price;
    if (filters.sort === "protein") return b.protein - a.protein;
    if (filters.sort === "sodium") return a.sodium - b.sodium;
    if (filters.sort === "rating") return b.rating - a.rating;
    return b.rating - a.rating; // recommend default
  });

  const softOpts = [1, 2, 3, 4]
    .map((n) => `<option value="${n}" ${filters.softness == n ? "selected" : ""}>${state.meta.softnessMeta[n].label}</option>`)
    .join("");
  const purpOpts = state.meta.purposes
    .map((p) => `<option value="${p}" ${filters.purpose === p ? "selected" : ""}>${p}</option>`)
    .join("");
  const catOpts = state.meta.categories
    .map((c) => `<option value="${c}" ${filters.category === c ? "selected" : ""}>${c}</option>`)
    .join("");

  el("view").innerHTML = `
    <section class="hero">
      <div>
        <h1>씹기·삼킴이 힘들어도, 매 끼니 편안하게</h1>
        <p>어르신과 간병인을 위한 연화식(부드러운 케어식) 온라인 스토어 &amp; 정기구독</p>
        <div class="hero-cta">
          <a class="btn primary" href="#/survey">맞춤 식단 설문 시작</a>
          <a class="btn" href="#/plans">정기구독 살펴보기</a>
        </div>
      </div>
    </section>
    <div class="disclaimer" role="note">
      ⚠️ <strong>건강 안내:</strong> 본 서비스는 의료·영양 처방이 아닙니다. 특히 삼킴장애(연하곤란)가 있는 경우
      식단 변경 전 반드시 의사·언어재활사·영양사 등 전문가와 상담하세요.
    </div>
    <div class="toolbar">
      <label>부드러움<select id="f-soft"><option value="">전체 단계</option>${softOpts}</select></label>
      <label>영양목적<select id="f-purp"><option value="">전체</option>${purpOpts}</select></label>
      <label>식사종류<select id="f-cat"><option value="">전체</option>${catOpts}</select></label>
      <label>정렬<select id="f-sort">
        <option value="recommend" ${filters.sort === "recommend" ? "selected" : ""}>추천순(평점)</option>
        <option value="price-asc" ${filters.sort === "price-asc" ? "selected" : ""}>가격 낮은순</option>
        <option value="price-desc" ${filters.sort === "price-desc" ? "selected" : ""}>가격 높은순</option>
        <option value="protein" ${filters.sort === "protein" ? "selected" : ""}>단백질 높은순</option>
        <option value="sodium" ${filters.sort === "sodium" ? "selected" : ""}>나트륨 낮은순</option>
        <option value="rating" ${filters.sort === "rating" ? "selected" : ""}>평점순</option>
      </select></label>
      <span class="count">${list.length}개 상품</span>
    </div>
    <div class="grid" id="grid">${list.map(card).join("") || '<p class="empty">조건에 맞는 상품이 없습니다.</p>'}</div>`;

  el("f-soft").addEventListener("change", (e) => { filters.softness = e.target.value; renderCatalog(); });
  el("f-purp").addEventListener("change", (e) => { filters.purpose = e.target.value; renderCatalog(); });
  el("f-cat").addEventListener("change", (e) => { filters.category = e.target.value; renderCatalog(); });
  el("f-sort").addEventListener("change", (e) => { filters.sort = e.target.value; renderCatalog(); });
  wireCards();
}

function card(p) {
  const wished = store.isWished(p.id);
  return `<article class="card">
    <a class="card-art" href="#/product/${p.id}" aria-label="${esc(p.name)} 상세보기">${productArt(p)}</a>
    <button class="wish ${wished ? "on" : ""}" data-wish="${p.id}" aria-label="찜 ${wished ? "취소" : "추가"}" aria-pressed="${wished}">♥</button>
    <div class="card-body">
      <div class="badges">${p.purposes.map((x) => `<span class="tag">${esc(x)}</span>`).join("")}</div>
      <h3><a href="#/product/${p.id}">${esc(p.name)}</a></h3>
      ${softnessMeter(p.softness)}
      <div class="meta-row">${starRating(p.rating)} <span class="muted">(${p.reviewCount})</span></div>
      <div class="nutri-mini"><span>${p.kcal}kcal</span><span>단백질 ${p.protein}g</span><span>나트륨 ${p.sodium}mg</span></div>
      <div class="card-foot">
        <strong class="price">${won(p.price)}</strong>
        <button class="btn small primary" data-add="${p.id}">담기</button>
      </div>
    </div>
  </article>`;
}

function wireCards() {
  el("view").querySelectorAll("[data-add]").forEach((b) =>
    b.addEventListener("click", () => { store.addToCart(b.dataset.add, 1); toast("장바구니에 담았습니다"); })
  );
  el("view").querySelectorAll("[data-wish]").forEach((b) =>
    b.addEventListener("click", () => { store.toggleWishlist(b.dataset.wish); route(); })
  );
}

// ---------------- Product detail ----------------
function renderProduct(id) {
  const p = state.products.find((x) => x.id === id);
  if (!p) { el("view").innerHTML = `<p class="empty">상품을 찾을 수 없습니다. <a href="#/">목록으로</a></p>`; return; }
  const wished = store.isWished(p.id);
  const sm = state.meta.softnessMeta[p.softness];
  el("view").innerHTML = `
    <a class="back" href="#/">← 목록으로</a>
    <div class="detail">
      <div class="detail-art">${productArt(p)}</div>
      <div class="detail-info">
        <div class="badges">${p.purposes.map((x) => `<span class="tag">${esc(x)}</span>`).join("")}</div>
        <h1>${esc(p.name)}</h1>
        <div class="meta-row">${starRating(p.rating)} <span class="muted">${p.rating} · 리뷰 ${p.reviewCount}</span></div>
        <p>${esc(p.description)}</p>
        <div class="soft-viz">
          <h3>연화 단계</h3>
          ${softnessMeter(p.softness)}
          <p><strong>${esc(sm.label)}</strong> — ${esc(sm.desc)}</p>
        </div>
        <strong class="price big">${won(p.price)} <span class="muted">/ ${p.servingWeight}g</span></strong>
        <div class="detail-actions">
          <button class="btn primary" data-add="${p.id}">장바구니 담기</button>
          <button class="btn ${wished ? "on" : ""}" data-wish="${p.id}">♥ 찜${wished ? " 취소" : ""}</button>
        </div>
      </div>
    </div>
    <div class="panels">
      <section class="panel"><h3>영양성분 (1회 제공량 ${p.servingWeight}g)</h3>
        <table class="nutri">
          <tr><th>열량</th><td>${p.kcal} kcal</td></tr>
          <tr><th>단백질</th><td>${p.protein} g</td></tr>
          <tr><th>나트륨</th><td>${p.sodium} mg</td></tr>
        </table></section>
      <section class="panel"><h3>원재료</h3><p>${p.ingredients.map(esc).join(", ")}</p>
        <p class="allergen">알레르기 유발: ${p.allergens.length ? p.allergens.map(esc).join(", ") : "해당 없음"}</p></section>
      <section class="panel"><h3>데우는 법</h3><p>${esc(p.heating)}</p>
        <button class="btn small primary" id="ai-cook-detail">🤖 AI 조리·데우기 안내</button>
        <pre id="ai-cook-detail-out" class="ai-out" hidden></pre></section>
    </div>
    <section class="panel reviews"><h3>리뷰 (${p.reviewCount})</h3>
      ${p.reviews.map((r) => `<div class="review"><div class="meta-row">${starRating(r.rating)} <strong>${esc(r.author)}</strong></div><p>${esc(r.text)}</p></div>`).join("")}
      <p class="muted small">※ 데모용 가상 리뷰입니다.</p>
    </section>`;
  wireCards();
  const cookBtn = el("ai-cook-detail");
  if (cookBtn) cookBtn.addEventListener("click", (e) =>
    runAI("cooking", { product: p, products: state.products }, el("ai-cook-detail-out"), e.currentTarget));
}

// ---------------- Cart + simulated checkout ----------------
function renderCart() {
  const s = store.getState();
  const items = Object.entries(s.cart).map(([id, qty]) => ({ p: state.products.find((x) => x.id === id), qty })).filter((x) => x.p);
  const total = items.reduce((a, x) => a + x.p.price * x.qty, 0);
  const shipping = total === 0 || total >= 40000 ? 0 : 3500;

  if (items.length === 0) {
    el("view").innerHTML = `<h1>장바구니</h1><p class="empty">장바구니가 비어 있습니다. <a href="#/">상품 보러가기</a></p>`;
    return;
  }
  el("view").innerHTML = `
    <h1>장바구니</h1>
    <div class="cart-list">
      ${items.map(({ p, qty }) => `<div class="cart-row">
        <div class="cart-art">${productArt(p)}</div>
        <div class="cart-main"><a href="#/product/${p.id}">${esc(p.name)}</a><div class="muted small">${won(p.price)}</div></div>
        <div class="qty">
          <button data-dec="${p.id}" aria-label="수량 감소">−</button>
          <span>${qty}</span>
          <button data-inc="${p.id}" aria-label="수량 증가">+</button>
        </div>
        <strong>${won(p.price * qty)}</strong>
        <button class="link-btn" data-del="${p.id}" aria-label="삭제">✕</button>
      </div>`).join("")}
    </div>
    <div class="summary">
      <div><span>상품금액</span><span>${won(total)}</span></div>
      <div><span>배송비</span><span>${shipping === 0 ? "무료" : won(shipping)}</span></div>
      <div class="total"><span>결제 예정</span><span>${won(total + shipping)}</span></div>
      <button class="btn primary block" id="checkout">모의 결제하기</button>
      <p class="muted small">※ 실제 결제가 아닙니다(데모). 4만원 이상 무료배송.</p>
    </div>`;

  el("view").querySelectorAll("[data-inc]").forEach((b) => b.addEventListener("click", () => { store.addToCart(b.dataset.inc, 1); renderCart(); }));
  el("view").querySelectorAll("[data-dec]").forEach((b) => b.addEventListener("click", () => { store.addToCart(b.dataset.dec, -1); renderCart(); }));
  el("view").querySelectorAll("[data-del]").forEach((b) => b.addEventListener("click", () => { store.removeFromCart(b.dataset.del); renderCart(); }));
  el("checkout").addEventListener("click", () => {
    store.placeOrder({ id: "ord-" + Date.now(), items: items.map((x) => ({ id: x.p.id, name: x.p.name, qty: x.qty })), total: total + shipping, date: new Date().toISOString() });
    el("view").innerHTML = `<div class="thanks"><h1>주문이 완료되었습니다 🎉</h1>
      <p>결제 예정 금액 <strong>${won(total + shipping)}</strong> (모의 결제)</p>
      <p class="muted">실제 결제·배송은 이루어지지 않는 데모입니다.</p>
      <a class="btn primary" href="#/">계속 쇼핑하기</a></div>`;
    updateBadges();
  });
}

// ---------------- Subscription plans ----------------
function renderPlans() {
  const sub = store.getState().subscription;
  el("view").innerHTML = `
    <h1>정기구독 플랜</h1>
    <p class="muted">주기적으로 부드러운 케어식을 받아보세요. 언제든 변경·해지 가능(데모).</p>
    ${sub ? `<div class="active-sub">현재 구독 중: <strong>${esc(sub.name)}</strong> (${sub.cycle === "weekly" ? "주간" : "월간"})
      <button class="btn small" id="cancel-sub">구독 해지</button></div>` : ""}
    <div class="grid plans">
      ${state.plans.map((pl) => `<article class="plan-card">
        <span class="cycle">${pl.cycle === "weekly" ? "주간" : "월간"} · ${pl.meals}끼</span>
        <h3>${esc(pl.name)}</h3>
        <p>${esc(pl.description)}</p>
        <div class="soft-target">권장 단계: ${pl.targetSoftness.map((n) => `<span class="tag">${n}단계</span>`).join("")}</div>
        <details><summary>구성 미리보기</summary><ul>${pl.sample.map((s) => `<li>${esc(s)}</li>`).join("")}</ul></details>
        <strong class="price">${won(pl.price)} <span class="muted">/ ${pl.cycle === "weekly" ? "주" : "월"}</span></strong>
        <button class="btn primary block" data-sub="${pl.id}">${sub && sub.id === pl.id ? "구독 중" : "구독 시작"}</button>
      </article>`).join("")}
    </div>`;
  el("view").querySelectorAll("[data-sub]").forEach((b) => b.addEventListener("click", () => {
    const pl = state.plans.find((x) => x.id === b.dataset.sub);
    store.setSubscription({ id: pl.id, name: pl.name, cycle: pl.cycle });
    toast("구독을 시작했습니다(데모)");
    renderPlans();
  }));
  const c = el("cancel-sub");
  if (c) c.addEventListener("click", () => { store.cancelSubscription(); renderPlans(); });
}

// ---------------- Survey + recommendation ----------------
function renderSurvey() {
  const prev = store.getState().survey || {};
  const q = state.survey.questions;
  const scaleQ = (question) => `<fieldset><legend>${esc(question.label)}</legend>
    <div class="scale">${question.options.map((o) => `<label class="chip">
      <input type="radio" name="${question.id}" value="${o.value}" ${prev[question.id] == o.value ? "checked" : ""}>
      <span>${esc(o.label)}</span></label>`).join("")}</div></fieldset>`;
  const multiQ = (question) => `<fieldset><legend>${esc(question.label)}</legend>
    <div class="scale wrap">${question.options.map((o) => `<label class="chip">
      <input type="checkbox" name="${question.id}" value="${esc(o.value)}" ${(prev[question.id] || []).includes(o.value) ? "checked" : ""}>
      <span>${esc(o.label)}</span></label>`).join("")}</div></fieldset>`;

  el("view").innerHTML = `
    <h1>어르신 맞춤 식단 설문</h1>
    <div class="disclaimer" role="note">⚠️ 아래 추천은 참고용이며 의료·영양 처방이 아닙니다. 삼킴장애가 있다면 전문가 상담을 우선하세요.</div>
    <form id="survey-form" class="survey">
      ${q.map((question) => (question.type === "scale" ? scaleQ(question) : multiQ(question))).join("")}
      <button class="btn primary block" type="submit">추천 식단 보기</button>
    </form>
    <div id="survey-result"></div>`;

  el("survey-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const answers = {
      chewing: Number(fd.get("chewing") || 1),
      swallowing: Number(fd.get("swallowing") || 1),
      conditions: fd.getAll("conditions"),
      allergies: fd.getAll("allergies"),
      goals: fd.getAll("goals"),
    };
    store.saveSurvey(answers);
    showRecommendations(answers);
  });
  if (Object.keys(prev).length) showRecommendations(prev);
}

function showRecommendations(answers) {
  const results = recommend(state.products, answers, 6);
  const t = targetSoftness(answers.chewing, answers.swallowing);
  const box = el("survey-result");
  if (!box) return;
  box.innerHTML = `
    <div class="rec-summary">
      <h2>추천 결과</h2>
      <p>씹기 수준 ${answers.chewing} · 삼킴 수준 ${answers.swallowing} → 권장 연화 <strong>${t}단계 이상</strong>
      ${answers.allergies.length ? ` · 제외 알레르기: ${answers.allergies.map(esc).join(", ")}` : ""}</p>
      <button class="btn small primary" id="ai-explain-rec">🤖 AI 맞춤 설명 보기</button>
      <pre id="ai-explain-rec-out" class="ai-out" hidden></pre>
    </div>
    ${results.length === 0 ? '<p class="empty">조건에 맞는 상품이 없습니다. 알레르기 조건을 조정해 보세요.</p>' :
    `<div class="grid">${results.map(({ product, reasons }) => `<article class="card rec">
      <a class="card-art" href="#/product/${product.id}">${productArt(product)}</a>
      <div class="card-body">
        <h3><a href="#/product/${product.id}">${esc(product.name)}</a></h3>
        ${softnessMeter(product.softness)}
        <ul class="reasons">${reasons.slice(0, 3).map((r) => `<li>✓ ${esc(r)}</li>`).join("")}</ul>
        <div class="card-foot"><strong class="price">${won(product.price)}</strong>
          <button class="btn small primary" data-add="${product.id}">담기</button></div>
      </div></article>`).join("")}</div>`}`;
  box.querySelectorAll("[data-add]").forEach((b) => b.addEventListener("click", () => { store.addToCart(b.dataset.add, 1); toast("장바구니에 담았습니다"); }));
  const explainBtn = el("ai-explain-rec");
  if (explainBtn) explainBtn.addEventListener("click", (e) =>
    runAI("explain", { survey: answers, products: state.products }, el("ai-explain-rec-out"), e.currentTarget));
  box.scrollIntoView({ behavior: "smooth", block: "start" });
}

// ---------------- Wishlist ----------------
function renderWishlist() {
  const ids = store.getState().wishlist;
  const items = ids.map((id) => state.products.find((p) => p.id === id)).filter(Boolean);
  el("view").innerHTML = `<h1>찜 목록 (${items.length})</h1>
    ${items.length === 0 ? '<p class="empty">찜한 상품이 없습니다. <a href="#/">상품 보러가기</a></p>' :
    `<div class="grid">${items.map(card).join("")}</div>`}`;
  wireCards();
}

// ---------------- AI layer (mock by default; real via backend proxy) ----------------
const aiModeLabel = () => (AI_ENDPOINT ? "실시간 AI 연동" : "데모 모드(mock)");

// Stream an askAI() call into an output element, toggling a button's busy state.
async function runAI(task, payload, outputEl, btn) {
  if (!outputEl) return;
  const label = btn ? btn.textContent : "";
  if (btn) { btn.disabled = true; btn.textContent = "생성 중…"; }
  outputEl.hidden = false;
  outputEl.textContent = "";
  outputEl.classList.add("streaming");
  try {
    await askAI(task, payload, { onToken: (chunk) => { outputEl.textContent += chunk; } });
  } catch (err) {
    outputEl.textContent = "AI 응답을 가져오지 못했습니다: " + (err && err.message ? err.message : String(err));
  } finally {
    outputEl.classList.remove("streaming");
    if (btn) { btn.disabled = false; btn.textContent = label; }
  }
}

function aiSurveyFields() {
  const q = state.survey.questions;
  const prev = store.getState().survey || {};
  const field = (question) => {
    const type = question.type === "scale" ? "radio" : "checkbox";
    const checked = (o) => (question.type === "scale"
      ? (prev[question.id] == o.value ? "checked" : "")
      : ((prev[question.id] || []).includes(o.value) ? "checked" : ""));
    return `<fieldset><legend>${esc(question.label)}</legend>
      <div class="scale wrap">${question.options.map((o) => `<label class="chip">
        <input type="${type}" name="${question.id}" value="${esc(String(o.value))}" ${checked(o)}>
        <span>${esc(o.label)}</span></label>`).join("")}</div></fieldset>`;
  };
  return q.map(field).join("");
}

function renderAi() {
  const prodOpts = state.products.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join("");
  el("view").innerHTML = `
    <h1>AI 케어식 도우미 <span class="ai-badge">${esc(aiModeLabel())}</span></h1>
    <div class="disclaimer" role="note">⚠️ <strong>건강 안내:</strong> 아래 AI 안내는 의료·영양 처방이 아닌 참고용입니다.
      삼킴장애(연하곤란)가 있다면 반드시 의사·언어재활사·영양사 등 전문가와 먼저 상담하세요.</div>

    <section class="panel ai-feature">
      <h2>① AI 개호식 상담 챗봇</h2>
      <p class="muted small">어르신의 씹기·삼킴 수준과 질환·알레르기를 입력하면 맞춤 연화식과 식사 방법을 안내합니다.</p>
      <form id="ai-chat-form" class="survey">
        ${aiSurveyFields()}
        <label class="ai-msg">추가로 궁금한 점(선택)
          <textarea name="message" rows="2" placeholder="예: 죽이 자꾸 사레들려요. 더 걸쭉한 걸 원해요."></textarea></label>
        <button class="btn primary" type="submit">AI 상담 받기</button>
      </form>
      <pre id="ai-chat-out" class="ai-out" hidden></pre>
    </section>

    <section class="panel ai-feature">
      <h2>② 어르신 맞춤 식단 추천 설명</h2>
      <p class="muted small">저장된 설문 결과를 바탕으로, 왜 이런 식단이 어르신께 적합한지 AI가 풀어서 설명합니다.</p>
      <button class="btn primary" id="ai-explain-btn">AI 설명 생성</button>
      <a class="btn" href="#/survey">설문 먼저 하기</a>
      <pre id="ai-explain-out" class="ai-out" hidden></pre>
    </section>

    <section class="panel ai-feature">
      <h2>③ 조리 / 데우기 안내 생성</h2>
      <p class="muted small">상품을 선택하면 보관·데우기·삼킴 안전까지 단계별 안내를 생성합니다.</p>
      <label>상품 선택 <select id="ai-cook-select">${prodOpts}</select></label>
      <button class="btn primary" id="ai-cook-btn">안내 생성</button>
      <pre id="ai-cook-out" class="ai-out" hidden></pre>
    </section>`;

  // ① chatbot
  el("ai-chat-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const payload = {
      chewing: Number(fd.get("chewing") || 1),
      swallowing: Number(fd.get("swallowing") || 1),
      conditions: fd.getAll("conditions"),
      allergies: fd.getAll("allergies"),
      goals: fd.getAll("goals"),
      message: fd.get("message") || "",
      products: state.products,
    };
    runAI("chat", payload, el("ai-chat-out"), e.submitter);
  });

  // ② explanation
  el("ai-explain-btn").addEventListener("click", (e) => {
    const survey = store.getState().survey;
    const out = el("ai-explain-out");
    if (!survey) {
      out.hidden = false;
      out.textContent = "먼저 ‘맞춤설문’을 완료하면 저장된 결과로 설명을 생성할 수 있습니다.";
      return;
    }
    runAI("explain", { survey, products: state.products }, out, e.currentTarget);
  });

  // ③ cooking guidance
  el("ai-cook-btn").addEventListener("click", (e) => {
    const id = el("ai-cook-select").value;
    const product = state.products.find((p) => p.id === id);
    runAI("cooking", { product, products: state.products }, el("ai-cook-out"), e.currentTarget);
  });
}

// ---------------- Toast ----------------
let toastTimer;
function toast(msg) {
  let t = el("toast");
  if (!t) { t = document.createElement("div"); t.id = "toast"; document.body.appendChild(t); }
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 1800);
}

boot();
