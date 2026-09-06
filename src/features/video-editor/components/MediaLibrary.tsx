import { useRef, useState, type DragEvent } from 'react';
import { Mic, Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useEditor, useI18n, useStoreEvents } from '../hooks/useEditor';
import { useImportFiles } from '../hooks/useImportFiles';
import { formatBytes, formatDurationShort } from '../engine/state';
import type { MediaItem } from '../engine/types';
import { cn } from '@/lib/utils';

export function MediaLibrary({ onAdd, onRecord, onDragStart, selectedId, onSelect, onRemove }: {
  onAdd: (mediaId: string) => void; onRecord: () => void; onDragStart: (m: MediaItem) => void;
  selectedId: string | null; onSelect: (id: string) => void; onRemove: (m: MediaItem) => void;
}) {
  const { store } = useEditor();
  const { t } = useI18n();
  useStoreEvents(['media']);
  const importFilesFn = useImportFiles();
  const fileInput = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const items = [...store.media.values()];

  const onDrop = (e: DragEvent) => {
    setDragOver(false);
    if (e.dataTransfer.files.length) { e.preventDefault(); void importFilesFn([...e.dataTransfer.files]); }
  };

  return (
    <aside className="bg-card flex min-h-0 min-w-0 flex-col border-r" id="libraryPanel">
      <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
        <h2 className="text-sm font-semibold">{t('library.title')}</h2>
        <div className="flex gap-1.5">
          <Button id="btnRecordVoice" variant="outline" size="xs" title={t('record.title')} onClick={onRecord}><Mic /> {t('record.button')}</Button>
          <Button id="btnImport" size="xs" onClick={() => fileInput.current?.click()}><Plus /> {t('library.import')}</Button>
        </div>
      </div>
      <input ref={fileInput} type="file" id="fileInput" multiple accept="video/*,audio/*,image/*" hidden onChange={(e) => { void importFilesFn([...(e.target.files || [])]); e.target.value = ''; }} />
      <div
        id="libraryDrop"
        className={cn('relative flex-1 overflow-auto p-2.5', dragOver && 'drag-over')}
        onDragOver={(e) => { if ([...e.dataTransfer.types].includes('Files')) { e.preventDefault(); setDragOver(true); } }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
      >
        {items.length === 0 && (
          <div className="text-muted-foreground pointer-events-none absolute inset-0 flex flex-col items-center justify-center p-6 text-center text-sm" id="libraryEmpty">
            <div className="mb-2 text-4xl">🎬</div>
            <p>{t('library.empty')}</p>
          </div>
        )}
        <div className="grid grid-cols-[repeat(auto-fill,minmax(118px,1fr))] gap-2.5" id="libraryList">
          {items.map((m) => (
            <div
              key={m.id}
              className={cn('media-card', selectedId === m.id && 'selected')}
              data-id={m.id}
              draggable
              onClick={() => onSelect(m.id)}
              onDoubleClick={() => onAdd(m.id)}
              onDragStart={(e) => { e.dataTransfer.setData('application/x-veditor-media', m.id); e.dataTransfer.effectAllowed = 'copy'; onDragStart(m); }}
            >
              <div className={cn('thumb', m.kind)} style={m.poster ? { backgroundImage: `url("${m.poster}")` } : undefined}>{!m.poster && (m.kind === 'audio' ? '🎵' : '🎬')}</div>
              <Badge className={cn('absolute top-1.5 left-1.5 text-[10px] uppercase', m.kind === 'video' && 'bg-blue-600 text-white', m.kind === 'audio' && 'bg-green-600 text-white', m.kind === 'image' && 'bg-amber-500 text-white')}>{t('kind.' + m.kind)}</Badge>
              <div className="px-2 py-1.5">
                <div className="truncate text-xs" title={m.name}>{m.name}</div>
                <div className="text-muted-foreground flex justify-between text-[11px]"><span>{formatDurationShort(m.duration)}</span><span>{m.width ? `${m.width}×${m.height}` : formatBytes(m.size)}</span></div>
              </div>
              <div className="actions">
                <Button size="icon-xs" variant="secondary" title={t('library.addToTimeline')} onClick={(e) => { e.stopPropagation(); onAdd(m.id); }}><Plus /></Button>
                <Button size="icon-xs" variant="secondary" title={t('library.remove')} onClick={(e) => { e.stopPropagation(); onRemove(m); }}><X /></Button>
              </div>
              {m.analyzing && <div className="absolute inset-0 flex items-center justify-center bg-black/55 text-[11px] text-white">{t('library.analyzing')}</div>}
            </div>
          ))}
        </div>
      </div>
    </aside>
  );
}
