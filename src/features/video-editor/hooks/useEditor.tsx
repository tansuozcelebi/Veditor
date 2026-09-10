import { createContext, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Store } from '../engine/state';
import { Player } from '../engine/player';
import { Exporter } from '../engine/exporter';
import { getLang, onLangChange, setLang, t, type Lang } from '../engine/i18n';

export interface EditorContextValue {
  store: Store;
  player: Player;
  exporter: Exporter;
  canvas: HTMLCanvasElement;
  host: HTMLElement;
  /** Non-project UI state that should survive an unmount (e.g. leaving the editor's route). */
  ui: { timelinePps: number | null; timelineScrollLeft: number };
}

/**
 * An editor session owns the project (store), the playback engine and the export pipeline.
 * It lives outside the React tree so that the project survives unmounting the editor
 * (switching to another menu page in the host app) and is still there when the user comes back.
 */
export type EditorSession = EditorContextValue;

export function createEditorSession(): EditorSession {
  const store = new Store();
  const canvas = document.createElement('canvas');
  canvas.width = store.project.width; canvas.height = store.project.height;
  const host = document.createElement('div');
  host.className = 've-media-host';
  host.setAttribute('aria-hidden', 'true');
  const player = new Player(store, canvas, host);
  const exporter = new Exporter(player, store);
  return { store, player, exporter, canvas, host, ui: { timelinePps: null, timelineScrollLeft: 0 } };
}

let defaultSession: EditorSession | null = null;
/** The session used by <VideoEditor> when no `session` prop is given; shared by every mount, so the project persists across route changes. */
export function getDefaultEditorSession(): EditorSession {
  if (!defaultSession) defaultSession = createEditorSession();
  return defaultSession;
}
/** Drop the shared default session (e.g. on host logout) so the next mount starts with an empty project. */
export function resetDefaultEditorSession() {
  if (defaultSession) { defaultSession.player.destroy(); for (const id of [...defaultSession.store.media.keys()]) defaultSession.store.removeMedia(id); }
  defaultSession = null;
}

const EditorContext = createContext<EditorContextValue | null>(null);

/**
 * Mounts an editor session into the React tree. The engine is (re)attached on mount and detached
 * on unmount, but the session itself (project, media, undo history, playhead) is kept, so React
 * StrictMode's double effects and real route remounts both resume where they left off.
 */
export function EditorProvider({ children, session, onReady }: { children: ReactNode; session?: EditorSession; onReady?: (ctx: EditorContextValue) => void }) {
  const [ctx] = useState<EditorContextValue>(() => session ?? getDefaultEditorSession());
  const readyRef = useRef(false);
  useEffect(() => {
    document.body.appendChild(ctx.host);
    ctx.player.attach();
    if (!readyRef.current) { readyRef.current = true; onReady?.(ctx); }
    return () => { ctx.player.destroy(); ctx.host.remove(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx]);
  return <EditorContext.Provider value={ctx}>{children}</EditorContext.Provider>;
}

export function useEditor(): EditorContextValue {
  const v = useContext(EditorContext);
  if (!v) throw new Error('useEditor must be used inside <EditorProvider>');
  return v;
}

/** Re-render when any of the given store events fire (defaults to the whole project state). */
export function useStoreEvents(events: string[] = ['change', 'selection', 'media', 'history']) {
  const { store } = useEditor();
  const key = events.join('|');
  const sub = useMemo(() => {
    let version = 0;
    const subscribe = (cb: () => void) => {
      const offs = key.split('|').map((ev) => store.on(ev, () => { version++; cb(); }));
      return () => offs.forEach((off) => off());
    };
    return { subscribe, get: () => version };
  }, [store, key]);
  return useSyncExternalStore(sub.subscribe, sub.get, sub.get);
}

/** Current playhead time, throttled to animation frames. */
export function usePlayerTime() {
  const { player } = useEditor();
  const [time, setTime] = useState(player.currentTime);
  const [playing, setPlaying] = useState(player.playing);
  useEffect(() => {
    let last = -1;
    const offT = player.on('time', (tm: number) => { if (Math.abs(tm - last) >= 0.001) { last = tm; setTime(tm); } });
    const offP = player.on('play', () => setPlaying(true));
    const offS = player.on('pause', () => setPlaying(false));
    const offE = player.on('ended', () => setPlaying(false));
    return () => { offT(); offP(); offS(); offE(); };
  }, [player]);
  return { time, playing };
}

/** Reactive translation function. */
export function useI18n() {
  const [lang, set] = useState<Lang>(getLang());
  useEffect(() => onLangChange(set), []);
  return { t, lang, setLang };
}
