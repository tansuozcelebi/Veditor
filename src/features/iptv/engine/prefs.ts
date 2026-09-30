// ===================== Favourites, history and view settings =====================
// Small enough for localStorage, and personal: they stay in the browser rather than in the
// catalogue cache, so refreshing the channel list never loses them.

export type SortKey = 'name' | 'name-desc' | 'group' | 'country' | 'recent' | 'playlist';

export interface ViewSettings {
  sort: SortKey;
  hideNsfw: boolean;
  onlyFavorites: boolean;
  group: string;
  category: string;
  country: string;
  language: string;
  search: string;
}

export const DEFAULT_SETTINGS: ViewSettings = {
  sort: 'name', hideNsfw: true, onlyFavorites: false, group: '', category: '', country: '', language: '', search: '',
};

const KEYS = { favorites: 'veditor.iptv.favorites', recents: 'veditor.iptv.recents', settings: 'veditor.iptv.settings' };
const RECENTS_MAX = 60;

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

const listeners = new Set<() => void>();
function announce() { listeners.forEach((fn) => fn()); }

const favorites = new Set(readArray(KEYS.favorites));
let recents = readArray(KEYS.recents);
let settings: ViewSettings = read(KEYS.settings, DEFAULT_SETTINGS);
/** Bumped on every change so useSyncExternalStore sees a new snapshot. */
let version = 0;

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
