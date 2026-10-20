// ===================== Shared engine types =====================
export type TrackKind = 'video' | 'audio';
export type MediaKind = 'video' | 'audio' | 'image';
export type ClipKind = 'media' | 'text' | 'magnifier';
export type PlacementKind = MediaKind | 'text' | 'magnifier';
export type TransitionType =
  | 'none' | 'fade' | 'fade-black' | 'fade-white'
  | 'slide-left' | 'slide-right' | 'slide-up' | 'slide-down'
  | 'push-left' | 'push-right' | 'push-up' | 'push-down' | 'reveal-left' | 'reveal-right'
  | 'wipe-left' | 'wipe-right' | 'wipe-up' | 'wipe-down' | 'barn-h' | 'barn-v'
  | 'iris' | 'diamond' | 'clock' | 'blinds-h' | 'blinds-v'
  | 'zoom' | 'zoom-out' | 'cross-zoom' | 'spin' | 'flip' | 'blur' | 'pixelate';
export type FitMode = 'contain' | 'cover' | 'stretch';
export type TextAlign = 'left' | 'center' | 'right';
export type BlendMode =
  | 'normal' | 'multiply' | 'screen' | 'overlay' | 'darken' | 'lighten' | 'color-dodge' | 'color-burn'
  | 'hard-light' | 'soft-light' | 'difference' | 'exclusion' | 'hue' | 'saturation' | 'color' | 'luminosity';
export type KeyframeEase = 'linear' | 'ease' | 'ease-in' | 'ease-out' | 'hold';
export type MagnifierShape = 'circle' | 'rounded' | 'rect';

/** The properties a keyframe animates, with their value at one moment. */
export interface KeyframeValues { x: number; y: number; scale: number; rotation: number; opacity: number }
/** `t` is seconds from the clip's start; `ease` shapes the way to the next keyframe. */
export interface Keyframe extends KeyframeValues { t: number; ease: KeyframeEase }

export interface Transition { type: TransitionType; duration: number }

export interface Track {
  id: string; kind: TrackKind; name: string;
  muted: boolean; solo: boolean; locked: boolean; hidden: boolean; volume: number;
  /** Opacity of the whole layer (video tracks), multiplied with each clip's own opacity. */
  opacity: number;
}

export interface Clip {
  id: string; trackId: string | null; mediaId: string | null; kind: ClipKind; name: string;
  start: number; duration: number; offset: number;
  volume: number; muted: boolean; fadeIn: number; fadeOut: number;
  opacity: number; fit: FitMode; scale: number; x: number; y: number;
  transIn: Transition; transOut: Transition;
  text: string; fontFamily: string; fontSize: number; color: string; bold: boolean; italic: boolean; align: TextAlign;
  bgEnabled: boolean; bgColor: string; bgOpacity: number; outlineColor: string; outlineWidth: number; shadow: boolean; lineHeight: number;
  /** Text shadow: colour, opacity, blur and offset (blur/offsets in % of the font size). */
  shadowColor: string; shadowOpacity: number; shadowBlur: number; shadowX: number; shadowY: number;
  /** Mirror image of the text below it: opacity at the top, gap and fade length (in % of the text block height). */
  reflection: boolean; reflectionOpacity: number; reflectionGap: number; reflectionLength: number;
  letterSpacing: number;
  /** Rotation around the layer's centre, in degrees (clockwise). */
  rotation: number;
  /** Crop: how much of the source is cut away on each side, in % of the source width/height. */
  cropL: number; cropT: number; cropR: number; cropB: number;
  flipH: boolean; flipV: boolean;
  /** How the layer mixes with the layers below it. */
  blendMode: BlendMode;
  /** Colour adjustments in %, hue in degrees, blur in % of the frame height (×10). */
  brightness: number; contrast: number; saturation: number; hue: number; blur: number; sepia: number; grayscale: number;
  /** Animation of position/scale/rotation/opacity; empty = the plain values above apply. */
  keyframes: Keyframe[];
  /** Magnifier layer: zoom factor, lens radius (% of frame height), shape, border and shadow. */
  magZoom: number; magSize: number; magShape: MagnifierShape; magBorderColor: string; magBorderWidth: number; magShadow: boolean;
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
  /** Waveform was not computed because the file is too large to decode in memory. */
  peaksSkipped?: boolean;
  /** The file was converted with ffmpeg.wasm because the browser could not decode the original. */
  transcoded?: boolean;
  /** Where the conversion ran, when one was needed. */
  convertedBy?: 'server' | 'browser';
  originalType?: string;
}

export interface MediaSummary { id: string; name: string; kind: MediaKind; duration: number; width: number; height: number; size: number; type: string }

export interface ProjectFile { app: 'veditor'; version: number; project: Project; media: MediaSummary[] }

export interface ExportFormat { mime: string; label: string; ext: string; video: boolean }
export interface ExportOptions { format: ExportFormat; fps: number; videoBitrate?: number; audioBitrate?: number; muteMonitor?: boolean }
export interface ExportProgress { time: number; duration: number; progress: number }
export interface ExportResult { blob: Blob; ext: string; duration: number }
