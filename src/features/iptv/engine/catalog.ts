// ===================== Channel catalogue: playlist + iptv-org metadata =====================
// The playlist (index.m3u) says what can be played; the iptv-org API says what each channel *is*
// (country, categories, languages, whether it is adult material). The two are joined on tvg-id.
//
// Every API file is optional. The project reorganises them from time to time – languages used to
// live on the channel and now live on the feed – so each is read defensively and the viewer still
// works from the playlist alone when the API is unreachable or has moved on.
import { cleanName, parseM3u, readQuality, type M3uEntry } from './m3u';
import { idbGet, idbSet } from './idb';

export interface CatalogSources {
  playlist: string;
  /** Base of the iptv-org API; '' turns the metadata off and leaves the playlist's own grouping. */
  api: string;
}

export const DEFAULT_SOURCES: CatalogSources = {
  playlist: 'https://iptv-org.github.io/iptv/index.m3u',
  api: 'https://iptv-org.github.io/api',
};

export interface Channel {
  /** Unique within the catalogue: several feeds of one channel share a tvg-id. */
  key: string;
  tvgId: string;
  name: string;
  /** Name without the "(1080p)" / "[Not 24/7]" decorations. */
  sortName: string;
  url: string;
  logo: string;
  group: string;
  quality?: string;
  referrer?: string;
  userAgent?: string;
  country?: string;
  countryName?: string;
  flag?: string;
  categories: string[];
  categoryNames: string[];
  languages: string[];
  languageNames: string[];
  nsfw: boolean;
  /** Lower-case haystack for the search box. */
  search: string;
}

export interface Catalog {
  channels: Channel[];
  /** Where the metadata came from, and what was missing – shown in the viewer's status line. */
  report: {
    entries: number;
    skipped: number;
    withMetadata: number;
    api: Record<string, 'ok' | 'failed'>;
    fetchedAt: number;
    fromCache: boolean;
  };
}

export type LoadStage = 'playlist' | 'metadata' | 'building' | 'done';
export interface LoadProgress { stage: LoadStage; loaded?: number; total?: number }

const CACHE_KEY = 'catalog.v1';
const CACHE_TTL = 12 * 60 * 60 * 1000;

interface ApiChannel {
  id: string; name?: string; country?: string; categories?: string[]; languages?: string[];
  is_nsfw?: boolean; logo?: string; closed?: string | null; replaced_by?: string | null;
}
interface ApiFeed { channel?: string; id?: string; is_main?: boolean; languages?: string[]; video_format?: string }
interface ApiNamed { code?: string; id?: string; name?: string; flag?: string; languages?: string[] }

/** Downloads a text resource, reporting bytes when the server declares a length. */
async function fetchText(url: string, signal?: AbortSignal, onProgress?: (loaded: number, total: number) => void): Promise<string> {
  const res = await fetch(url, { signal, cache: 'no-cache' });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  const total = Number(res.headers.get('content-length') || 0);
  if (!res.body || !total || !onProgress) return res.text();
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    onProgress(loaded, total);
  }
  return new TextDecoder().decode(await new Blob(chunks as BlobPart[]).arrayBuffer());
}

async function fetchJson<T>(url: string, signal?: AbortSignal): Promise<T[]> {
  const res = await fetch(url, { signal, cache: 'no-cache' });
  if (!res.ok) throw new Error(`${res.status}`);
  const data = await res.json();
  return Array.isArray(data) ? data as T[] : [];
}

const byId = <T extends { id?: string; code?: string }>(rows: T[]) => {
  const map = new Map<string, T>();
  for (const row of rows) { const key = row.id ?? row.code; if (key) map.set(key, row); }
  return map;
};

/** Builds the catalogue from a playlist plus whatever metadata the API could provide. */
function build(entries: M3uEntry[], meta: {
  channels: Map<string, ApiChannel>;
  feeds: ApiFeed[];
  languages: Map<string, ApiNamed>;
  countries: Map<string, ApiNamed>;
  categories: Map<string, ApiNamed>;
}): Channel[] {
  // languages per channel: the feed knows them in the current schema, the channel did in the old one
  const feedLanguages = new Map<string, string[]>();
  for (const feed of meta.feeds) {
    const channel = feed.channel;
    if (!channel || !feed.languages?.length) continue;
    if (feed.is_main || !feedLanguages.has(channel)) feedLanguages.set(channel, feed.languages);
  }
  const seen = new Set<string>();
  return entries.map((e) => {
    const api = e.tvgId ? meta.channels.get(e.tvgId) : undefined;
    const country = api?.country || (e.tvgId.includes('.') ? e.tvgId.split('.').pop()!.toUpperCase() : undefined);
    const countryRow = country ? meta.countries.get(country) : undefined;
    const languages = feedLanguages.get(e.tvgId) || api?.languages || countryRow?.languages || [];
    const categories = api?.categories || [];
    const name = e.name || e.tvgId || e.url;
    let key = e.tvgId ? `${e.tvgId}|${e.url}` : e.url;
    while (seen.has(key)) key += '*';           // the same URL can appear twice in the playlist
    seen.add(key);
    const categoryNames = categories.map((c) => meta.categories.get(c)?.name || c);
    const languageNames = languages.map((l) => meta.languages.get(l)?.name || l);
    return {
      key,
      tvgId: e.tvgId,
      name,
      sortName: cleanName(name),
      url: e.url,
      logo: e.logo || api?.logo || '',
      group: e.group || categoryNames[0] || '',
      quality: readQuality(name),
      referrer: e.referrer,
      userAgent: e.userAgent,
      country,
      countryName: countryRow?.name,
      flag: countryRow?.flag,
      categories,
      categoryNames,
      languages,
      languageNames,
      nsfw: !!api?.is_nsfw,
      search: [name, e.tvgId, e.group, countryRow?.name, ...categoryNames, ...languageNames].filter(Boolean).join(' ').toLowerCase(),
    };
  });
}

/**
 * Loads the catalogue: from IndexedDB when a recent copy is there, otherwise from the network.
 * The playlist is required; every metadata file may fail without failing the load.
 */
export async function loadCatalog({ sources = DEFAULT_SOURCES, refresh = false, signal, onProgress }: {
  sources?: CatalogSources; refresh?: boolean; signal?: AbortSignal; onProgress?: (p: LoadProgress) => void;
} = {}): Promise<Catalog> {
  if (!refresh) {
    const cached = await idbGet<Catalog & { sources?: CatalogSources }>(CACHE_KEY).catch(() => null);
    if (cached?.channels?.length && Date.now() - cached.report.fetchedAt < CACHE_TTL
      && cached.sources?.playlist === sources.playlist && cached.sources?.api === sources.api) {
      onProgress?.({ stage: 'done' });
      return { channels: cached.channels, report: { ...cached.report, fromCache: true } };
    }
  }

  onProgress?.({ stage: 'playlist' });
  const text = await fetchText(sources.playlist, signal, (loaded, total) => onProgress?.({ stage: 'playlist', loaded, total }));
  const playlist = parseM3u(text);

  onProgress?.({ stage: 'metadata' });
  const api: Record<string, 'ok' | 'failed'> = {};
  const get = async <T>(file: string): Promise<T[]> => {
    if (!sources.api) { api[file] = 'failed'; return []; }
    try { const rows = await fetchJson<T>(`${sources.api}/${file}.json`, signal); api[file] = 'ok'; return rows; }
    catch { api[file] = 'failed'; return []; }
  };
  const [channels, feeds, languages, countries, categories] = await Promise.all([
    get<ApiChannel>('channels'), get<ApiFeed>('feeds'), get<ApiNamed>('languages'), get<ApiNamed>('countries'), get<ApiNamed>('categories'),
  ]);

  onProgress?.({ stage: 'building' });
  const list = build(playlist.entries, {
    channels: byId(channels as (ApiChannel & { id?: string })[]) as Map<string, ApiChannel>,
    feeds,
    languages: byId(languages),
    countries: byId(countries),
    categories: byId(categories),
  });
  const catalog: Catalog = {
    channels: list,
    report: {
      entries: playlist.entries.length,
      skipped: playlist.skipped,
      withMetadata: list.filter((c) => c.categories.length || c.countryName).length,
      api,
      fetchedAt: Date.now(),
      fromCache: false,
    },
  };
  void idbSet(CACHE_KEY, { ...catalog, sources }).catch(() => {});
  onProgress?.({ stage: 'done' });
  return catalog;
}

export interface Facet { value: string; label: string; count: number }

/** The distinct values behind each filter, with how many channels carry them, most common first. */
export function facets(channels: Channel[]) {
  const tally = (pick: (c: Channel) => [string, string][]) => {
    const map = new Map<string, Facet>();
    for (const c of channels) {
      for (const [value, label] of pick(c)) {
        if (!value) continue;
        const row = map.get(value) ?? { value, label, count: 0 };
        row.count++;
        map.set(value, row);
      }
    }
    return [...map.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  };
  return {
    groups: tally((c) => (c.group ? [[c.group, c.group]] : [])),
    categories: tally((c) => c.categories.map((id, i) => [id, c.categoryNames[i] || id] as [string, string])),
    countries: tally((c) => (c.country ? [[c.country, `${c.flag ? c.flag + ' ' : ''}${c.countryName || c.country}`]] : [])),
    languages: tally((c) => c.languages.map((id, i) => [id, c.languageNames[i] || id] as [string, string])),
  };
}
