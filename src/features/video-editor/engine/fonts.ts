// ===================== Fonts for text layers =====================
// Text is painted into the canvas, so a font is only usable once the browser has actually loaded it:
// a family that is merely named falls back silently. System fonts are always there; web fonts are
// fetched from Google Fonts the first time a layer uses them, and a user can bring a font file of
// their own (TTF/OTF/WOFF/WOFF2), which is registered with the FontFace API for this session.

export interface FontGroup { key: string; fonts: string[] }

/** Web fonts and the weights each one really has – asking Google for a weight it lacks fails the whole request. */
const WEB_FONTS: Record<string, string> = {
  'Roboto': '400;700', 'Open Sans': '400;700', 'Montserrat': '400;700;900', 'Poppins': '400;700', 'Lato': '400;700',
  'Nunito': '400;700', 'Raleway': '400;700', 'Ubuntu': '400;700', 'Oswald': '400;700', 'Anton': '', 'Bebas Neue': '',
  'Playfair Display': '400;700', 'Merriweather': '400;700', 'Lora': '400;700', 'Cinzel': '400;700',
  'Lobster': '', 'Pacifico': '', 'Dancing Script': '400;700', 'Caveat': '400;700', 'Great Vibes': '',
  'Bangers': '', 'Permanent Marker': '', 'Press Start 2P': '', 'Bungee': '', 'Righteous': '',
  'Source Code Pro': '400;700', 'Fira Code': '400;700',
};

const SYSTEM_FONTS = ['Arial', 'Helvetica', 'Verdana', 'Tahoma', 'Trebuchet MS', 'Segoe UI', 'Georgia', 'Times New Roman', 'Garamond', 'Courier New', 'Impact', 'Comic Sans MS', 'sans-serif', 'serif', 'monospace', 'cursive'];

export const FONT_GROUPS: FontGroup[] = [
  { key: 'system', fonts: SYSTEM_FONTS },
  { key: 'sans', fonts: ['Roboto', 'Open Sans', 'Montserrat', 'Poppins', 'Lato', 'Nunito', 'Raleway', 'Ubuntu'] },
  { key: 'display', fonts: ['Oswald', 'Anton', 'Bebas Neue', 'Bangers', 'Bungee', 'Righteous', 'Press Start 2P'] },
  { key: 'serifs', fonts: ['Playfair Display', 'Merriweather', 'Lora', 'Cinzel'] },
  { key: 'script', fonts: ['Lobster', 'Pacifico', 'Dancing Script', 'Caveat', 'Great Vibes', 'Permanent Marker'] },
  { key: 'mono', fonts: ['Source Code Pro', 'Fira Code'] },
];
export const FONT_FAMILIES = FONT_GROUPS.flatMap((g) => g.fonts);

export const isWebFont = (family: string) => family in WEB_FONTS;

const requested = new Map<string, Promise<boolean>>();
const custom: string[] = [];
const listeners = new Set<() => void>();
const notify = () => { for (const l of listeners) l(); };

/** Called whenever a font finishes loading or a custom one is added, so a UI can refresh. */
export function onFontsChange(cb: () => void): () => void { listeners.add(cb); return () => { listeners.delete(cb); }; }

/** Fonts the user brought this session. */
export function customFonts(): readonly string[] { return custom; }

function googleUrl(family: string) {
  const w = WEB_FONTS[family];
  return `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(/%20/g, '+')}${w ? ':wght@' + w : ''}&display=swap`;
}

/**
 * Makes a family usable on the canvas. Resolves true once it is loaded (or is a system font), false
 * when it could not be fetched – the canvas then falls back to sans-serif, which is still readable.
 */
export function ensureFont(family: string): Promise<boolean> {
  if (!family || typeof document === 'undefined') return Promise.resolve(true);
  if (!isWebFont(family)) return Promise.resolve(true);
  let p = requested.get(family);
  if (!p) {
    p = new Promise<boolean>((resolve) => {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = googleUrl(family);
      link.dataset.veditorFont = family;
      link.onload = () => {
        // the stylesheet only declares the faces; the files come when a face is asked for
        const faces = [`16px "${family}"`, `bold 16px "${family}"`];
        Promise.all(faces.map((f) => document.fonts.load(f))).then(() => { resolve(true); notify(); }, () => resolve(false));
      };
      link.onerror = () => resolve(false);
      document.head.appendChild(link);
    });
    requested.set(family, p);
  }
  return p;
}

/** Loads every font the given text layers use – called before an export, so the first frames are right. */
export async function ensureFonts(families: Iterable<string>, timeoutMs = 4000): Promise<void> {
  const all = Promise.all([...new Set(families)].map(ensureFont));
  await Promise.race([all, new Promise((r) => setTimeout(r, timeoutMs))]);
}

/** Registers a font file for this session and returns the family name to use for it. */
export async function registerFontFile(file: File): Promise<string> {
  const base = file.name.replace(/\.(ttf|otf|woff2?|ttc)$/i, '').replace(/[^\w\s-]+/g, ' ').trim() || 'Custom Font';
  let family = base, n = 2;
  while (FONT_FAMILIES.includes(family) || (custom.includes(family) && n < 100)) family = `${base} ${n++}`;
  const face = new FontFace(family, await file.arrayBuffer());
  await face.load();
  document.fonts.add(face);
  if (!custom.includes(family)) custom.push(family);
  notify();
  return family;
}
