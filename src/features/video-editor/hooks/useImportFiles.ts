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
    const converting = new Map<string, string | number>(); // file name → toast id
    const added = await importFiles(store, files, {
      onTranscode: (file, p) => {
        const id = converting.get(file.name);
        if (!p) { // finished (either way); the success/error toast follows
          if (id !== undefined) toast.dismiss(id);
          converting.delete(file.name);
          return;
        }
        const msg = p.stage === 'loading'
          ? t('library.convertingLoad', { name: file.name })
          : t('library.converting', { name: file.name, pct: Math.round(p.ratio * 100) });
        converting.set(file.name, toast.loading(msg, { id, duration: Infinity }));
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
