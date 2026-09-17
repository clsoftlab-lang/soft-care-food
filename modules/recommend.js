// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 CLSOFTLAB (씨엘소프트랩), Dr. Lee Il-guk (이일국)
//
// Pure meal-recommendation engine. No DOM, no storage — deterministic and unit-testable.

/**
 * Map a chewing/swallowing difficulty score (1..4) to a target softness level (1..4).
 * Higher difficulty -> softer food needed.
 * @param {number} chewing 1(easy)..4(cannot chew)
 * @param {number} swallowing 1(fine)..4(severe dysphagia)
 * @returns {number} target softness 1..4
 */
export function targetSoftness(chewing, swallowing) {
  const c = clamp(chewing, 1, 4);
  const s = clamp(swallowing, 1, 4);
  // Swallowing weighs slightly more because aspiration risk is serious.
  return clamp(Math.max(c, s), 1, 4);
}

function clamp(n, lo, hi) {
  n = Number.isFinite(n) ? n : lo;
  return Math.min(hi, Math.max(lo, n));
}

/**
 * Score a single product against a survey. Returns { score, reasons, blocked }.
 * A product is blocked (excluded) only when it contains an allergen the user listed.
 * @param {object} product
 * @param {object} survey { chewing, swallowing, conditions[], allergies[], goals[] }
 */
export function scoreProduct(product, survey) {
  const reasons = [];
  const allergies = survey.allergies || [];
  const conditions = survey.conditions || [];
  const goals = survey.goals || [];

  // Hard safety filter: allergens.
  const hit = (product.allergens || []).filter((a) => allergies.includes(a));
  if (hit.length > 0) {
    return { score: 0, reasons: [`알레르기 제외: ${hit.join(", ")}`], blocked: true };
  }

  let score = 0;
  const target = targetSoftness(survey.chewing, survey.swallowing);

  // 1) Softness match. Food at least as soft as the target is safe; exact match is best.
  if (product.softness >= target) {
    const closeness = 4 - (product.softness - target); // exact match -> 4
    score += 30 + closeness * 5;
    if (product.softness === target) reasons.push(`씹기/삼킴 수준에 맞는 ${labelSoft(product.softness)}`);
    else reasons.push(`더 부드러운 ${labelSoft(product.softness)} (안전 여유)`);
  } else {
    // Too firm for this user: heavy penalty but not excluded.
    score -= (target - product.softness) * 20;
    reasons.push(`권장보다 단단함(${labelSoft(product.softness)})`);
  }

  // 2) Dysphagia -> require swallow-support emphasis.
  if (clamp(survey.swallowing, 1, 4) >= 3) {
    if ((product.purposes || []).includes("삼킴보조")) {
      score += 25;
      reasons.push("삼킴보조 설계");
    } else {
      score -= 10;
    }
  }

  // 3) Conditions -> sodium sensitivity.
  const lowSaltNeeded = conditions.includes("고혈압") || conditions.includes("신장질환") || conditions.includes("당뇨");
  if (lowSaltNeeded) {
    if (product.sodium <= 150) {
      score += 18;
      reasons.push("저염(나트륨 낮음)");
    } else if (product.sodium <= 250) {
      score += 6;
    } else {
      score -= 8;
      reasons.push("나트륨 다소 높음");
    }
  }

  // 4) 근감소/회복기 or 고단백 goal -> protein reward.
  const wantsProtein = conditions.includes("근감소") || goals.includes("고단백");
  if (wantsProtein) {
    if (product.protein >= 15) {
      score += 18;
      reasons.push(`고단백 ${product.protein}g`);
    } else if (product.protein >= 10) {
      score += 8;
    }
  }

  // 5) Explicit goal matches (any purpose tag).
  for (const g of goals) {
    if ((product.purposes || []).includes(g)) score += 6;
  }

  // 6) Small tie-breaker: user rating.
  score += (product.rating || 0);

  return { score: Math.round(score), reasons, blocked: false };
}

function labelSoft(level) {
  return ({ 1: "1단계", 2: "2단계", 3: "3단계", 4: "4단계" })[level] || `${level}단계`;
}

/**
 * Rank products for a survey. Excludes allergen-blocked items, sorts by score desc.
 * @returns {Array<{product, score, reasons}>}
 */
export function recommend(products, survey, limit = 6) {
  const scored = products
    .map((p) => ({ product: p, ...scoreProduct(p, survey) }))
    .filter((r) => !r.blocked && r.score > 0)
    .sort((a, b) => b.score - a.score || b.product.rating - a.product.rating);
  return limit ? scored.slice(0, limit) : scored;
}
