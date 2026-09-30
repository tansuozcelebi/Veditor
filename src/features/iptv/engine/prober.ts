// ===================== Scanning the whole list for channels that will not open =====================
// A pool of workers, each carrying one probe at a time. Ten at once is the default: enough to get
// through several thousand channels in a few minutes, few enough to be a reasonable guest on the
// hosts being asked. Results go straight into the preference store, so the list hides what failed
// exactly as it does when a channel fails during playback.
import { prefs } from './prefs';
import type { ProbeRequest, ProbeResult } from './probe.worker';
import type { Channel } from './catalog';

export const DEFAULT_THREADS = 10;
const MAX_THREADS = 16;
const DEFAULT_TIMEOUT = 8000;

export interface ScanProgress {
  /** How many have been answered. */
  done: number;
  total: number;
  /** Answered and playable / answered and not. */
  ok: number;
  failed: number;
  /** Workers that are actually running – smaller than `threads` while the queue drains. */
  running: number;
}

export interface ScanHandle {
  /** Resolves when the scan finishes or is stopped; `stopped` says which. */
  finished: Promise<ScanProgress & { stopped: boolean }>;
  stop: () => void;
}

function spawn(): Worker | null {
  try { return new Worker(new URL('./probe.worker.ts', import.meta.url), { type: 'module' }); }
  catch { return null; }
}

/** True when this browser can run the scan at all – workers are the whole mechanism. */
export function canScan(): boolean {
  return typeof Worker !== 'undefined';
}

/**
 * Probes every channel given, `threads` at a time, and records each verdict.
 *
 * A channel that answers is un-marked, so one that has come back on air returns to the list; one
 * that does not is marked with the same reason the player would have given it.
 */
export function startScan(channels: Channel[], {
  threads = DEFAULT_THREADS,
  timeoutMs = DEFAULT_TIMEOUT,
  onProgress,
}: { threads?: number; timeoutMs?: number; onProgress?: (p: ScanProgress) => void } = {}): ScanHandle {
  const queue = channels.slice();
  const total = queue.length;
  const count = Math.max(1, Math.min(threads, MAX_THREADS, total || 1));
  const progress: ScanProgress = { done: 0, total, ok: 0, failed: 0, running: 0 };
  let stopped = false;
  let settle!: (v: ScanProgress & { stopped: boolean }) => void;   // the executor below runs at once
  const finished = new Promise<ScanProgress & { stopped: boolean }>((r) => { settle = r; });

  const pending = new Map<string, Channel>();
  const workers: Worker[] = [];

  const shutDown = () => {
    for (const w of workers) w.terminate();
    workers.length = 0;
    progress.running = 0;
    onProgress?.({ ...progress });
    settle({ ...progress, stopped });
  };

  const feed = (worker: Worker) => {
    const channel = queue.shift();
    if (!channel) {
      progress.running--;
      if (progress.running === 0) shutDown();
      return;
    }
    pending.set(channel.key, channel);
    worker.postMessage({ id: channel.key, url: channel.url, timeoutMs } satisfies ProbeRequest);
  };

  const onMessage = (worker: Worker) => (e: MessageEvent<ProbeResult>) => {
    if (stopped) return;
    const { id, ok, reason } = e.data;
    if (pending.delete(id)) {
      // markPlayable / markFailed both no-op when nothing changes, so a long scan of a settled list
      // writes to storage – and re-renders the viewer – only for the channels that actually moved
      if (ok) { prefs.markPlayable(id); progress.ok++; } else { prefs.markFailed(id, reason || 'errNetwork'); progress.failed++; }
      progress.done++;
      onProgress?.({ ...progress });
    }
    feed(worker);
  };

  for (let i = 0; i < count; i++) {
    const worker = spawn();
    if (!worker) break;
    worker.onmessage = onMessage(worker);
    // a worker that dies takes its one channel with it; the rest of the scan carries on
    worker.onerror = () => { if (!stopped) { progress.done++; onProgress?.({ ...progress }); feed(worker); } };
    workers.push(worker);
  }

  if (!workers.length) {
    queueMicrotask(() => settle({ ...progress, stopped: true }));
    return { finished, stop: () => {} };
  }

  progress.running = workers.length;
  onProgress?.({ ...progress });
  for (const worker of workers) feed(worker);

  return {
    finished,
    stop: () => { if (stopped) return; stopped = true; queue.length = 0; shutDown(); },
  };
}
