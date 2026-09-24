import { useEffect, useRef, useState, type DragEvent } from 'react';
import { Plus, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useEditor, useI18n, useStoreEvents } from '../hooks/useEditor';
import { useImportFiles } from '../hooks/useImportFiles';
import { ACCEPT_ATTRIBUTE } from '../engine/media';
import { formatDurationShort } from '../engine/state';
import { cn } from '@/lib/utils';

/**
 * Source monitor: plays one media item on its own, next to the timeline monitor.
 * It shows whatever is selected in the library and anything dropped straight onto it, so a clip can
 * be watched before it is placed. It never shares the timeline's clock – only one of the two plays
 * at a time, so their audio cannot overlap.
 */
export function SourcePlayer({ mediaId, onSelect, onAdd }: {
  mediaId: string | null;
  onSelect: (id: string | null) => void;
  onAdd: (mediaId: string) => void;
}) {
  const { store, player } = useEditor();
  const { t } = useI18n();
  useStoreEvents(['media']);
  const importFiles = useImportFiles();
  const mediaRef = useRef<HTMLVideoElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const m = mediaId ? store.media.get(mediaId) ?? null : null;

  // the timeline monitor takes over the speakers when it starts
  useEffect(() => player.on('play', () => mediaRef.current?.pause()), [player]);

  const drop = async (e: DragEvent) => {
    setDragOver(false);
    const id = e.dataTransfer.getData('application/x-veditor-media');
    if (id && store.media.has(id)) { e.preventDefault(); onSelect(id); return; }
    if (!e.dataTransfer.files.length) return;
    e.preventDefault();
    const added = await importFiles([...e.dataTransfer.files]);
    if (added.length) onSelect(added[0].id);
  };

  return (
    <section className="bg-card flex min-h-0 min-w-0 flex-col" id="sourcePanel">
      <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
        <h2 className="truncate text-sm font-semibold" title={m?.name}>{m ? m.name : t('source.title')}</h2>
        <div className="flex shrink-0 gap-1.5">
          <Button id="btnSourceOpen" variant="outline" size="xs" title={t('source.open')} onClick={() => fileInput.current?.click()}><Upload /></Button>
          <Button id="btnSourceAdd" size="xs" disabled={!m} title={t('source.add')} onClick={() => m && onAdd(m.id)}><Plus /> {t('source.addShort')}</Button>
        </div>
      </div>
      <input
        ref={fileInput} type="file" id="sourceFileInput" multiple accept={ACCEPT_ATTRIBUTE} hidden
        onChange={async (e) => { const files = [...(e.target.files || [])]; e.target.value = ''; const added = await importFiles(files); if (added.length) onSelect(added[0].id); }}
      />
      <div
        id="sourceStage"
        className={cn('relative flex min-h-0 flex-1 items-center justify-center bg-black/60 p-1', dragOver && 'drag-over')}
        onDragOver={(e) => { const types = [...e.dataTransfer.types]; if (types.includes('Files') || types.includes('application/x-veditor-media')) { e.preventDefault(); setDragOver(true); } }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => void drop(e)}
      >
        {m && m.kind === 'image' && <img id="sourceImage" src={m.url} alt={m.name} className="max-h-full max-w-full object-contain" />}
        {m && m.kind !== 'image' && (
          <video
            // a new element per item: reusing one keeps the previous frame visible while the next loads
            key={m.id}
            ref={mediaRef}
            id="sourceVideo"
            src={m.url}
            controls
            playsInline
            className={cn('max-h-full max-w-full', m.kind === 'audio' ? 'w-full' : 'object-contain')}
            onPlay={() => player.pause()}
          />
        )}
        {!m && (
          <div className="text-muted-foreground pointer-events-none flex flex-col items-center gap-2 p-4 text-center text-xs" id="sourceEmpty">
            <div className="text-3xl">🎬</div>
            <p>{t('source.empty')}</p>
          </div>
        )}
      </div>
      {m && (
        <div className="text-muted-foreground flex items-center gap-2 border-t px-3 py-1.5 text-[11px]">
          <Badge variant="secondary" className="text-[10px] uppercase">{t('kind.' + m.kind)}</Badge>
          <span>{formatDurationShort(m.duration)}</span>
          {m.width > 0 && <span>{m.width}×{m.height}</span>}
          {m.transcoded && <span title={t(m.convertedBy === 'server' ? 'source.convertedServer' : 'source.convertedBrowser')}>↻</span>}
        </div>
      )}
    </section>
  );
}
