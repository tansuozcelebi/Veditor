// ===================== M3U / M3U8 playlist parsing =====================
// The iptv-org index is an extended M3U: an #EXTINF line carrying attributes and a display name,
// optionally followed by #EXTVLCOPT / #EXTGRP lines, then the stream URL. Everything here is
// defensive: the list is community-maintained and entries with missing or odd fields are normal.

export interface M3uEntry {
  /** tvg-id, the key that joins a stream to the iptv-org channel database ('' when absent). */
  tvgId: string;
  name: string;
  url: string;
  logo: string;
  /** group-title, the playlist's own grouping (usually a category name). */
  group: string;
  /** Some streams only play when these are sent; kept so the UI can say why playback fails. */
  referrer?: string;
  userAgent?: string;
  /** Attributes we do not model, kept verbatim. */
  attrs: Record<string, string>;
}

export interface M3uPlaylist {
  entries: M3uEntry[];
  /** x-tvg-url from the header, when the playlist points at an EPG. */
  epgUrl?: string;
  /** Lines that looked like an entry but had no URL – reported rather than silently dropped. */
  skipped: number;
}

/**
 * Splits an #EXTINF line into its attribute part and its display name at the first comma that is
 * not inside quotes – group-title="News, Sports" is common and must not split there.
 */
function splitExtinf(rest: string): { attrs: string; name: string } {
  let quoted = false;
  for (let i = 0; i < rest.length; i++) {
    const c = rest[i];
    if (c === '"') quoted = !quoted;
    else if (c === ',' && !quoted) return { attrs: rest.slice(0, i), name: rest.slice(i + 1).trim() };
  }
  return { attrs: rest, name: '' };
}

function parseAttrs(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of text.matchAll(/([A-Za-z0-9_-]+)="([^"]*)"/g)) out[m[1].toLowerCase()] = m[2];
  return out;
}

/** Parses an extended M3U playlist. Unknown directives are ignored, never fatal. */
export function parseM3u(text: string): M3uPlaylist {
  const entries: M3uEntry[] = [];
  let epgUrl: string | undefined;
  let skipped = 0;
  let pending: M3uEntry | null = null;

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('#EXTM3U')) {
      const url = parseAttrs(line)['x-tvg-url'];
      if (url) epgUrl = url.split(',')[0];
      continue;
    }
    if (line.startsWith('#EXTINF:')) {
      if (pending) skipped++; // an entry without a URL before the next one
      const rest = line.slice('#EXTINF:'.length).replace(/^-?[\d.]+\s*/, '');
      const { attrs, name } = splitExtinf(rest);
      const a = parseAttrs(attrs);
      pending = {
        tvgId: a['tvg-id'] || '',
        name: name || a['tvg-name'] || '',
        url: '',
        logo: a['tvg-logo'] || '',
        group: a['group-title'] || '',
        attrs: a,
      };
      continue;
    }
    if (line.startsWith('#EXTGRP:')) {
      if (pending && !pending.group) pending.group = line.slice('#EXTGRP:'.length).trim();
      continue;
    }
    if (line.startsWith('#EXTVLCOPT:')) {
      const opt = line.slice('#EXTVLCOPT:'.length);
      const eq = opt.indexOf('=');
      if (pending && eq > 0) {
        const key = opt.slice(0, eq).trim().toLowerCase();
        const value = opt.slice(eq + 1).trim();
        if (key === 'http-referrer') pending.referrer = value;
        else if (key === 'http-user-agent') pending.userAgent = value;
      }
      continue;
    }
    if (line.startsWith('#')) continue; // any other directive
    if (!pending) continue;             // a bare URL with no #EXTINF – not a channel we can label
    pending.url = line;
    if (!pending.name) pending.name = line.split('/').pop() || line;
    entries.push(pending);
    pending = null;
  }
  if (pending) skipped++;
  return { entries, epgUrl, skipped };
}

/** iptv-org writes the resolution into the name: "Channel One (1080p) [Not 24/7]". */
export function readQuality(name: string): string | undefined {
  const m = name.match(/\((\d{3,4}p)\)/i);
  return m ? m[1].toLowerCase() : undefined;
}

/**
 * The name without the "(1080p)" / "[Not 24/7]" decorations, for sorting and searching. Only
 * parentheses that hold a resolution are removed, so "Al Jazeera (Arabic)" keeps its qualifier.
 */
export function cleanName(name: string): string {
  const out = name
    .replace(/\[[^\]]*\]/g, ' ')                 // [Not 24/7], [Geo-blocked]
    .replace(/\([^()]*\d{3,4}p[^()]*\)/gi, ' ')   // (1080p), (720p, upscaled)
    .replace(/\s{2,}/g, ' ')
    .trim();
  return out || name;
}
