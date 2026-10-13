import { Download, FolderOpen, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { useEditor, useI18n, useStoreEvents } from '../hooks/useEditor';
import type { Lang } from '../engine/i18n';

export function TopBar({ onExport, onSave, onOpen, layout, embedded }: { onExport: () => void; onSave: () => void; onOpen: () => void; layout?: React.ReactNode; embedded?: boolean }) {
  const { store } = useEditor();
  const { t, lang, setLang } = useI18n();
  useStoreEvents(['change']);
  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b px-3 max-[900px]:gap-1.5 max-[900px]:px-2">
      {!embedded && (
        <div className="flex items-center gap-2 font-bold">
          <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><rect x="2" y="4" width="20" height="16" rx="3" fill="#ef4444" /><path d="M10 8.5v7l6-3.5-6-3.5z" fill="#fff" /></svg>
          Veditor
        </div>
      )}
      <Input
        id="projectName"
        className="h-8 w-56 min-w-0 max-[900px]:w-auto max-[900px]:flex-1 border-transparent bg-transparent hover:border-input focus-visible:border-input"
        value={store.project.name}
        onChange={(e) => { store.project.name = e.target.value; store.dirty = true; store.changed('project-name'); }}
        spellCheck={false}
      />
      <div className="ml-auto flex shrink-0 items-center gap-2 max-[900px]:gap-0.5">
        <Button id="btnOpenProject" variant="ghost" size="sm" onClick={onOpen}><FolderOpen /> <span className="max-[900px]:hidden">{t('project.open')}</span></Button>
        <Button id="btnSaveProject" variant="ghost" size="sm" onClick={onSave}><Save /> <span className="max-[900px]:hidden">{t('project.save')}</span></Button>
        {layout}
        <div className="w-20 max-[900px]:w-[4.5rem]"><NativeSelect id="langSelect" size="sm" value={lang} onChange={(e) => setLang(e.target.value as Lang)} aria-label="Language">
          <NativeSelectOption value="tr">TR</NativeSelectOption><NativeSelectOption value="en">EN</NativeSelectOption>
        </NativeSelect></div>
        <Button id="btnExport" size="sm" onClick={onExport}><Download /> <span className="max-[900px]:hidden">{t('export.button')}</span></Button>
      </div>
    </header>
  );
}
