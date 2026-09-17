// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 CLSOFTLAB (씨엘소프트랩), Dr. Lee Il-guk (이일국)
//
// Client-side state. localStorage-backed with try/catch fallbacks (DEMO ONLY — not a real DB).

const KEY = "soft-care-food.v1";

const DEFAULT = {
  cart: {}, // productId -> qty
  wishlist: [], // productId[]
  survey: null, // last survey answers
  subscription: null, // chosen plan snapshot
  bigText: false, // 큰 글씨 옵션
  orders: [], // simulated order history
};

let state = load();
const listeners = new Set();

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return structuredCloneSafe(DEFAULT);
    const parsed = JSON.parse(raw);
    return { ...structuredCloneSafe(DEFAULT), ...parsed };
  } catch {
    return structuredCloneSafe(DEFAULT);
  }
}

function structuredCloneSafe(obj) {
  try {
    return structuredClone(obj);
  } catch {
    return JSON.parse(JSON.stringify(obj));
  }
}

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // Ignore quota/private-mode errors: the app still works in-memory this session.
  }
  listeners.forEach((fn) => {
    try { fn(state); } catch { /* listener errors must not break others */ }
  });
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getState() {
  return state;
}

// --- Cart ---
export function addToCart(id, qty = 1) {
  state.cart[id] = (state.cart[id] || 0) + qty;
  if (state.cart[id] <= 0) delete state.cart[id];
  persist();
}
export function setCartQty(id, qty) {
  if (qty <= 0) delete state.cart[id];
  else state.cart[id] = qty;
  persist();
}
export function removeFromCart(id) {
  delete state.cart[id];
  persist();
}
export function clearCart() {
  state.cart = {};
  persist();
}
export function cartCount() {
  return Object.values(state.cart).reduce((a, n) => a + n, 0);
}

// --- Wishlist (찜) ---
export function toggleWishlist(id) {
  const i = state.wishlist.indexOf(id);
  if (i >= 0) state.wishlist.splice(i, 1);
  else state.wishlist.push(id);
  persist();
}
export function isWished(id) {
  return state.wishlist.includes(id);
}

// --- Survey ---
export function saveSurvey(answers) {
  state.survey = answers;
  persist();
}

// --- Subscription (simulated) ---
export function setSubscription(plan) {
  state.subscription = plan;
  persist();
}
export function cancelSubscription() {
  state.subscription = null;
  persist();
}

// --- Big text accessibility ---
export function toggleBigText() {
  state.bigText = !state.bigText;
  persist();
  return state.bigText;
}

// --- Simulated checkout ---
export function placeOrder(order) {
  state.orders.unshift(order);
  state.cart = {};
  persist();
}

// --- Demo reset ---
export function resetDemo() {
  state = structuredCloneSafe(DEFAULT);
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
  persist();
}
