import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useEditor, useI18n } from '../hooks/useEditor';
import { useImportFiles } from '../hooks/useImportFiles';
import type { MediaItem, ProjectFile } from '../engine/types';
import { cn } from '@/lib/utils';

export function OpenProjectDialog({ data, onOpenChange }: { data: ProjectFile | null; onOpenChange: (o: boolean) => void }) {
  const { store } = useEditor();
  const { t } = useI18n();
  const importFiles = useImportFiles();
  const fileInput = useRef<HTMLInputElement>(null);
  const [matches, setMatches] = useState<Map<string, MediaItem>>(() => new Map());
  const needed = data?.media || [];
  const current = new Map(matches);
  for (const m of needed) if (!current.has(m.id)) { const hit = [...store.media.values()].find((x) => x.name === m.name); if (hit) current.set(m.id, hit); }

  function load() {
    if (!data) return;
    const project = data.project;
    let dropped = 0;
    project.clips = (project.clips || []).filter((c) => { if (c.kind === 'text') return true; const hit = c.mediaId ? current.get(c.mediaId) : null; if (!hit) { dropped++; return false; } c.mediaId = hit.id; return true; });
    store.loadProject(project);
    toast.success(t('project.loaded', { n: project.clips.length }));
    if (dropped) toast.error(t('project.missingDropped', { n: dropped }));
    onOpenChange(false);
  }

  return (
    <Dialog open={!!data} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>{t('project.openTitle')}</DialogTitle><DialogDescription>{t('project.relinkHint')}</DialogDescription></DialogHeader>
        <div className="grid gap-1 text-sm">
          {needed.map((m) => { const hit = current.get(m.id); return (
            <div key={m.id} className="flex justify-between gap-2 border-b py-1"><span className="truncate">{m.name}</span><span className={cn(hit ? 'text-green-500' : 'text-destructive')}>{hit ? '✓ ' + t('project.found') : '✕ ' + t('project.missing')}</span></div>
          ); })}
        </div>
        <input ref={fileInput} type="file" multiple hidden onChange={async (e) => { const added = await importFiles([...(e.target.files || [])]); const next = new Map(current); for (const m of needed) { const hit = added.find((x) => x.name === m.name); if (hit) next.set(m.id, hit); } setMatches(next); e.target.value = ''; }} />
        <DialogFooter>
          <Button variant="outline" onClick={() => fileInput.current?.click()}>{t('project.chooseFiles')}</Button>
          <Button onClick={load}>{t('project.load')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
