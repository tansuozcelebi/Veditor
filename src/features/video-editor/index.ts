// Public entry point of the video editor feature module.
// Usage in a host app:  import { VideoEditor } from '@/features/video-editor';
export { VideoEditor, type VideoEditorProps } from './components/VideoEditor';
export { createEditorSession, getDefaultEditorSession, resetDefaultEditorSession, type EditorSession, type EditorContextValue } from './hooks/useEditor';
export { Store, formatTime, formatDurationShort, formatBytes } from './engine/state';
export { Player } from './engine/player';
export { Exporter, supportedFormats } from './engine/exporter';
export { setLang, getLang, t, onLangChange, type Lang } from './engine/i18n';
// For a host that produces media of its own (a recording, a download) and wants it in the editor.
export { importFiles, ACCEPT_ATTRIBUTE } from './engine/media';
export { fixWebmDuration } from './engine/webm-fix';
export type * from './engine/types';
