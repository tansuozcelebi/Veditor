// ===================== One channel probe, off the main thread =====================
// Asking whether a stream opens is exactly the request the player would make, so the answer is
// faithful: a browser refuses a cross-origin stream without CORS headers here for the same reason
// hls.js is refused later. Thousands of these run at once, so they run in workers – the fetches
// themselves are asynchronous either way, but reading and parsing the manifests is not, and that
// work has no business on the thread that is drawing the list.

/** What the pool sends in. */
export interface ProbeRequest { id: string; url: string; timeoutMs: number }
/** What comes back. `reason` matches the player's own error kinds, so both mark a channel alike. */
export interface ProbeResult {
  id: string;
  ok: boolean;
  reason?: 'errCors' | 'errNetwork' | 'errMedia';
  /** HTTP status when there was a response at all – absent when the request never got one. */
  status?: number;
  ms: number;
}

const HEAD_BYTES = 2048;    // enough to tell a playlist from a 404 page, and to read its first lines

/** Reads at most the first chunk of a body, then lets the rest go. */
async function readHead(res: Response): Promise<string> {
  if (!res.body) return (await res.text()).slice(0, HEAD_BYTES);
  const reader = res.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  try {
    while (size < HEAD_BYTES) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      parts.push(value);
      size += value.length;
    }
  } finally {
    void reader.cancel().catch(() => {});      // stop the download; we have seen enough
  }
  const joined = new Uint8Array(size);
  let at = 0;
  for (const p of parts) { joined.set(p.subarray(0, Math.min(p.length, size - at)), at); at += p.length; }
  return new TextDecoder().decode(joined);
}

/** The first variant of a master playlist, resolved against the playlist's own address. */
function firstVariant(manifest: string, base: string): string | null {
  const lines = manifest.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith('#EXT-X-STREAM-INF')) continue;
    for (let j = i + 1; j < lines.length; j++) {
      const line = lines[j].trim();
      if (!line || line.startsWith('#')) continue;
      try { return new URL(line, base).href; } catch { return null; }
    }
  }
  return null;
}

interface Attempt { ok: boolean; reason?: ProbeResult['reason']; status?: number; body: string; url: string }

async function attempt(url: string, timeoutMs: number): Promise<Attempt> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, cache: 'no-store', redirect: 'follow' });
    if (!res.ok) return { ok: false, reason: 'errNetwork', status: res.status, body: '', url: res.url || url };
    return { ok: true, status: res.status, body: await readHead(res), url: res.url || url };
  } catch {
    // A refused cross-origin request and a host that is not there are the same TypeError here; the
    // browser will not say which. Either way the channel does not open, which is what is being asked.
    return { ok: false, reason: controller.signal.aborted ? 'errNetwork' : 'errCors', body: '', url };
  } finally {
    clearTimeout(timer);
  }
}

async function probe({ id, url, timeoutMs }: ProbeRequest): Promise<ProbeResult> {
  const startedAt = performance.now();
  const done = (r: Omit<ProbeResult, 'id' | 'ms'>): ProbeResult => ({ id, ...r, ms: Math.round(performance.now() - startedAt) });

  const first = await attempt(url, timeoutMs);
  if (!first.ok) return done({ ok: false, reason: first.reason, status: first.status });

  const manifest = first.body.trimStart();
  if (!manifest.startsWith('#EXTM3U')) {
    // Not a playlist: a direct stream that answered, or a portal's HTML apology dressed as one.
    if (/^\s*<(!doctype|html)/i.test(first.body)) return done({ ok: false, reason: 'errMedia', status: first.status });
    return done({ ok: true, status: first.status });
  }
  // A master playlist only lists the variants; the host that actually serves them may well refuse.
  const variant = firstVariant(manifest, first.url);
  if (!variant) return done({ ok: true, status: first.status });
  const second = await attempt(variant, timeoutMs);
  return second.ok ? done({ ok: true, status: second.status }) : done({ ok: false, reason: second.reason, status: second.status });
}

self.onmessage = (e: MessageEvent<ProbeRequest>) => {
  probe(e.data).then(
    (result) => self.postMessage(result),
    () => self.postMessage({ id: e.data.id, ok: false, reason: 'errNetwork', ms: 0 } satisfies ProbeResult),
  );
};
