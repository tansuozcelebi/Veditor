import { ChevronLeft, ChevronRight, Eye, EyeOff } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { useI18n } from '../engine/i18n';
import { prefs, type ViewSettings } from '../engine/prefs';
import type { Channel } from '../engine/catalog';

/**
 * The strip under the player: step through the filtered list, and deal with the channels that never
 * come through.
 *
 * Plenty of public streams are refused from a browser – geo-blocked, CORS-less or simply down – so
 * the player reports every failure to the preference store and this bar offers to leave those out of
 * the list, plus a hide button for one the viewer never wants to see again.
 */
export function ChannelBar({ channel, index, total, settings, prefsVersion, onPrev, onNext, className }: {
  channel: Channel | null;
  /** Position of the playing channel in the filtered list, or -1 when it is not in it. */
  index: number;
  total: number;
  settings: ViewSettings;
  /** Re-renders the bar when a hide or a failure is written – see ChannelList's favoriteVersion. */
  prefsVersion: number;
  onPrev: () => void;
  onNext: () => void;
  className?: string;
}) {
  const { t } = useI18n();
  const hidden = channel ? prefs.isHidden(channel.key) : false;
  const failure = channel ? prefs.failureOf(channel.key) : null;
  const marked = prefs.unplayableCount();

  return (
    <div
      className={cn('bg-card flex flex-wrap items-center gap-2 border-t px-3 py-2 max-[900px]:px-2', className)}
      id="channelBar"
      data-index={index}
      data-total={total}
      data-prefs-version={prefsVersion}
    >
      <Button id="btnPrevChannel" size="sm" variant="outline" disabled={total < 2} title={t('nav.prevHint')} onClick={onPrev}>
        <ChevronLeft /> <span className="max-[520px]:hidden">{t('nav.prev')}</span>
      </Button>
      <span className="text-muted-foreground min-w-14 text-center text-xs tabular-nums" id="channelPosition">
        {total ? t('nav.position', { i: index >= 0 ? index + 1 : '–', n: total }) : t('nav.none')}
      </span>
      <Button id="btnNextChannel" size="sm" variant="outline" disabled={total < 2} title={t('nav.nextHint')} onClick={onNext}>
        <span className="max-[520px]:hidden">{t('nav.next')}</span> <ChevronRight />
      </Button>

      {failure && <Badge variant="destructive" className="shrink-0 text-[10px]" id="channelFailBadge" title={t(`player.${failure.reason}`)}>{t('hide.badge')}</Badge>}
      {hidden && <Badge variant="secondary" className="shrink-0 text-[10px]" id="channelHiddenBadge">{t('hide.hidden')}</Badge>}

      {/* on a phone this wraps to a second line, so it starts at the left edge rather than adrift */}
      <div className="ml-auto flex flex-wrap items-center justify-end gap-x-3 gap-y-1 max-[640px]:ml-0 max-[640px]:justify-start">
        {channel && (
          <Button id="btnHideChannel" size="sm" variant={hidden ? 'secondary' : 'ghost'} title={hidden ? t('hide.unhide') : t('hide.channel')} onClick={() => prefs.toggleHidden(channel.key)}>
            {hidden ? <Eye /> : <EyeOff />} <span className="max-[640px]:hidden">{hidden ? t('hide.unhide') : t('hide.channel')}</span>
          </Button>
        )}
        {/* Nothing is marked on a fresh install, and a switch over an empty set is only clutter. On a
            phone there is no room for it beside the stepping controls either, so below 640px it is the
            filter drawer that carries it – the two are never on screen at once. */}
        {marked > 0 && (
          <div className="flex items-center gap-3 max-[640px]:hidden">
            <Label className="gap-1.5 text-xs" title={t('hide.hint')}>
              <Switch id="hideUnplayable" checked={settings.hideUnplayable} onCheckedChange={(hideUnplayable) => prefs.update({ hideUnplayable })} />
              {t('hide.count', { n: marked })}
            </Label>
            <Button id="btnClearHidden" size="xs" variant="ghost" onClick={() => { prefs.clearUnplayable(); toast.success(t('hide.cleared')); }}>
              {t('hide.clear')}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
