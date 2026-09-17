// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 CLSOFTLAB (씨엘소프트랩), Dr. Lee Il-guk (이일국)
//
// Inline-SVG art. No binary images anywhere in the project.

const CATEGORY_HUE = {
  "죽/밥류": 28,
  "반찬": 140,
  "국/찌개": 200,
  "간식/디저트": 330,
  "음료/보충식": 265,
};

// A bowl illustration whose fill "softness" (blur/roundness) hints at the level.
export function productArt(product) {
  const hue = CATEGORY_HUE[product.category] ?? 30;
  const soft = product.softness; // 1..4
  const wobble = 4 + soft * 3; // softer -> rounder blobby food
  const steam = soft >= 3
    ? `<path d="M92 40 q-8 -12 0 -24" stroke="hsl(${hue} 30% 70%)" stroke-width="3" fill="none" stroke-linecap="round" opacity="0.6"/>
       <path d="M108 40 q8 -12 0 -24" stroke="hsl(${hue} 30% 70%)" stroke-width="3" fill="none" stroke-linecap="round" opacity="0.6"/>`
    : "";
  return `<svg viewBox="0 0 200 140" role="img" aria-label="${escapeAttr(product.name)} 일러스트" xmlns="http://www.w3.org/2000/svg">
    <defs><clipPath id="clip-${product.id}"><path d="M40 74 q60 ${18 + wobble} 120 0 v6 a60 30 0 0 1 -120 0 z"/></clipPath></defs>
    ${steam}
    <path d="M34 72 q66 26 132 0" fill="none" stroke="hsl(${hue} 40% 55%)" stroke-width="4" stroke-linecap="round"/>
    <path d="M40 74 q60 46 120 0 v6 a60 30 0 0 1 -120 0 z" fill="hsl(${hue} 45% 88%)" stroke="hsl(${hue} 40% 55%)" stroke-width="3"/>
    <g clip-path="url(#clip-${product.id})">
      <ellipse cx="100" cy="80" rx="55" ry="${8 + soft * 4}" fill="hsl(${hue} 55% 72%)"/>
      <ellipse cx="80" cy="78" rx="${6 + soft * 2}" ry="${5 + soft}" fill="hsl(${hue} 60% 62%)"/>
      <ellipse cx="120" cy="82" rx="${6 + soft * 2}" ry="${5 + soft}" fill="hsl(${hue} 60% 66%)"/>
    </g>
    <text x="100" y="128" text-anchor="middle" font-size="11" fill="hsl(${hue} 25% 45%)">${escapeAttr(product.category)}</text>
  </svg>`;
}

// Four dots showing which softness level a product is (filled = its level).
export function softnessMeter(level) {
  const dots = [1, 2, 3, 4]
    .map((n) => {
      const on = n <= level;
      const r = 4 + n; // bigger dot = softer stage
      return `<circle cx="${18 + (n - 1) * 30}" cy="20" r="${r}" fill="${on ? "var(--accent)" : "var(--dot-off)"}" ${on ? "" : 'opacity="0.4"'}/>`;
    })
    .join("");
  return `<svg viewBox="0 0 140 40" class="soft-meter" role="img" aria-label="연화 ${level}단계" xmlns="http://www.w3.org/2000/svg">${dots}</svg>`;
}

export function logo() {
  return `<svg viewBox="0 0 40 40" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
    <path d="M6 24 q14 12 28 0 v3 a14 7 0 0 1 -28 0 z" fill="var(--accent)"/>
    <path d="M4 23 q16 10 32 0" fill="none" stroke="var(--accent-strong)" stroke-width="2.5" stroke-linecap="round"/>
    <path d="M16 12 q4 -6 8 0" fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linecap="round"/>
    <path d="M20 10 q4 -5 0 -8" fill="none" stroke="var(--accent-strong)" stroke-width="2" stroke-linecap="round" opacity="0.7"/>
  </svg>`;
}

export function starRating(rating) {
  const full = Math.round(rating);
  const stars = [1, 2, 3, 4, 5]
    .map((n) => `<span aria-hidden="true" style="color:${n <= full ? "var(--star)" : "var(--dot-off)"}">★</span>`)
    .join("");
  return `<span class="stars" title="${rating}점">${stars}</span>`;
}

function escapeAttr(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
