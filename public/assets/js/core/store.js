import { api } from "./api.js";

// Session state shared by the header and pages: the public config and the
// signed-in user (null for guests). Pages subscribe to re-render on change.
const state = { config: null, user: null, ready: false };
const subscribers = new Set();

export const store = {
  get config() { return state.config; },
  get user() { return state.user; },
  get ready() { return state.ready; },
  subscribe(fn) { subscribers.add(fn); return () => subscribers.delete(fn); },
  setUser(user) { state.user = user; emit(); },
  patchUser(patch) { if (state.user) { state.user = { ...state.user, ...patch }; emit(); } },
  async refreshUser() {
    try { state.user = (await api.get("/api/me")).user; } catch { /* keep current */ }
    emit();
    return state.user;
  },
  async init() {
    const [config, me] = await Promise.all([api.get("/api/public/config"), api.get("/api/me").catch(() => ({ user: null }))]);
    state.config = config;
    state.user = me.user;
    state.ready = true;
    emit();
  }
};

function emit() {
  for (const fn of subscribers) { try { fn(state); } catch (err) { console.error(err); } }
}

// Studio selection survives navigation (e.g. picking a pose in the library).
const DRAFT_KEY = "pw-studio-draft";
export const draft = {
  read() {
    try { return JSON.parse(sessionStorage.getItem(DRAFT_KEY) || "{}"); } catch { return {}; }
  },
  write(value) {
    try { sessionStorage.setItem(DRAFT_KEY, JSON.stringify(value)); } catch { /* private mode */ }
  },
  patch(patch) {
    this.write({ ...this.read(), ...patch });
  }
};
