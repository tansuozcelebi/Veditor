// ===================== Shared engine types =====================
export type TrackKind = 'video' | 'audio';
export type MediaKind = 'video' | 'audio' | 'image';
export type ClipKind = 'media' | 'text';
export type PlacementKind = MediaKind | 'text';
export type TransitionType = 'none' | 'fade' | 'slide-left' | 'slide-right' | 'slide-up' | 'slide-down' | 'zoom' | 'wipe-left' | 'wipe-right' | 'blur';
export type FitMode = 'contain' | 'cover' | 'stretch';
export type TextAlign = 'left' | 'center' | 'right';

export interface Transition { type: TransitionType; duration: number }

export interface Track {
  id: string; kind: TrackKind; name: string;
  muted: boolean; solo: boolean; locked: boolean; hidden: boolean; volume: number;
}

export interface Clip {
  id: string; trackId: string | null; mediaId: string | null; kind: ClipKind; name: string;
  start: number; duration: number; offset: number;
  volume: number; muted: boolean; fadeIn: number; fadeOut: number;
  opacity: number; fit: FitMode; scale: number; x: number; y: number;
  transIn: Transition; transOut: Transition;
  text: string; fontFamily: string; fontSize: number; color: string; bold: boolean; italic: boolean; align: TextAlign;
  bgEnabled: boolean; bgColor: string; bgOpacity: number; outlineColor: string; outlineWidth: number; shadow: boolean; lineHeight: number;
}

export interface Project {
  name: string; width: number; height: number; fps: number; background: string;
  tracks: Track[]; clips: Clip[];
}

export interface Thumbnail { time: number; url: string }

export interface MediaItem {
  id: string; name: string; kind: MediaKind; file: File; url: string; size: number; type: string;
  duration: number; width: number; height: number;
  thumbnails: Thumbnail[]; peaks: Float32Array | null; poster: string | null; analyzing: boolean;
  image?: HTMLImageElement; hasAudio?: boolean; recorded?: boolean;
}

export interface MediaSummary { id: string; name: string; kind: MediaKind; duration: number; width: number; height: number; size: number; type: string }

export interface ProjectFile { app: 'veditor'; version: number; project: Project; media: MediaSummary[] }

export interface ExportFormat { mime: string; label: string; ext: string; video: boolean }
export interface ExportOptions { format: ExportFormat; fps: number; videoBitrate?: number; audioBitrate?: number; muteMonitor?: boolean }
export interface ExportProgress { time: number; duration: number; progress: number }
export interface ExportResult { blob: Blob; ext: string; duration: number }
