import { toast } from 'sonner';
import { useEditor, useI18n } from './useEditor';
import { importFiles } from '../engine/media';
import type { MediaItem } from '../engine/types';

/** Imports files into the media library with localized toasts. */
export function useImportFiles() {
  const { store } = useEditor();
  const { t } = useI18n();
  return async (files: File[]) => {
    if (!files.length) return [] as MediaItem[];
    const added = await importFiles(store, files, {
      onError: (file, e) => toast.error(t(e.message === 'unsupported' ? 'library.unsupported' : 'library.loadError', { name: file.name })),
    });
    if (added.length) toast.success(t('library.imported', { n: added.length }));
    return added;
  };
}
