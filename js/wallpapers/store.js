// Cart, purchases and library. Persisted in localStorage.
// PAYMENTS ARE IN DEMO MODE: checkout() simulates a successful payment. To go live, replace
// `checkout()` with a call to your backend that creates a Stripe Checkout Session and redirects.
import { SCENES } from 'wp-scenes';

export const BUNDLE = { id: 'all-access', name: 'All-Access Pack', tagline: 'Every wallpaper, current and future, on every device.', price: 9.99 };

const K_CART = 'pfp3d.cart', K_OWNED = 'pfp3d.owned';
const load = (k) => { try { return JSON.parse(localStorage.getItem(k)) || []; } catch { return []; } };
const listeners = new Set();

export const store = {
  cart: load(K_CART),
  owned: new Set(load(K_OWNED)),

  product(id) { return id === BUNDLE.id ? BUNDLE : SCENES.find((s) => s.id === id); },
  isOwned(id) { return this.owned.has(BUNDLE.id) || this.owned.has(id); },
  inCart(id) { return this.cart.includes(id); },
  ownedScenes() { return SCENES.filter((s) => this.isOwned(s.id)); },

  add(id) {
    if (this.isOwned(id) || this.inCart(id)) return;
    if (id === BUNDLE.id) this.cart = [];
    else if (this.inCart(BUNDLE.id)) return;
    this.cart.push(id);
    this.save();
  },
  remove(id) { this.cart = this.cart.filter((x) => x !== id); this.save(); },
  total() { return this.cart.reduce((s, id) => s + (this.product(id)?.price || 0), 0); },

  /** Demo: pretend the payment succeeded. */
  async checkout(ids = this.cart) {
    await new Promise((r) => setTimeout(r, 900));
    ids.forEach((id) => this.owned.add(id));
    this.cart = this.cart.filter((id) => !ids.includes(id));
    this.save();
    return ids;
  },
  resetDemo() { this.cart = []; this.owned.clear(); this.save(); },

  save() {
    localStorage.setItem(K_CART, JSON.stringify(this.cart));
    localStorage.setItem(K_OWNED, JSON.stringify([...this.owned]));
    listeners.forEach((f) => f());
  },
  on(f) { listeners.add(f); },
};

export const money = (v) => '$' + v.toFixed(2);
