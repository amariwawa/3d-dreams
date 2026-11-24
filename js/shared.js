// Shared state between the Create page and the Wallpapers store.
const listeners = new Set();
export const portrait = {
  data: null,
  set(d) { this.data = d; listeners.forEach((f) => f(d)); },
  on(f) { listeners.add(f); },
};
