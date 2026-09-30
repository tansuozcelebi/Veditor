import { Search, Star, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { NativeSelect, NativeSelectOption, NativeSelectGroup } from '@/components/ui/native-select';
import { useI18n } from '../engine/i18n';
import { DEFAULT_SETTINGS, prefs, type SortKey, type ViewSettings } from '../engine/prefs';
import type { Facet } from '../engine/catalog';

const SORTS: SortKey[] = ['name', 'name-desc', 'group', 'country', 'recent', 'playlist'];

function FacetSelect({ id, label, value, options, onChange, className }: {
  id: string; label: string; value: string; options: Facet[]; onChange: (v: string) => void; className?: string;
}) {
  const { t } = useI18n();
  const option = (o: Facet) => <NativeSelectOption key={o.value} value={o.value}>{o.label} ({o.count})</NativeSelectOption>;
  // the country list puts Türkiye in a section of its own at the top; the others are one flat list
  const pinned = options.filter((o) => o.group === 'pinned');
  return (
    <label className={cn('flex min-w-0 flex-col gap-1', className)}>
      <span className="text-muted-foreground text-[11px] uppercase">{label}</span>
      <NativeSelect id={id} size="sm" value={value} onChange={(e) => onChange(e.target.value)}>
        <NativeSelectOption value="">{t('filter.all')}</NativeSelectOption>
        {pinned.length === 0
          ? options.map(option)
          : (<>
            <NativeSelectGroup label={t('filter.pinned')}>{pinned.map(option)}</NativeSelectGroup>
            <NativeSelectGroup label={t('filter.rest')}>{options.filter((o) => o.group !== 'pinned').map(option)}</NativeSelectGroup>
          </>)}
      </NativeSelect>
    </label>
  );
}

/**
 * Search, the four facets, the sort order and the two switches – everything that narrows the list.
 * The search box is always there; the rest folds away behind the header's menu button, because on a
 * phone it is taller than the list it filters.
 */
export function FilterBar({ settings, facets, search, open, onSearch, onChange, onReset }: {
  settings: ViewSettings;
  facets: { groups: Facet[]; categories: Facet[]; countries: Facet[]; languages: Facet[] };
  /** Kept apart from `settings` so typing stays responsive on a list of this size. */
  search: string;
  /** Whether the facets, the sort order and the switches are shown. */
  open: boolean;
  onSearch: (v: string) => void;
  onChange: (patch: Partial<ViewSettings>) => void;
  onReset: () => void;
}) {
  const { t } = useI18n();
  // the bar under the player owns this setting on a wide screen; here it is only for narrow ones
  const marked = prefs.unplayableCount();
  const dirty = (['group', 'category', 'country', 'language'] as const).some((k) => settings[k])
    || settings.onlyFavorites || !settings.hideNsfw || !!search || settings.sort !== DEFAULT_SETTINGS.sort;

  return (
    <div className="flex shrink-0 flex-col gap-2 border-b p-2.5" id="filterBar" data-open={open}>
      <div className="relative">
        <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2 size-4 -translate-y-1/2" />
        <Input
          id="channelSearch" className="h-8 pr-8 pl-8" placeholder={t('search')} value={search} spellCheck={false}
          onChange={(e) => onSearch(e.target.value)}
        />
        {search && (
          <button type="button" className="text-muted-foreground hover:text-foreground absolute top-1/2 right-2 -translate-y-1/2" onClick={() => onSearch('')} aria-label={t('filter.clear')}>
            <X className="size-4" />
          </button>
        )}
      </div>

      {open && (<>
      <div className="grid grid-cols-2 gap-2">
        <FacetSelect id="filterGroup" label={t('filter.group')} value={settings.group} options={facets.groups} onChange={(group) => onChange({ group })} />
        <FacetSelect id="filterCategory" label={t('filter.category')} value={settings.category} options={facets.categories} onChange={(category) => onChange({ category })} />
        <FacetSelect id="filterLanguage" label={t('filter.language')} value={settings.language} options={facets.languages} onChange={(language) => onChange({ language })} />
        <label className="flex min-w-0 flex-col gap-1">
          <span className="text-muted-foreground text-[11px] uppercase">{t('sort.label')}</span>
          <NativeSelect id="sortSelect" size="sm" value={settings.sort} onChange={(e) => onChange({ sort: e.target.value as SortKey })}>
            {SORTS.map((s) => <NativeSelectOption key={s} value={s}>{t('sort.' + s)}</NativeSelectOption>)}
          </NativeSelect>
        </label>
        <FacetSelect
          id="filterCountry" className="col-span-2" label={t('filter.country')} value={settings.country}
          options={facets.countries} onChange={(country) => onChange({ country })}
        />
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Label className="gap-1.5 text-xs">
          <Switch id="favOnly" checked={settings.onlyFavorites} onCheckedChange={(onlyFavorites) => onChange({ onlyFavorites })} />
          <Star className="size-3.5" /> {t('filter.favorites')}
        </Label>
        <Label className="gap-1.5 text-xs">
          <Switch id="hideNsfw" checked={settings.hideNsfw} onCheckedChange={(hideNsfw) => onChange({ hideNsfw })} />
          {t('filter.nsfw')}
        </Label>
        {marked > 0 && (
          <Label className="gap-1.5 text-xs min-[641px]:hidden" title={t('hide.hint')}>
            <Switch id="hideUnplayableSm" checked={settings.hideUnplayable} onCheckedChange={(hideUnplayable) => onChange({ hideUnplayable })} />
            {t('hide.count', { n: marked })}
          </Label>
        )}
        {marked > 0 && (
          <Button id="btnClearHiddenSm" size="xs" variant="ghost" className="min-[641px]:hidden" onClick={() => { prefs.clearUnplayable(); toast.success(t('hide.cleared')); }}>
            {t('hide.clear')}
          </Button>
        )}
        {dirty && <Button id="btnClearFilters" size="xs" variant="ghost" className="ml-auto" onClick={onReset}>{t('filter.clear')}</Button>}
      </div>
      </>)}
    </div>
  );
}
