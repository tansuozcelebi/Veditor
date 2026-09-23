import { toast } from 'sonner';
import { useEditor, useI18n } from './useEditor';
import { importFiles, MediaImportError } from '../engine/media';
import { cspBlocksLocalMedia } from '../engine/csp';
import type { MediaItem } from '../engine/types';

/** Imports files into the media library, converting codecs the browser cannot decode, with localized toasts. */
export function useImportFiles() {
  const { store } = useEditor();
  const { t } = useI18n();
  return async (files: File[]) => {
    if (!files.length) return [] as MediaItem[];
    // one controller for the whole batch: converting a long clip can take minutes, so the toast offers a way out
    const abort = new AbortController();
    const converting = new Map<string, string | number>(); // file name → toast id
    const startedAt = new Map<string, number>();
    const clock = (name: string, ratio: number) => {
      const started = startedAt.get(name) ?? Date.now();
      const elapsed = (Date.now() - started) / 1000;
      const left = ratio > 0.02 ? (elapsed / ratio) - elapsed : NaN;
      const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
      return isFinite(left) ? `${mmss(elapsed)} / ~${mmss(elapsed + left)}` : mmss(elapsed);
    };
    const added = await importFiles(store, files, {
      signal: abort.signal,
      onTranscode: (file, p) => {
        const id = converting.get(file.name);
        if (!p) { // finished (either way); the success/error toast follows
          if (id !== undefined) toast.dismiss(id);
          converting.delete(file.name);
          startedAt.delete(file.name);
          return;
        }
        if (!startedAt.has(file.name)) startedAt.set(file.name, Date.now());
        const msg = p.stage === 'loading'
          ? t('library.convertingLoad', { name: file.name })
          : t('library.converting', { name: file.name, pct: Math.round(p.ratio * 100), time: clock(file.name, p.ratio) });
        converting.set(file.name, toast.loading(msg, {
          id,
          duration: Infinity,
          cancel: { label: t('library.cancel'), onClick: () => { abort.abort(); toast.message(t('library.cancelled', { name: file.name })); } },
        }));
      },
      onError: (file, e) => {
        const reason = e instanceof MediaImportError ? e.reason : null;
        // A blocked blob: URL surfaces as a codec error; say what really happened.
        const key = cspBlocksLocalMedia() ? 'library.err.csp'
          : reason === 'unsupported' ? 'library.unsupported'
          : reason ? `library.err.${reason}` : 'library.loadError';
        toast.error(t(key, { name: file.name }), { duration: 12000 });
      },
    });
    const convertedCount = added.filter((m) => m.transcoded).length;
    if (convertedCount) added.filter((m) => m.transcoded).forEach((m) => toast.success(t('library.converted', { name: m.name })));
    if (added.length > convertedCount) toast.success(t('library.imported', { n: added.length - convertedCount }));
    return added;
  };
}
