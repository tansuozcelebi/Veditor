import { useEffect, useRef, useState } from 'react';
import { Play, Star } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { Channel } from '../engine/catalog';
import { prefs } from '../engine/prefs';
import { useI18n } from '../engine/i18n';

const ROW = 56;
const OVERSCAN = 8;

/**
 * The playlist has well over ten thousand entries, so only the rows in view are in the DOM: the
 * scroller keeps its full height through a spacer and the visible window is positioned inside it.
 */
export function ChannelList({ channels, selectedKey, onSelect, favoriteVersion, resetKey }: {
  channels: Channel[];
  selectedKey: string | null;
  onSelect: (c: Channel) => void;
  /** Changes when a favourite is toggled, so the stars redraw. */
  favoriteVersion: number;
  /**
   * Changes when the filters, the sort order or the catalogue do – and only then. The array itself is
   * rebuilt on every preference write (playing a channel is one), which must not throw the scroll
   * position away.
   */
  resetKey: string;
}) {
  const { t } = useI18n();
  const boxRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(600);

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setHeight(el.clientHeight));
    ro.observe(el);
    setHeight(el.clientHeight);
    return () => ro.disconnect();
  }, []);

  // a new filter or sort order starts at the top again
  useEffect(() => { if (boxRef.current) boxRef.current.scrollTop = 0; setScrollTop(0); }, [resetKey]);

  // Stepping through channels from the bar under the player moves the selection without touching the
  // list, so bring it into view – but only when the selection itself changed, or scrolling away from
  // the playing channel would keep snapping back.
  useEffect(() => {
    const el = boxRef.current;
    if (!el || !selectedKey) return;
    const i = channels.findIndex((c) => c.key === selectedKey);
    if (i < 0) return;
    const view = el.clientHeight || ROW;
    const top = i * ROW;
    if (top >= el.scrollTop && top + ROW <= el.scrollTop + view) return;   // already in view
    el.scrollTop = Math.max(0, Math.round(top - (view - ROW) / 2));
    setScrollTop(el.scrollTop);
    // `channels` is deliberately not a dependency: see above
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedKey]);

  const first = Math.max(0, Math.floor(scrollTop / ROW) - OVERSCAN);
  const visible = channels.slice(first, first + Math.ceil(height / ROW) + OVERSCAN * 2);

  return (
    <div
      ref={boxRef}
      id="channelScroller"
      className="min-h-0 flex-1 overflow-auto"
      onScroll={(e) => setScrollTop((e.target as HTMLDivElement).scrollTop)}
    >
      {channels.length === 0 && <p className="text-muted-foreground p-6 text-center text-sm" id="channelEmpty">{t('list.empty')}</p>}
      <div style={{ height: channels.length * ROW, position: 'relative' }} id="channelList">
        {visible.map((c, i) => {
          const index = first + i;
          const favorite = prefs.isFavorite(c.key);
          const unplayable = prefs.unplayable(c.key);
          const meta = [c.group, c.countryName || c.country, c.languageNames[0], c.quality].filter(Boolean).join(' · ');
          return (
            <div
              key={c.key}
              data-key={c.key}
              data-index={index}
              data-unplayable={unplayable || undefined}
              className={cn('channel-row absolute right-0 left-0 flex items-center gap-2 border-b px-2 select-none',
                selectedKey === c.key ? 'bg-accent' : 'hover:bg-accent/50',
                // only visible while `hideUnplayable` is off – otherwise these rows are not here at all
                unplayable && selectedKey !== c.key && 'opacity-45')}
              style={{ top: index * ROW, height: ROW }}
              onClick={() => onSelect(c)}
              onDoubleClick={() => onSelect(c)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(c); } }}
              title={c.name}
            >
              <div className="bg-muted flex size-9 shrink-0 items-center justify-center overflow-hidden rounded">
                {c.logo
                  ? <img src={c.logo} alt="" loading="lazy" className="size-full object-contain" onError={(e) => { (e.target as HTMLImageElement).style.visibility = 'hidden'; }} />
                  : <Play className="text-muted-foreground size-4" />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-sm">{c.sortName}</span>
                  {c.flag && <span className="shrink-0 text-xs">{c.flag}</span>}
                  {c.nsfw && <Badge variant="destructive" className="shrink-0 px-1 py-0 text-[9px]">{t('nsfw.badge')}</Badge>}
                  {unplayable && <Badge variant="outline" className="channel-unplayable shrink-0 px-1 py-0 text-[9px]">{prefs.isHidden(c.key) ? t('hide.hidden') : t('hide.badge')}</Badge>}
                </div>
                {meta && <div className="text-muted-foreground truncate text-[11px]">{meta}</div>}
              </div>
              <button
                type="button"
                className="channel-fav text-muted-foreground hover:text-amber-400 shrink-0 p-1.5"
                title={t('list.favorite')}
                aria-pressed={favorite}
                onClick={(e) => { e.stopPropagation(); prefs.toggleFavorite(c.key); }}
              >
                <Star className={cn('size-4', favorite && 'fill-amber-400 text-amber-400')} />
              </button>
            </div>
          );
        })}
      </div>
      <span hidden data-favorite-version={favoriteVersion} />
    </div>
  );
}
