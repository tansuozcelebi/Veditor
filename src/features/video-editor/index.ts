// Public entry point of the video editor feature module.
// Usage in a host app:  import { VideoEditor } from '@/features/video-editor';
export { VideoEditor, type VideoEditorProps } from './components/VideoEditor';
export type { EditorContextValue } from './hooks/useEditor';
export { Store, formatTime, formatDurationShort, formatBytes } from './engine/state';
export { Player } from './engine/player';
export { Exporter, supportedFormats } from './engine/exporter';
export { setLang, getLang, t } from './engine/i18n';
export type * from './engine/types';
