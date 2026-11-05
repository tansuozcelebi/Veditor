// ===================== Colour grading (GPU) =====================
// The Basic Correction, Creative and Vignette sections of a Lumetri-style grading panel, run as one
// WebGL2 fragment shader per graded layer. The maths is ported from FilmCraft's grading effect
// (github.com/storytold/filmcraft, crates/render/src/effects.rs `lumetri`; Copyright (c) 2026 ArtCraft Team
// and the FilmCraft contributors, MIT licence – see licenses/filmcraft-MIT.txt):
// white balance and exposure in linear light, then whites/blacks, hue-preserving highlights/
// shadows, an S-curve contrast, faded film, split toning, saturation with vibrance and a vignette
// on the sRGB-encoded signal. A layer whose grade is neutral never comes here.
import type { Grade } from './types';
import { defaultGrade } from './state';

const VERT = `#version 300 es
in vec2 pos;
out vec2 uv;
void main() { uv = vec2(pos.x * 0.5 + 0.5, 0.5 - pos.y * 0.5); gl_Position = vec4(pos, 0.0, 1.0); }`;

const FRAG = `#version 300 es
precision highp float;
in vec2 uv;
out vec4 outColor;
uniform sampler2D tex;
uniform vec3 gains;
uniform float exposure, contrast, hl, sh, wh, bl, sat, vib, faded, creative;
uniform vec3 st, ht;
uniform float va, vmid, vfeather, vaspect;
const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
const float LIFT_LUMA_FLOOR = 0.02;
const float NEUTRAL = 128.0 / 255.0;
vec3 toLin(vec3 c) { return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }
vec3 toEnc(vec3 c) { c = max(c, 0.0); return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
void main() {
  vec3 c = texture(tex, uv).rgb;
  // white balance + exposure in linear light
  vec3 v = toEnc(toLin(c) * gains * exposure);
  // whites / blacks: the end points
  float b0 = -bl * 0.15, w0 = 1.0 - wh * 0.15;
  v = (v - b0) / max(w0 - b0, 1e-3);
  // highlights / shadows: luma-weighted lift or compression that keeps the hue
  float l = dot(v, LUMA);
  float ws = pow(clamp(1.0 - l, 0.0, 1.0), 3.0), whl = pow(clamp(l, 0.0, 1.0), 3.0);
  float nl = max(l + sh * 0.35 * ws + hl * 0.35 * whl, 0.0);
  float k = l > 1e-5 ? min(nl / l, 1.0 + max(nl - l, 0.0) / LIFT_LUMA_FLOOR) : 1.0;
  v = v * k + (nl - max(l, 0.0) * k);
  // contrast: a smooth S-curve around mid grey
  if (abs(contrast) > 1e-4) {
    float kc = 1.0 + contrast;
    vec3 q = clamp(v, 0.0, 1.0);
    vec3 s = q * q * (3.0 - 2.0 * q);
    v = kc >= 1.0 ? q + (s - q) * (kc - 1.0) : 0.5 + (q - 0.5) * kc;
  }
  // faded film: lifted blacks, compressed range
  if (faded > 0.0) v = v * (1.0 - 0.25 * faded) + 0.12 * faded;
  // split tone
  if (creative > 0.5) {
    float l2 = clamp(dot(v, LUMA), 0.0, 1.0);
    v += (st - NEUTRAL) * 0.3 * (1.0 - l2) + (ht - NEUTRAL) * 0.3 * l2;
  }
  // saturation and vibrance (more colour where there is little)
  float l3 = dot(v, LUMA);
  float cur = max(v.r, max(v.g, v.b)) - min(v.r, min(v.g, v.b));
  float s = sat * (1.0 + vib * (1.0 - clamp(cur, 0.0, 1.0)));
  v = l3 + (v - l3) * s;
  // vignette
  if (abs(va) > 1e-4) {
    float nx = (uv.x - 0.5) * 2.0 * vaspect, ny = (uv.y - 0.5) * 2.0;
    float d = sqrt(nx * nx + ny * ny) / 1.41421356;
    float edge = clamp((d - vmid * 0.9) / (max(vfeather, 0.01) * 0.9), 0.0, 1.0);
    float e2 = edge * edge * (3.0 - 2.0 * edge);
    float kv = 1.0 + va * 0.2 * e2;
    v = va < 0.0 ? v * max(kv, 0.0) : v + (1.0 - v) * (kv - 1.0);
  }
  outColor = vec4(clamp(v, 0.0, 1.0), 1.0);
}`;

/** Longest side the grade is computed at; larger sources are graded at this size (a preview and an export look the same). */
const MAX_SIDE = 2048;

const hexRgb = (hex: string): [number, number, number] => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  const n = m ? parseInt(m[1], 16) : 0x808080;
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};

export class Grader {
  readonly canvas: HTMLCanvasElement;
  private gl: WebGL2RenderingContext;
  private prog: WebGLProgram;
  private tex: WebGLTexture;
  private loc: Record<string, WebGLUniformLocation | null> = {};
  private lost = false;

  /** Null when the browser has no WebGL2 – grading is then skipped and the picture shown as it is. */
  static create(): Grader | null {
    try {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl2', { premultipliedAlpha: false, preserveDrawingBuffer: true, antialias: false });
      if (!gl) return null;
      return new Grader(canvas, gl);
    } catch { return null; }
  }

  private constructor(canvas: HTMLCanvasElement, gl: WebGL2RenderingContext) {
    this.canvas = canvas; this.gl = gl;
    canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); this.lost = true; });
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || 'shader');
      return s;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) || 'link');
    this.prog = prog;
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const at = gl.getAttribLocation(prog, 'pos');
    gl.enableVertexAttribArray(at);
    gl.vertexAttribPointer(at, 2, gl.FLOAT, false, 0, 0);
    this.tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    for (const n of ['tex', 'gains', 'exposure', 'contrast', 'hl', 'sh', 'wh', 'bl', 'sat', 'vib', 'faded', 'creative', 'st', 'ht', 'va', 'vmid', 'vfeather', 'vaspect']) this.loc[n] = gl.getUniformLocation(prog, n);
  }

  /**
   * Grades a source frame of `w`×`h` and returns the canvas holding the result (valid until the next
   * call), or null when the GPU is unavailable. The result may be smaller than the source.
   */
  apply(src: TexImageSource, w: number, h: number, grade: Grade): HTMLCanvasElement | null {
    if (this.lost || this.gl.isContextLost()) return null;
    const gl = this.gl;
    const k = Math.min(1, MAX_SIDE / Math.max(w, h));
    const ow = Math.max(1, Math.round(w * k)), oh = Math.max(1, Math.round(h * k));
    if (this.canvas.width !== ow || this.canvas.height !== oh) { this.canvas.width = ow; this.canvas.height = oh; }
    gl.viewport(0, 0, ow, oh);
    gl.useProgram(this.prog);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    try { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src); } catch { return null; }
    const g = grade, n = defaultGrade();
    const b = g.basicOn, c = g.creativeOn, v = g.vignetteOn;
    const temp = b ? g.temperature / 100 : 0, tint = b ? g.tint / 100 : 0;
    const u = this.loc;
    gl.uniform1i(u.tex, 0);
    gl.uniform3f(u.gains, 1 + 0.35 * temp, 1 - 0.3 * tint, 1 - 0.35 * temp);
    gl.uniform1f(u.exposure, Math.pow(2, b ? g.exposure : 0));
    gl.uniform1f(u.contrast, b ? g.contrast / 100 : 0);
    gl.uniform1f(u.hl, b ? g.highlights / 100 : 0);
    gl.uniform1f(u.sh, b ? g.shadows / 100 : 0);
    gl.uniform1f(u.wh, b ? g.whites / 100 : 0);
    gl.uniform1f(u.bl, b ? g.blacks / 100 : 0);
    gl.uniform1f(u.sat, (b ? g.saturation / 100 : 1) * (c ? g.creativeSat / 100 : 1));
    gl.uniform1f(u.vib, c ? g.vibrance / 100 : 0);
    gl.uniform1f(u.faded, c ? g.fadedFilm / 100 : 0);
    gl.uniform1f(u.creative, c ? 1 : 0);
    gl.uniform3f(u.st, ...hexRgb(c ? g.shadowTint : n.shadowTint));
    gl.uniform3f(u.ht, ...hexRgb(c ? g.highlightTint : n.highlightTint));
    gl.uniform1f(u.va, v ? g.vignetteAmount : 0);
    gl.uniform1f(u.vmid, g.vignetteMidpoint / 100);
    gl.uniform1f(u.vfeather, g.vignetteFeather / 100);
    // roundness: 0 follows the frame, 100 is a true circle, negative stretches it wider
    gl.uniform1f(u.vaspect, Math.pow(w / h, Math.max(-1, Math.min(1, g.vignetteRoundness / 100))));
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    return this.canvas;
  }
}

/** Built-in looks (FilmCraft's Lumetri presets that need only these sections), applied over a neutral grade. */
export const GRADE_PRESETS: { key: string; grade: Partial<Grade> }[] = [
  { key: 'tealWarm', grade: { shadowTint: '#5c8599', highlightTint: '#a3876b', contrast: 20, creativeSat: 110 } },
  { key: 'night', grade: { temperature: -45, exposure: -0.9, contrast: 15, creativeSat: 70, shadowTint: '#66739e' } },
  { key: 'goldenDusk', grade: { temperature: 35, tint: 8, highlights: -15, vibrance: 20, highlightTint: '#a88c66' } },
  { key: 'steelBlue', grade: { temperature: -25, saturation: 80, contrast: 25 } },
  { key: 'hardSun', grade: { contrast: 45, shadows: -20, highlights: -25, vibrance: 15 } },
  { key: 'fadedPrint', grade: { fadedFilm: 45, contrast: -10, creativeSat: 85 } },
  { key: 'neutralMono', grade: { saturation: 0 } },
  { key: 'hardMono', grade: { saturation: 0, contrast: 60, blacks: -25 } },
  { key: 'liftShadows', grade: { shadows: 40, blacks: 10 } },
  { key: 'protectHighlights', grade: { highlights: -40, whites: -15 } },
  { key: 'halfSat', grade: { saturation: 50 } },
  { key: 'boostVibrance', grade: { vibrance: 40 } },
  { key: 'vignette', grade: { vignetteAmount: -2.5, vignetteMidpoint: 45, vignetteFeather: 60 } },
];
