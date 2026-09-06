# Veditor – Çok Kanallı Tarayıcı Video Editörü / Multi-track Browser Video Editor

[![CI](https://github.com/tansuozcelebi/Veditor/actions/workflows/ci.yml/badge.svg)](https://github.com/tansuozcelebi/Veditor/actions/workflows/ci.yml)

Veditor, tamamen tarayıcıda çalışan (sunucu ve derleme adımı gerektirmeyen) çok kanallı bir video editörüdür.
Birden fazla video/ses kanalını aynı anda oynatır, kliplerinizi keser/böler/taşır, ses ekleyip mikserler,
seslendirme kaydeder ve sonucu tek bir video dosyası olarak dışa aktarır.

> English summary: Veditor is a dependency-free, browser-based multi-track video editor. It composites several
> video layers (full-frame or picture-in-picture), mixes multiple audio tracks with volume/fades, records
> voice-overs from the microphone, adds text layers and clip transitions (dissolve, slide, zoom, wipe, blur), and
> exports the result via `MediaRecorder` (WebM VP9/VP8 + Opus, or MP4 where the browser supports it). No upload – your
> media never leaves the machine.

![Veditor screenshot](docs/screenshot.png)

## Özellikler

| Alan | Özellik |
| --- | --- |
| **Çok kanallı oynatıcı** | Sınırsız video ve ses kanalı. Video kanalları katman olarak (üstteki kanal öne) Canvas üzerinde birleştirilir; **Kanal Izgarası** modu tüm kanalları yan yana gösterir. Web Audio API ile tüm kanallar aynı anda miks edilir. |
| **Medya** | Video, ses ve görsel içe aktarma (sürükle-bırak veya dosya seçici). Küçük resimler, dalga formu, süre/çözünürlük analizi. |
| **Düzenleme** | Sürükleyerek taşıma (kanallar arası dahil), uçlardan kırpma, oynatma kafasında bölme (**S**), çoğaltma, silme, yapışma (snap), çakışma engelleme, geri al / yeniden yap (100 adım). |
| **Ses ekleme** | Ses dosyası ekleme, **mikrofonla seslendirme kaydı** (zaman çizelgesi oynatılırken), video klibin **sesini ayrı kanala kopyalama**, klip ve kanal bazında ses seviyesi, sessiz, solo, fade-in / fade-out. |
| **Görüntü** | Klip başına opaklık, sığdırma modu (sığdır/kapla/esnet), ölçek ve konum; hazır **PiP** (resim içinde resim) ve yarım ekran yerleşimleri. |
| **Geçiş efektleri** | Klip başına giriş/çıkış geçişi: çapraz erime (solma), sola/sağa/yukarı/aşağı kaydırma, yakınlaşma, sola/sağa silme, bulanıklık. Bitişik bir önceki klip varsa geçiş iki klibi harmanlar (önceki klip geçiş süresince uzatılır, sesler çapraz geçer); yoksa klip alttaki katmandan belirir. |
| **Yazı katmanı** | Video kanallarına yazı klipleri (**T** tuşu veya "Yazı Ekle"): çok satırlı metin, yazı tipi, boyut, renk, kalın/italik, hizalama, arka plan kutusu, kontur, gölge, satır aralığı; konum/ölçek/opaklık ve geçişler tüm kliplerde olduğu gibi çalışır. |
| **Dışa aktarma** | WebM (VP9/VP8 + Opus) ya da tarayıcı destekliyorsa MP4 (H.264 + AAC); yalnızca ses (Opus / AAC). Çözünürlük (1080p, 720p, 4K, dikey, kare, özel), kare hızı, bit hızı seçimi, ilerleme çubuğu, önizleme ve indirme. WebM çıktısına süre bilgisi otomatik eklenir. |
| **Proje** | Proje ayarları (çözünürlük, FPS, arka plan), proje dosyasını JSON olarak kaydetme / açma (medya dosyaları yeniden eşleştirilir), TR / EN arayüz. |

## Çalıştırma

Sadece statik bir HTTP sunucusu gerekir (ES modülleri `file://` üzerinden çalışmaz):

```bash
npm run dev          # http://localhost:8080 adresinde tarayıcıda açar (http-server, kurulum gerektirmez)
npm start            # aynı komut
npm run serve        # tarayıcı açmadan yalnızca sunucu
# veya
python3 -m http.server 8080
```

Ardından `index.html`'i tarayıcıda açın. **Chrome / Edge** (veya Chromium tabanlı tarayıcılar) önerilir;
Firefox'ta dışa aktarma WebM ile sınırlıdır, Safari'de MediaRecorder desteği kısıtlıdır.

## Kullanım

1. **İçe Aktar** ile video / ses / görsel dosyalarını ekleyin (ya da sol panele veya zaman çizelgesine sürükleyin).
2. Medya kartındaki **＋** ile oynatma kafasına ekleyin, çift tıklayın ya da doğrudan istediğiniz kanala sürükleyin.
   Ses dosyaları otomatik olarak ses kanalına gider; video bir ses kanalına bırakılırsa yalnızca sesi kullanılır.
3. Klipleri sürükleyin, uçlarından kırpın, **S** ile bölün. Sağ tık menüsünde tüm işlemler vardır.
4. Bir klibi seçince sağdaki **Özellikler** panelinde ses seviyesi, fade, opaklık, ölçek, konum ve PiP yerleşimleri görünür.
5. **Ses Kaydet** ile mikrofondan seslendirme kaydedin; kayıt oynatma kafasından başlar ve durdurunca ses kanalına eklenir.
6. **Dışa Aktar** ile biçim, çözünürlük, FPS ve kaliteyi seçip başlatın. Dışa aktarma gerçek zamanlı çalışır
   (5 dakikalık proje ≈ 5 dakika); sekmeyi ön planda tutun.

### Kısayollar

| Tuş | İşlev |
| --- | --- |
| `Space` | Oynat / Duraklat |
| `S` | Seçili klibi (yoksa oynatma kafası altındaki klipleri) böl |
| `T` | Oynatma kafasına yazı katmanı ekle |
| `Delete` / `Backspace` | Seçili klipleri sil |
| `Ctrl+Z` / `Ctrl+Y` | Geri al / Yeniden yap |
| `Ctrl+D` | Çoğalt |
| `Ctrl+A` | Tüm klipleri seç |
| `M` | Seçili klibi sessize al / aç |
| `← / →` (+`Shift`) | Kare kare (1 sn) ilerle |
| `J` / `K` / `L` | 5 sn geri / duraklat / 5 sn ileri |
| `Home` / `End` | Başa / sona git |
| `+` / `-`, `Ctrl+Tekerlek` | Yakınlaştır / uzaklaştır |
| `Ctrl+S` / `Ctrl+E` | Projeyi kaydet / Dışa aktar |

## Mimari

```
index.html            Uygulama iskeleti
css/style.css         Tema ve düzen
js/main.js            Başlatma, düğme/kısayol bağlantıları, düzenleme komutları
js/state.js           Proje modeli (kanallar, klipler), seçim, geri al / yeniden yap, yerleşim/çakışma mantığı
js/media.js           İçe aktarma, metadata, küçük resimler, dalga formu (8 kHz OfflineAudioContext ile bellek dostu)
js/player.js          Oynatma motoru: AudioContext saati, klip başına <video>/<audio> öğeleri, Web Audio miks grafı,
                      Canvas kompozit (katman / ızgara), PiP dönüşümleri, fade'ler, geçiş efektleri, yazı katmanı çizimi
js/timeline.js        Zaman çizelgesi: cetvel, kanal başlıkları, klip sürükleme/kırpma/yapışma, sürükle-bırak
js/exporter.js        MediaRecorder tabanlı dışa aktarma (canvas.captureStream + MediaStreamDestination)
js/webm-fix.js        MediaRecorder WebM çıktısına Duration alanı ekleyen EBML yamalayıcı
js/ui.js              Kitaplık, özellikler paneli, dışa aktarma / kayıt / proje diyalogları, bildirimler, sağ tık menüsü
js/i18n.js            TR / EN çeviriler
test/                 Playwright ile uçtan uca duman testi ve fikstür üretici
```

**Oynatma senkronu:** Ana saat `AudioContext.currentTime`'dır. Her karede aktif kliplerin öğeleri kaynak
konumuna (`offset + (t - start)`) hizalanır; 200 ms'den fazla sapan öğe yeniden konumlanır, yaklaşan klipler
1,5 sn önceden ilk karesine hazırlanır. Her klip kendi `GainNode`'una, her kanal kendi kanal kazancına bağlıdır;
miks hem hoparlöre hem de dışa aktarma için `MediaStreamDestination`'a gider.

## Test

```bash
npm install          # playwright + eslint (geliştirme bağımlılıkları)
npx playwright install chromium
npm run lint
npm test
```

Aynı adımlar GitHub Actions üzerinde her push ve pull request için otomatik çalışır (`.github/workflows/ci.yml`);
ekran görüntüsü ve dışa aktarılan örnek video iş akışı çıktısı olarak yüklenir.

### Otomatik birleştirme (auto-merge)

Özel depolarda ücretsiz planda dal koruma kuralı olmadığı için GitHub'ın kendi auto-merge'i CI'yı bekleyemez.
Bu yüzden iş akışında CI'ya bağlı bir `automerge` işi vardır: **`automerge` etiketi** taşıyan ve taslak olmayan bir
pull request, test işi yeşil olur olmaz merge commit ile `main` dalına birleştirilir. Etiketi kaldırmak veya PR'ı
taslağa çevirmek otomatik birleştirmeyi durdurur.

Test, uygulamayı yerel bir sunucudan başsız Chromium'da açar; deterministik fikstürler (iki VP8 video, WAV ton, PNG)
üretir, içe aktarma → yerleştirme → bölme/geri alma → fare ile sürükleme/kırpma → oynatma/kompozit/ızgara → sesi ayırma →
sahte mikrofonla seslendirme kaydı → proje kaydet/aç → dışa aktarma akışını doğrular ve çıktıyı Playwright ile gelen
ffmpeg ile (akışlar, süre, çözülebilirlik) kontrol eder. Çıktılar `test/output/` altına yazılır.

## Sınırlamalar

- Dışa aktarma gerçek zamanlıdır (MediaRecorder); arka plandaki sekmelerde kare üretimi durur.
- MP4 çıktısı yalnızca tarayıcı `MediaRecorder` ile `video/mp4` destekliyorsa listelenir (Chrome 126+ birçok platformda destekler).
- Proje dosyası medya içermez; açarken dosyalar ada göre yeniden eşleştirilir.
- Hız değiştirme (yavaş/hızlı çekim) bu sürümde yoktur.

## Lisans

MIT
