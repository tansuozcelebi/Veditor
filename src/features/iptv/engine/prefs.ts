// ===================== Favourites, history and view settings =====================
// Small enough for localStorage, and personal: they stay in the browser rather than in the
// catalogue cache, so refreshing the channel list never loses them.

export type SortKey = 'name' | 'name-desc' | 'group' | 'country' | 'recent' | 'playlist';

export interface ViewSettings {
  sort: SortKey;
  hideNsfw: boolean;
  onlyFavorites: boolean;
  /** Leaves out what this browser already failed to play, and what was hidden by hand. */
  hideUnplayable: boolean;
  group: string;
  category: string;
  country: string;
  language: string;
  search: string;
}

export const DEFAULT_SETTINGS: ViewSettings = {
  sort: 'name', hideNsfw: true, onlyFavorites: false, hideUnplayable: true,
  group: '', category: '', country: '', language: '', search: '',
};

/** Why a channel did not play – one of the player's error kinds. */
export interface Failure { reason: string; at: number }

const KEYS = {
  favorites: 'veditor.iptv.favorites',
  recents: 'veditor.iptv.recents',
  settings: 'veditor.iptv.settings',
  hidden: 'veditor.iptv.hidden',
  failed: 'veditor.iptv.failed',
};
const RECENTS_MAX = 60;
// A stream that is down today may well be back next week, so a remembered failure expires; the cap
// keeps a long session of clicking through thousands of channels from filling the storage quota.
const FAILED_TTL = 7 * 24 * 60 * 60 * 1000;
const FAILED_MAX = 500;

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...fallback, ...JSON.parse(raw) } as T : fallback;
  } catch { return fallback; }
}
function readArray(key: string): string[] {
  try { const raw = localStorage.getItem(key); const v = raw ? JSON.parse(raw) : []; return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []; }
  catch { return []; }
}
function write(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode or full */ }
}

function readFailures(): Map<string, Failure> {
  const out = new Map<string, Failure>();
  try {
    const raw = localStorage.getItem(KEYS.failed);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== 'object') return out;
    const now = Date.now();
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      const f = value as Partial<Failure> | null;
      if (!f || typeof f.at !== 'number' || now - f.at > FAILED_TTL) continue;
      out.set(key, { reason: typeof f.reason === 'string' ? f.reason : '', at: f.at });
    }
  } catch { /* unreadable – start clean */ }
  return out;
}

const listeners = new Set<() => void>();
function announce() { listeners.forEach((fn) => fn()); }

const favorites = new Set(readArray(KEYS.favorites));
const hidden = new Set(readArray(KEYS.hidden));
const failed = readFailures();
let recents = readArray(KEYS.recents);
let settings: ViewSettings = read(KEYS.settings, DEFAULT_SETTINGS);
/** Bumped on every change so useSyncExternalStore sees a new snapshot. */
let version = 0;

function writeFailures() {
  if (failed.size > FAILED_MAX) {
    const keep = [...failed.entries()].sort((a, b) => b[1].at - a[1].at).slice(0, FAILED_MAX);
    failed.clear();
    for (const [key, value] of keep) failed.set(key, value);
  }
  write(KEYS.failed, Object.fromEntries(failed));
}

export const prefs = {
  subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; },
  getVersion() { return version; },

  isFavorite(key: string) { return favorites.has(key); },
  favoriteKeys() { return favorites; },
  toggleFavorite(key: string) {
    if (favorites.has(key)) favorites.delete(key); else favorites.add(key);
    write(KEYS.favorites, [...favorites]);
    version++; announce();
  },

  recentKeys() { return recents; },
  markPlayed(key: string) {
    recents = [key, ...recents.filter((k) => k !== key)].slice(0, RECENTS_MAX);
    write(KEYS.recents, recents);
    version++; announce();
  },

  // ---------- channels that do not come through ----------
  /** Hidden by hand from the bar under the player. */
  isHidden(key: string) { return hidden.has(key); },
  toggleHidden(key: string) {
    if (hidden.has(key)) hidden.delete(key); else hidden.add(key);
    write(KEYS.hidden, [...hidden]);
    version++; announce();
  },
  /** What the player last ran into on this channel, or null if it never failed here. */
  failureOf(key: string): Failure | null { return failed.get(key) ?? null; },
  /** Recorded by the player: a refused, unreachable or undecodable stream. */
  markFailed(key: string, reason: string) {
    if (failed.get(key)?.reason === reason) return;      // already known – no write, no re-render
    failed.set(key, { reason, at: Date.now() });
    writeFailures();
    version++; announce();
  },
  /** Recorded by the player once a picture actually arrives, so a stream that came back reappears. */
  markPlayable(key: string) {
    if (!failed.delete(key)) return;
    writeFailures();
    version++; announce();
  },
  /** Either marked by hand or remembered as broken – what `hideUnplayable` leaves out. */
  unplayable(key: string) { return hidden.has(key) || failed.has(key); },
  unplayableCount() {
    let n = hidden.size;
    for (const key of failed.keys()) if (!hidden.has(key)) n++;
    return n;
  },
  clearUnplayable() {
    hidden.clear();
    failed.clear();
    write(KEYS.hidden, []);
    write(KEYS.failed, {});
    version++; announce();
  },

  settings() { return settings; },
  update(patch: Partial<ViewSettings>) {
    settings = { ...settings, ...patch };
    write(KEYS.settings, settings);
    version++; announce();
  },
  reset() {
    settings = { ...DEFAULT_SETTINGS };
    write(KEYS.settings, settings);
    version++; announce();
  },
};
