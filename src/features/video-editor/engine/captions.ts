// ===================== Captions: SRT and WebVTT =====================
// Subtitles come in as text layers on a caption track (one text clip per cue, styled as subtitles
// at the bottom of the frame) and go out again from a track's text clips – the SubRip / WebVTT
// round trip FilmCraft offers for its caption tracks.

export interface Cue { start: number; end: number; text: string }

const TIME = /(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})/;

function parseTime(s: string): number | null {
  const m = TIME.exec(s.trim());
  if (!m) return null;
  return (Number(m[1] || 0) * 3600) + Number(m[2]) * 60 + Number(m[3]) + Number(m[4].padEnd(3, '0')) / 1000;
}

/** Reads SubRip (.srt) or WebVTT (.vtt) text; markup tags are dropped, cues sorted by start. */
export function parseCaptions(src: string): Cue[] {
  const text = src.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const cues: Cue[] = [];
  for (const block of text.split(/\n{2,}/)) {
    const lines = block.split('\n').filter((l, i) => i > 0 || l.trim() !== '');
    const at = lines.findIndex((l) => l.includes('-->'));
    if (at < 0) continue; // WEBVTT header, NOTE, STYLE, a stray number
    const [a, b] = lines[at].split('-->');
    const start = parseTime(a), end = parseTime(b ?? '');
    if (start == null || end == null || end <= start) continue;
    const body = lines.slice(at + 1).join('\n')
      .replace(/<[^>]+>/g, '')        // <i>, <b>, <c.class>, <v Speaker>
      .replace(/\{\\[^}]*\}/g, '')    // {\an8} positioning from SSA-flavoured SRT
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
      .trim();
    if (body) cues.push({ start, end, text: body });
  }
  return cues.sort((x, y) => x.start - y.start);
}

const pad = (n: number, l = 2) => String(Math.floor(n)).padStart(l, '0');
function stamp(sec: number, sep: ',' | '.'): string {
  const ms = Math.round(Math.max(0, sec) * 1000);
  return `${pad(ms / 3600000)}:${pad((ms / 60000) % 60)}:${pad((ms / 1000) % 60)}${sep}${pad(ms % 1000, 3)}`;
}

/** Writes cues as SubRip or WebVTT. */
export function formatCaptions(cues: Cue[], format: 'srt' | 'vtt'): string {
  const sorted = cues.slice().sort((a, b) => a.start - b.start);
  if (format === 'vtt') {
    return 'WEBVTT\n\n' + sorted.map((c) => `${stamp(c.start, '.')} --> ${stamp(c.end, '.')}\n${c.text.replace(/-->/g, '→')}\n`).join('\n');
  }
  return sorted.map((c, i) => `${i + 1}\n${stamp(c.start, ',')} --> ${stamp(c.end, ',')}\n${c.text}\n`).join('\n');
}

/** The cues of a track's text clips, in timeline order. */
export function cuesFromClips(clips: { kind: string; start: number; duration: number; text: string }[]): Cue[] {
  return clips.filter((c) => c.kind === 'text' && c.text.trim()).map((c) => ({ start: c.start, end: c.start + c.duration, text: c.text.trim() }));
}

/** Hands a text file to the browser's download. */
export function downloadText(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a'); a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
