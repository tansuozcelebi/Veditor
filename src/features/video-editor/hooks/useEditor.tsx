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
}

const EditorContext = createContext<EditorContextValue | null>(null);

/** Creates the engine once per mounted editor and exposes it to the component tree. */
export function EditorProvider({ children, onReady }: { children: ReactNode; onReady?: (ctx: EditorContextValue) => void }) {
  const [ctx] = useState<EditorContextValue>(() => {
    const store = new Store();
    const canvas = document.createElement('canvas');
    canvas.width = store.project.width; canvas.height = store.project.height;
    const host = document.createElement('div');
    host.className = 've-media-host';
    host.setAttribute('aria-hidden', 'true');
    const player = new Player(store, canvas, host);
    const exporter = new Exporter(player, store);
    return { store, player, exporter, canvas, host };
  });
  const readyRef = useRef(false);
  useEffect(() => {
    document.body.appendChild(ctx.host);
    if (!readyRef.current) { readyRef.current = true; onReady?.(ctx); }
    return () => { ctx.host.remove(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx]);
  // StrictMode runs this cleanup and then the effect again on the same ctx, so re-attach on every run.
  useEffect(() => { ctx.player.attach(); return () => ctx.player.destroy(); }, [ctx]);
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
