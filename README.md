# 웰니스 개호식품 · Soft Care Food

An online store and subscription demo for **softened senior-care meals (연화식)** — meals prepared
for people who have trouble chewing or swallowing, and for the caregivers who feed them.

**한국어 문서: [README.ko.md](README.ko.md)**

**LIVE DEMO: https://clsoftlab-lang.github.io/soft-care-food/**

> ⚠️ **Health disclaimer.** This service is **not medical or nutritional advice**. It does not diagnose,
> treat, or manage any condition. Softness levels and recommendations are illustrative only. If a person
> has **dysphagia (swallowing difficulty)** or any medical condition, consult a physician, speech-language
> pathologist, or registered dietitian **before** changing their diet.

## What it is

A fully client-side commerce web app (no build step, native ES modules) that demonstrates how a
senior-care meal store could work:

- **Product catalog** — 33 fictional care meals with filters (softness level 1–4, nutrition purpose
  고단백/저염/삼킴보조, meal type), free-text search, and sorting (price, protein, sodium, rating).
- **Product detail** — softness-level visualization, nutrition facts, ingredients, allergens,
  reheating instructions, and reviews.
- **Subscription plans** — weekly/monthly plans with a sample menu preview; start/cancel (simulated).
- **Cart + simulated payment** — quantity edits, shipping threshold, mock checkout.
- **Senior meal survey** — chewing/swallowing level, conditions, allergies, and goals feed a
  recommendation engine that ranks meals with human-readable reasons.
- **Wishlist (찜)** and a **large-text (큰 글씨) accessibility toggle**.
- Responsive mobile-first layout, light/dark via `prefers-color-scheme`, Korean UI, inline-SVG art only.

## How the meal recommender works

`modules/recommend.js` is a **pure, deterministic** engine (no DOM/storage), unit-tested in `check.mjs`:

1. **Target softness** = `max(chewing, swallowing)` mapped to levels 1–4 (softer for higher difficulty).
2. **Allergen hard filter** — any meal containing a listed allergen is excluded outright.
3. **Softness scoring** — meals at least as soft as the target score high; exact matches score highest;
   firmer meals are penalized.
4. **Dysphagia** (swallowing ≥ 3) rewards meals tagged 삼킴보조 (swallow-support).
5. **Conditions** (고혈압/신장질환/당뇨) reward low-sodium meals; 근감소/회복기 and the 고단백 goal reward protein.
6. Results are sorted by score and returned with the reasons that produced them.

## Run locally

No dependencies, no build. Serve the folder over HTTP (ES modules need `http://`, not `file://`):

```bash
python -m http.server 9001
# then open http://localhost:9001
```

## Verify

```bash
node check.mjs   # JSON parses, node --check on JS, index.html containers, recommender unit tests
```

## Project structure

```
index.html            # app shell + required containers
styles.css            # mobile-first, light/dark
app.js                # hash router + views
modules/recommend.js  # pure recommendation engine (unit-tested)
modules/store.js      # localStorage state (try/catch + demo reset)
modules/svg.js        # inline-SVG art (bowls, softness meter, logo)
data/*.json           # products, plans, survey, meta
check.mjs             # self-check / unit tests
.github/workflows/ci.yml  # CI runs node check.mjs
```

## DEMO-MODE boundaries

**This is a demonstration only. In particular:**

- **All products, prices, nutrition figures, and reviews are fictional** and for illustration only.
- **Payment and subscription are simulated** — nothing is charged, ordered, or shipped.
- **State lives in your browser's `localStorage`, not a real database** — it is per-device, can be
  cleared any time, and the "데모 초기화" button resets it.
- **No accounts, no login, no personal data (PII) is collected or transmitted.**
- **Softness levels, nutrition targets, and recommendations are not medical/nutritional advice.**
- A real production build would add: a backend and real database, an authenticated real catalog and
  inventory, a real payment gateway, verified logistics, and nutrition/dysphagia content reviewed and
  signed off by licensed professionals.

## Contributors

- Dr. Lee Il-guk (이일국)
- LWJ
- LMJ
- Claude

## License

- **Code:** Apache-2.0 (see [LICENSE](LICENSE)).
- **Documentation:** CC BY 4.0.
- SPDX headers: `Apache-2.0`, `Copyright 2026 CLSOFTLAB (씨엘소프트랩), Dr. Lee Il-guk (이일국)`.

**Not an official Anthropic product.**

## 🎓 Idea origin

The seed idea for this project came from the **entrepreneurship class taught by Dr. Lee Il-guk (이일국) at Yongin University (용인대학교)**. The students in that class produced startup ideas of remarkable, standout creativity — this project is one of those exceptional ideas, finally brought to life as a working service. Built with deep admiration and gratitude for those students' imagination. *(No student personal information is included; only the idea itself was used, implemented clean-room.)*
