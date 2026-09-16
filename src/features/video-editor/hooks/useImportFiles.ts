import { toast } from 'sonner';
import { useEditor, useI18n } from './useEditor';
import { importFiles, MediaImportError } from '../engine/media';
import type { MediaItem } from '../engine/types';

/** Imports files into the media library with localized toasts. */
export function useImportFiles() {
  const { store } = useEditor();
  const { t } = useI18n();
  return async (files: File[]) => {
    if (!files.length) return [] as MediaItem[];
    const added = await importFiles(store, files, {
      onError: (file, e) => {
        const reason = e instanceof MediaImportError ? e.reason : null;
        const key = reason === 'unsupported' ? 'library.unsupported' : reason ? `library.err.${reason}` : 'library.loadError';
        toast.error(t(key, { name: file.name }), { duration: 8000 });
      },
    });
    if (added.length) toast.success(t('library.imported', { n: added.length }));
    return added;
  };
}
