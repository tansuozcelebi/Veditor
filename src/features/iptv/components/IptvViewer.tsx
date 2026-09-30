import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Menu, RefreshCw, Tv, X } from 'lucide-react';
import { toast } from 'sonner';
import { Toaster } from '@/components/ui/sonner';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { ChannelBar } from './ChannelBar';
import { ChannelList } from './ChannelList';
import { FilterBar } from './FilterBar';
import { StreamPlayer, type ErrorKind } from './StreamPlayer';
import { DEFAULT_SOURCES, facets as buildFacets, loadCatalog, type Catalog, type CatalogSources, type Channel, type LoadProgress } from '../engine/catalog';
import { DEFAULT_SETTINGS, prefs, type ViewSettings } from '../engine/prefs';
import { useI18n } from '../engine/i18n';

export interface IptvViewerProps {
  /** Where the playlist and the metadata come from; defaults to iptv-org. */
  sources?: CatalogSources;
  /** Offered on a finished recording – the host decides what "open in the editor" means. */
  onRecorded?: (file: File) => void | Promise<void>;
  className?: string;
}

const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });

function sortChannels(list: Channel[], sort: ViewSettings['sort'], recents: string[]): Channel[] {
  if (sort === 'playlist') return list;
  const out = list.slice();
  const byName = (a: Channel, b: Channel) => collator.compare(a.sortName, b.sortName);
  if (sort === 'name') return out.sort(byName);
  if (sort === 'name-desc') return out.sort((a, b) => byName(b, a));
  if (sort === 'group') return out.sort((a, b) => collator.compare(a.group, b.group) || byName(a, b));
  if (sort === 'country') return out.sort((a, b) => collator.compare(a.countryName || a.country || '￿', b.countryName || b.country || '￿') || byName(a, b));
  // recently watched first, in the order they were watched, then everything else by name
  const rank = new Map(recents.map((key, i) => [key, i]));
  return out.sort((a, b) => (rank.get(a.key) ?? Infinity) - (rank.get(b.key) ?? Infinity) || byName(a, b));
}

/**
 * A viewer for the iptv-org playlist: browse and filter several thousand public streams, keep
 * favourites, watch one, share the screen, and record either.
 */
export function IptvViewer({ sources = DEFAULT_SOURCES, onRecorded, className }: IptvViewerProps) {
  const { t } = useI18n();
  const version = useSyncExternalStore(prefs.subscribe, prefs.getVersion, prefs.getVersion);
  const settings = prefs.settings();
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [progress, setProgress] = useState<LoadProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Channel | null>(null);
  const [search, setSearch] = useState(settings.search);
  // where the playing channel sat the last time it was in the list, so stepping on from a channel
  // the filters have since dropped carries on from there instead of jumping back to the top
  const anchorRef = useRef(0);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // On a phone the filter block is taller than the list it filters, so it starts folded away there
  // and the header's menu button opens it. On a wide screen there is room for both.
  const [wide, setWide] = useState(() => typeof matchMedia === 'function' ? matchMedia('(min-width: 901px)').matches : true);
  const [filtersOpen, setFiltersOpen] = useState(wide);
  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const mq = matchMedia('(min-width: 901px)');
    const apply = () => { setWide(mq.matches); setFiltersOpen(mq.matches); };
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);

  const load = useCallback((refresh: boolean) => {
    const controller = new AbortController();
    setError(null);
    setProgress({ stage: 'playlist' });
    loadCatalog({ sources, refresh, signal: controller.signal, onProgress: setProgress })
      .then((c) => { setCatalog(c); setProgress(null); })
      .catch((e: Error) => { if (e.name !== 'AbortError') { setError(e.message || String(e)); setProgress(null); } });
    return () => controller.abort();
  }, [sources]);

  useEffect(() => load(false), [load]);

  // typing filters a list of thousands – let it settle before re-running the pass
  const onSearch = useCallback((value: string) => {
    setSearch(value);
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => prefs.update({ search: value }), 150);
  }, []);

  const all = useMemo(() => catalog?.channels ?? [], [catalog]);
  const facets = useMemo(() => buildFacets(all), [all]);

  const shown = useMemo(() => {
    const terms = settings.search.toLowerCase().split(/\s+/).filter(Boolean);
    const favorites = prefs.favoriteKeys();
    const list = all.filter((c) => {
      if (settings.hideNsfw && c.nsfw) return false;
      // The channel on screen is exempt from the automatic hiding, and from that alone: a stream that
      // fails while it plays must not vanish underfoot and take the navigation's place with it, while
      // a filter the viewer set themselves still applies to everything.
      if (settings.hideUnplayable && c.key !== selected?.key && prefs.unplayable(c.key)) return false;
      if (settings.onlyFavorites && !favorites.has(c.key)) return false;
      if (settings.group && c.group !== settings.group) return false;
      if (settings.category && !c.categories.includes(settings.category)) return false;
      if (settings.country && c.country !== settings.country) return false;
      if (settings.language && !c.languages.includes(settings.language)) return false;
      return terms.every((term) => c.search.includes(term));
    });
    return sortChannels(list, settings.sort, prefs.recentKeys());
    // favourites, the recently-watched order and the hidden channels live in the preference store, so
    // `version` – which changes on every write there – is the dependency the linter cannot see
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [all, settings, version, selected?.key]);

  const play = useCallback((c: Channel) => { setSelected(c); prefs.markPlayed(c.key); }, []);

  // ---------- stepping through the list ----------
  const index = useMemo(() => (selected ? shown.findIndex((c) => c.key === selected.key) : -1), [shown, selected]);
  useEffect(() => { if (index >= 0) anchorRef.current = index; }, [index]);

  const step = useCallback((delta: number) => {
    if (!shown.length) return;
    const from = index >= 0 ? index : Math.min(anchorRef.current, shown.length - 1) - delta;
    const next = (from + delta + shown.length) % shown.length;   // wraps, so the ends are never dead
    play(shown[next]);
  }, [shown, index, play]);

  // the arrow keys do the same, unless something that takes typing has the focus
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      const el = document.activeElement as HTMLElement | null;
      // a text field, a select, or the volume slider – all of them mean something else by an arrow
      if (el && (/^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName) || el.isContentEditable || el.closest('[role="slider"]'))) return;
      e.preventDefault();
      step(e.key === 'ArrowLeft' ? -1 : 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [step]);

  // what the player learns about a stream is remembered, so the list can leave the dead ones out
  const onFailed = useCallback((c: Channel, reason: Exclude<ErrorKind, 'errPolicy'>) => prefs.markFailed(c.key, reason), []);
  const onPlaying = useCallback((c: Channel) => prefs.markPlayable(c.key), []);

  const sendToEditor = useMemo(() => (onRecorded ? async (file: File) => {
    await onRecorded(file);
    toast.success(t('rec.added'));
  } : undefined), [onRecorded, t]);

  // the list is rebuilt on every preference write, so the scroller is told apart what actually
  // reorders it (filters, sort, catalogue) from what merely re-runs the pass
  const listKey = [
    settings.sort, settings.group, settings.category, settings.country, settings.language, settings.search,
    settings.onlyFavorites, settings.hideNsfw, settings.hideUnplayable, all.length,
  ].join('|');

  // shown as a dot on the menu button, so a filter left on is never invisible
  const narrowed = !!settings.group || !!settings.category || !!settings.country || !!settings.language
    || settings.onlyFavorites || !settings.hideNsfw || settings.sort !== DEFAULT_SETTINGS.sort;
  const loading = progress !== null;
  const pct = progress?.total ? `%${Math.round((progress.loaded! / progress.total) * 100)}` : '';

  return (
    <div className={cn('veditor-iptv bg-background text-foreground dark flex h-full min-h-0 w-full min-w-0 overflow-hidden max-[900px]:flex-col', className)}>
      <aside className="bg-card flex w-[360px] min-w-0 shrink-0 flex-col border-r max-[900px]:order-2 max-[900px]:h-auto max-[900px]:min-h-0 max-[900px]:w-full max-[900px]:flex-1 max-[900px]:border-r-0" id="channelPanel">
        <div className="flex items-center gap-2 border-b px-3 py-2">
          <Tv className="size-4 shrink-0 text-red-500" />
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-sm font-semibold">{t('title')}</h1>
            <p className="text-muted-foreground truncate text-[11px]" id="catalogReport">
              {catalog
                ? t('load.report', {
                  n: catalog.report.entries,
                  meta: catalog.report.withMetadata,
                  when: catalog.report.fromCache ? t('load.cached') : new Date(catalog.report.fetchedAt).toLocaleTimeString(),
                })
                : t('subtitle')}
            </p>
          </div>
          <Button
            id="btnFilters" variant="ghost" size="icon-sm" title={t('filter.toggle')}
            aria-expanded={filtersOpen} aria-controls="filterBar"
            onClick={() => setFiltersOpen((v) => !v)}
          >
            {filtersOpen ? <X /> : <Menu />}
            {!filtersOpen && narrowed && <span className="absolute mt-4 ml-4 size-1.5 rounded-full bg-red-500" />}
          </Button>
          <Button id="btnRefresh" variant="ghost" size="icon-sm" title={t('load.refresh')} disabled={loading} onClick={() => load(true)}>
            <RefreshCw className={cn(loading && 'animate-spin')} />
          </Button>
        </div>

        <FilterBar
          settings={settings} facets={facets} search={search} open={filtersOpen} onSearch={onSearch}
          onChange={(patch) => prefs.update(patch)}
          onReset={() => { setSearch(''); prefs.reset(); }}
        />

        {loading && (
          <p className="text-muted-foreground p-6 text-center text-sm" id="catalogLoading">
            {progress.stage === 'playlist' ? t('load.playlist', { pct }) : progress.stage === 'metadata' ? t('load.metadata') : t('load.building')}
          </p>
        )}
        {error && (
          <div className="p-6 text-center text-sm" id="catalogError">
            <p className="mb-3 text-red-400">{t('load.error', { e: error })}</p>
            <Button size="sm" variant="secondary" onClick={() => load(true)}>{t('load.retry')}</Button>
          </div>
        )}
        {catalog && Object.values(catalog.report.api).every((v) => v === 'failed') && (
          <p className="border-b bg-amber-950/40 px-3 py-1.5 text-[11px] text-amber-300" id="catalogNoMeta">{t('load.noMetadata')}</p>
        )}

        {!loading && !error && (
          <>
            <div className="text-muted-foreground border-b px-3 py-1 text-[11px]" id="channelCount">{t('list.count', { n: shown.length })}</div>
            <ChannelList channels={shown} selectedKey={selected?.key ?? null} onSelect={play} favoriteVersion={version} resetKey={listKey} />
          </>
        )}
      </aside>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col max-[900px]:order-1 max-[900px]:flex-none max-[900px]:border-b" id="playerColumn">
        <StreamPlayer channel={selected} onSendToEditor={sendToEditor} onFailed={onFailed} onPlaying={onPlaying} />
        <ChannelBar
          channel={selected} index={index} total={shown.length} settings={settings} prefsVersion={version}
          onPrev={() => step(-1)} onNext={() => step(1)}
        />
      </div>
      <Toaster position="bottom-center" richColors />
    </div>
  );
}
