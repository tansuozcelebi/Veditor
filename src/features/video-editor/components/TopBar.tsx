import { Download, FolderOpen, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { useEditor, useI18n, useStoreEvents } from '../hooks/useEditor';
import type { Lang } from '../engine/i18n';

export function TopBar({ onExport, onSave, onOpen, embedded }: { onExport: () => void; onSave: () => void; onOpen: () => void; embedded?: boolean }) {
  const { store } = useEditor();
  const { t, lang, setLang } = useI18n();
  useStoreEvents(['change']);
  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b px-3">
      {!embedded && (
        <div className="flex items-center gap-2 font-bold">
          <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><rect x="2" y="4" width="20" height="16" rx="3" fill="#ef4444" /><path d="M10 8.5v7l6-3.5-6-3.5z" fill="#fff" /></svg>
          Veditor
        </div>
      )}
      <Input
        id="projectName"
        className="h-8 w-56 border-transparent bg-transparent hover:border-input focus-visible:border-input"
        value={store.project.name}
        onChange={(e) => { store.project.name = e.target.value; store.dirty = true; store.changed('project-name'); }}
        spellCheck={false}
      />
      <div className="ml-auto flex items-center gap-2">
        <Button id="btnOpenProject" variant="ghost" size="sm" onClick={onOpen}><FolderOpen /> {t('project.open')}</Button>
        <Button id="btnSaveProject" variant="ghost" size="sm" onClick={onSave}><Save /> {t('project.save')}</Button>
        <div className="w-20"><NativeSelect id="langSelect" size="sm" value={lang} onChange={(e) => setLang(e.target.value as Lang)} aria-label="Language">
          <NativeSelectOption value="tr">TR</NativeSelectOption><NativeSelectOption value="en">EN</NativeSelectOption>
        </NativeSelect></div>
        <Button id="btnExport" size="sm" onClick={onExport}><Download /> {t('export.button')}</Button>
      </div>
    </header>
  );
}
