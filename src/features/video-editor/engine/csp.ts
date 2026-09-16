// ===================== Content Security Policy awareness =====================
// The editor plays local files through blob: URLs, paints thumbnails into data: URLs and compiles
// the ffmpeg.wasm core, so a page served with a bare "default-src 'self'" breaks it in ways that
// look like broken files. Watching for policy violations lets us say what is actually wrong.

export interface CspBlock { directive: string; blockedURI: string }

const blocks: CspBlock[] = [];
const listeners = new Set<(b: CspBlock) => void>();

function record(e: SecurityPolicyViolationEvent) {
  const b = { directive: e.effectiveDirective || e.violatedDirective, blockedURI: e.blockedURI };
  blocks.push(b);
  for (const cb of listeners) cb(b);
}

if (typeof document !== 'undefined') document.addEventListener('securitypolicyviolation', record);

// Chrome reports a blocked blob:/data: URL as the bare scheme ("blob"), not the full URL.
const LOCAL_SOURCE = /^(blob|data)\b/;
const EVAL_SOURCE = /^(wasm-)?eval$/;

/** A violation that stops the editor working: local media, thumbnails, the codec worker or WebAssembly. */
export function isLocalMediaBlock(b: CspBlock): boolean {
  return LOCAL_SOURCE.test(b.blockedURI) || EVAL_SOURCE.test(b.blockedURI);
}

/** True once the page's policy has blocked a blob:/data: URL or WebAssembly – i.e. the editor cannot work. */
export function cspBlocksLocalMedia(): boolean {
  return blocks.some(isLocalMediaBlock);
}

/** Every violation seen so far, for diagnostics. */
export function cspViolations(): readonly CspBlock[] { return blocks; }

/** Notified on each violation; returns an unsubscribe function. */
export function onCspViolation(cb: (b: CspBlock) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
