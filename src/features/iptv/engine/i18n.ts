// ===================== IPTV viewer translations (TR / EN) =====================
// The strings are the viewer's own; the language switch is the application's, so both pages change
// together from the one control in the editor's top bar.
import { useEffect, useState } from 'react';
import { getLang, onLangChange } from '@/features/video-editor';

const dict: Record<'tr' | 'en', Record<string, string>> = {
  tr: {
    'title': 'Canlı TV',
    'subtitle': 'iptv-org listesi',
    'load.playlist': 'Kanal listesi indiriliyor… {pct}',
    'load.metadata': 'Kanal bilgileri (ülke, kategori, dil) alınıyor…',
    'load.building': 'Liste hazırlanıyor…',
    'load.error': 'Kanal listesi alınamadı: {e}',
    'load.retry': 'Tekrar dene',
    'load.refresh': 'Listeyi yenile',
    'load.cached': 'önbellekten',
    'load.report': '{n} yayın · {meta} tanesi bilgili · {when}',
    'load.noMetadata': 'Kanal bilgileri alınamadı; yalnızca listedeki gruplar kullanılabiliyor.',
    'search': 'Kanal ara…',
    'filter.group': 'Grup', 'filter.category': 'Kategori', 'filter.country': 'Ülke', 'filter.language': 'Dil',
    'filter.all': 'Tümü', 'filter.clear': 'Filtreleri temizle', 'filter.favorites': 'Yalnızca favoriler',
    'filter.toggle': 'Filtreler ve sıralama',
    'filter.nsfw': 'Yetişkin içeriği gizle',
    'sort.label': 'Sıralama', 'sort.name': 'Ada göre (A→Z)', 'sort.name-desc': 'Ada göre (Z→A)',
    'sort.group': 'Gruba göre', 'sort.country': 'Ülkeye göre', 'sort.recent': 'Son izlenenler', 'sort.playlist': 'Liste sırası',
    'list.count': '{n} kanal', 'list.empty': 'Bu filtrelerle kanal bulunamadı.',
    'list.favorite': 'Favorilere ekle / çıkar', 'list.play': 'Oynat',
    'player.idle': 'Listeden bir kanal seçin.', 'player.loading': 'Bağlanılıyor…',
    'player.error': 'Yayın açılamadı', 'player.retry': 'Yeniden dene',
    'player.errCors': 'Yayın sunucusu tarayıcıdan erişime izin vermiyor (CORS). Bu kanal ancak harici bir oynatıcıda açılır.',
    'player.errNetwork': 'Yayına ulaşılamadı; kaynak kapalı ya da adres geçersiz olabilir.',
    'player.errMedia': 'Yayın çözülemedi; kodek bu tarayıcıda desteklenmiyor olabilir.',
    'player.errPolicy': 'Sayfanın güvenlik politikası bu yayını engelliyor.',
    'player.copy': 'Yayın adresini kopyala', 'player.copied': 'Adres kopyalandı',
    'player.open': 'Yeni sekmede aç', 'player.mute': 'Sesi aç/kapat', 'player.fullscreen': 'Tam ekran',
    'player.pip': 'Küçük pencere (PiP)', 'player.volume': 'Ses',
    'share.start': 'Ekran Paylaş', 'share.stop': 'Paylaşımı durdur', 'share.on': 'Ekran paylaşılıyor',
    'share.denied': 'Ekran paylaşımı izni verilmedi.', 'share.unsupported': 'Bu tarayıcı ekran paylaşımını desteklemiyor.',
    'share.failed': 'Ekran alınamadı ({e}). Paylaşılacak bir ekran/pencere bulunamadı.',
    'rec.start': 'Kaydet', 'rec.stop': 'Kaydı durdur', 'rec.on': 'Kaydediliyor {time}',
    'rec.unsupported': 'Bu tarayıcı kayıt (MediaRecorder) desteklemiyor.',
    'rec.noStream': 'Kayıt için önce bir yayın başlatın ya da ekran paylaşın.',
    'rec.tainted': 'Bu yayın tarayıcı tarafından korunuyor (farklı kaynaklı video), doğrudan kaydedilemiyor. Ekran paylaşımını başlatıp öyle kaydedebilirsiniz.',
    'rec.failed': 'Kayıt başarısız: {e}',
    'rec.done': 'Kayıt tamamlandı ({size})', 'rec.download': 'İndir', 'rec.toEditor': 'Editörde aç', 'rec.dismiss': 'Kapat',
    'rec.added': 'Kayıt editöre eklendi',
    'nsfw.badge': 'Yetişkin',
  },
  en: {
    'title': 'Live TV',
    'subtitle': 'iptv-org playlist',
    'load.playlist': 'Downloading the channel list… {pct}',
    'load.metadata': 'Fetching channel details (country, category, language)…',
    'load.building': 'Preparing the list…',
    'load.error': 'The channel list could not be loaded: {e}',
    'load.retry': 'Try again',
    'load.refresh': 'Refresh the list',
    'load.cached': 'from cache',
    'load.report': '{n} streams · {meta} with details · {when}',
    'load.noMetadata': 'Channel details are unavailable; only the playlist groups can be used.',
    'search': 'Search channels…',
    'filter.group': 'Group', 'filter.category': 'Category', 'filter.country': 'Country', 'filter.language': 'Language',
    'filter.all': 'All', 'filter.clear': 'Clear filters', 'filter.favorites': 'Favourites only',
    'filter.toggle': 'Filters and sorting',
    'filter.nsfw': 'Hide adult content',
    'sort.label': 'Sort', 'sort.name': 'Name (A→Z)', 'sort.name-desc': 'Name (Z→A)',
    'sort.group': 'By group', 'sort.country': 'By country', 'sort.recent': 'Recently watched', 'sort.playlist': 'Playlist order',
    'list.count': '{n} channels', 'list.empty': 'No channel matches these filters.',
    'list.favorite': 'Add to / remove from favourites', 'list.play': 'Play',
    'player.idle': 'Pick a channel from the list.', 'player.loading': 'Connecting…',
    'player.error': 'The stream could not be opened', 'player.retry': 'Try again',
    'player.errCors': 'The stream server does not allow browser access (CORS). This channel only opens in an external player.',
    'player.errNetwork': 'The stream could not be reached; the source may be down or the address invalid.',
    'player.errMedia': 'The stream could not be decoded; this browser may not support its codec.',
    'player.errPolicy': "The page's security policy blocks this stream.",
    'player.copy': 'Copy the stream address', 'player.copied': 'Address copied',
    'player.open': 'Open in a new tab', 'player.mute': 'Mute / unmute', 'player.fullscreen': 'Fullscreen',
    'player.pip': 'Picture in picture', 'player.volume': 'Volume',
    'share.start': 'Share screen', 'share.stop': 'Stop sharing', 'share.on': 'Sharing your screen',
    'share.denied': 'Screen sharing was not allowed.', 'share.unsupported': 'This browser cannot share the screen.',
    'share.failed': 'The screen could not be captured ({e}). No screen or window was available.',
    'rec.start': 'Record', 'rec.stop': 'Stop recording', 'rec.on': 'Recording {time}',
    'rec.unsupported': 'This browser has no MediaRecorder support.',
    'rec.noStream': 'Start a stream or share your screen before recording.',
    'rec.tainted': 'The browser protects this stream (cross-origin video), so it cannot be recorded directly. Share your screen and record that instead.',
    'rec.failed': 'Recording failed: {e}',
    'rec.done': 'Recording finished ({size})', 'rec.download': 'Download', 'rec.toEditor': 'Open in the editor', 'rec.dismiss': 'Close',
    'rec.added': 'The recording was added to the editor',
    'nsfw.badge': 'Adult',
  },
};

export function t(key: string, vars?: Record<string, string | number>) {
  const lang = getLang() === 'tr' ? 'tr' : 'en';
  let s = dict[lang][key] ?? dict.en[key] ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replace(new RegExp('\\{' + k + '\\}', 'g'), String(v));
  return s;
}

/** Re-renders the viewer when the application language changes. */
export function useI18n() {
  const [lang, setLang] = useState(getLang());
  useEffect(() => onLangChange(setLang), []);
  return { t, lang };
}
