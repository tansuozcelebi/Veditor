import { createContext, useCallback, useContext, useEffect, useReducer, useRef, useState, type ComponentProps } from 'react';
import { LayoutDashboard } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { DockviewReact, type DockviewApi, type DockviewReadyEvent, themeDark } from 'dockview-react';
import 'dockview-react/dist/styles/dockview.css';
import { MediaLibrary } from './MediaLibrary';
import { Preview } from './Preview';
import { Inspector } from './Inspector';
import { SourcePlayer } from './SourcePlayer';
import { TimelinePanel } from './TimelinePanel';
import { useI18n } from '../hooks/useEditor';
import { t as translate } from '../engine/i18n';

/** Where the arrangement is remembered. Bump the suffix when the set of panels changes. */
const LAYOUT_KEY = 'veditor.layout.v1';

export type PanelId = 'library' | 'preview' | 'inspector' | 'source' | 'timeline';

/** The props each panel needs; they come from the editor shell, not from dockview's serialized state. */
export interface DockPanelProps {
  library: ComponentProps<typeof MediaLibrary>;
  preview: ComponentProps<typeof Preview>;
  inspector: ComponentProps<typeof Inspector>;
  source: ComponentProps<typeof SourcePlayer>;
  timeline: ComponentProps<typeof TimelinePanel>;
}

// dockview instantiates panels itself, so the props travel through a context instead of JSX.
const PanelPropsContext = createContext<DockPanelProps | null>(null);
function usePanelProps(): DockPanelProps {
  const value = useContext(PanelPropsContext);
  if (!value) throw new Error('a Veditor panel was rendered outside <EditorDock>');
  return value;
}

/** Panel titles follow the interface language. */
const PANEL_TITLE: Record<PanelId, string> = {
  library: 'library.title', preview: 'panel.preview', inspector: 'inspector.title', source: 'source.title', timeline: 'panel.timeline',
};

function LibraryPanel() { return <MediaLibrary {...usePanelProps().library} />; }
function PreviewPanel() { return <Preview {...usePanelProps().preview} />; }
function InspectorPanel() { return <Inspector {...usePanelProps().inspector} />; }
function SourcePanel() { return <SourcePlayer {...usePanelProps().source} />; }
function TimelineDockPanel() { return <TimelinePanel {...usePanelProps().timeline} />; }

const components = { library: LibraryPanel, preview: PreviewPanel, inspector: InspectorPanel, source: SourcePanel, timeline: TimelineDockPanel };

/** The arrangement a first-time user sees: settings and the source monitor on the left. */
function buildDefaultLayout(api: DockviewApi) {
  api.clear();
  api.addPanel({ id: 'preview', component: 'preview', title: translate(PANEL_TITLE.preview) });
  api.addPanel({ id: 'inspector', component: 'inspector', title: translate(PANEL_TITLE.inspector), position: { referencePanel: 'preview', direction: 'left' }, initialWidth: 330 });
  api.addPanel({ id: 'source', component: 'source', title: translate(PANEL_TITLE.source), position: { referencePanel: 'inspector', direction: 'below' }, initialHeight: 300 });
  api.addPanel({ id: 'library', component: 'library', title: translate(PANEL_TITLE.library), position: { referencePanel: 'preview', direction: 'right' }, initialWidth: 300 });
  api.addPanel({ id: 'timeline', component: 'timeline', title: translate(PANEL_TITLE.timeline), position: { direction: 'below' }, initialHeight: 320 });
  // initialWidth/initialHeight only reserve space while the grid is being built – on a reset the
  // existing grid redistributes them – so the final proportions are set explicitly.
  api.getPanel('inspector')?.group.api.setSize({ width: 330 });
  api.getPanel('library')?.group.api.setSize({ width: 300 });
  api.getPanel('source')?.group.api.setSize({ height: 280 });
  api.getPanel('timeline')?.group.api.setSize({ height: 300 });
  api.getPanel('preview')?.api.setActive();
}

/** Puts back any panel the user closed or that a saved layout predates, so nothing is unreachable. */
function ensureAllPanels(api: DockviewApi) {
  for (const id of Object.keys(PANEL_TITLE) as PanelId[]) {
    if (api.getPanel(id)) continue;
    api.addPanel({ id, component: id, title: translate(PANEL_TITLE[id]), position: { direction: id === 'timeline' ? 'below' : 'right' }, inactive: true });
  }
}

export interface DockHandle {
  api: DockviewApi;
  /** Back to the layout a first-time user sees. */
  reset: () => void;
  /** Whether a panel is currently part of the layout. */
  isOpen: (id: PanelId) => boolean;
  /** Closes an open panel, or brings a closed one back. */
  toggle: (id: PanelId) => void;
}

/**
 * The editor workspace as dockable panels: every panel can be dragged to another edge, stacked into
 * tabs, resized, closed and reopened, and the arrangement is remembered between sessions.
 */
/** The View menu: which panels are on screen, and a way back to the default arrangement. */
export function LayoutMenu({ dock }: { dock: DockHandle | null }) {
  const { t } = useI18n();
  const [, refresh] = useReducer((n: number) => n + 1, 0);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button id="btnLayout" variant="ghost" size="sm" disabled={!dock} title={t('layout.hint')}><LayoutDashboard /> {t('layout.title')}</Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent id="layoutMenu" align="end" className="w-60">
        <DropdownMenuLabel className="text-muted-foreground">{t('layout.panels')}</DropdownMenuLabel>
        {(Object.keys(PANEL_TITLE) as PanelId[]).map((id) => (
          <DropdownMenuCheckboxItem
            key={id} data-panel={id} checked={!!dock?.isOpen(id)}
            onSelect={(e) => { e.preventDefault(); dock?.toggle(id); refresh(); }}
          >
            {t(PANEL_TITLE[id])}
          </DropdownMenuCheckboxItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem id="btnResetLayout" onSelect={() => dock?.reset()}>{t('layout.reset')}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function EditorDock({ panels, onHandle, className }: { panels: DockPanelProps; onHandle?: (handle: DockHandle | null) => void; className?: string }) {
  const { t, lang } = useI18n();
  const apiRef = useRef<DockviewApi | null>(null);
  const [ready, setReady] = useState(false);
  const onHandleRef = useRef(onHandle); onHandleRef.current = onHandle;

  const reset = useCallback(() => {
    const api = apiRef.current;
    if (!api) return;
    try { localStorage.removeItem(LAYOUT_KEY); } catch { /* private mode */ }
    buildDefaultLayout(api);
  }, []);

  const toggle = useCallback((id: PanelId) => {
    const api = apiRef.current;
    if (!api) return;
    const panel = api.getPanel(id);
    if (panel) { panel.api.close(); return; }
    api.addPanel({ id, component: id, title: translate(PANEL_TITLE[id]), position: { direction: id === 'timeline' ? 'below' : 'right' } });
  }, []);

  const onReady = useCallback((event: DockviewReadyEvent) => {
    const api = event.api;
    apiRef.current = api;
    let restored = false;
    try {
      const saved = localStorage.getItem(LAYOUT_KEY);
      if (saved) { api.fromJSON(JSON.parse(saved)); restored = api.panels.length > 0; }
    } catch (e) {
      console.warn('[veditor] the saved layout could not be restored, starting from the default one', e);
    }
    if (!restored) buildDefaultLayout(api);
    else ensureAllPanels(api);
    setReady(true);
  }, []);

  // remember the arrangement, but not on every pixel of a drag
  useEffect(() => {
    const api = apiRef.current;
    if (!ready || !api) return;
    onHandleRef.current?.({ api, reset, toggle, isOpen: (id) => !!api.getPanel(id) });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const save = () => {
      clearTimeout(timer);
      timer = setTimeout(() => { try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(api.toJSON())); } catch { /* private mode / quota */ } }, 400);
    };
    const sub = api.onDidLayoutChange(save);
    return () => { clearTimeout(timer); sub.dispose(); onHandleRef.current?.(null); };
  }, [ready, reset, toggle]);

  // panel titles follow the language switch
  useEffect(() => {
    const api = apiRef.current;
    if (!ready || !api) return;
    for (const [id, key] of Object.entries(PANEL_TITLE)) api.getPanel(id)?.api.setTitle(t(key));
  }, [ready, lang, t]);

  return (
    <PanelPropsContext.Provider value={panels}>
      <DockviewReact
        className={className}
        components={components}
        onReady={onReady}
        theme={themeDark}
        singleTabMode="fullwidth"
        disableFloatingGroups={false}
      />
    </PanelPropsContext.Provider>
  );
}
