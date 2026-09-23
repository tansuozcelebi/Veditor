# Veditor – Çok Kanallı Tarayıcı Video Editörü (React + shadcn/ui)

[![CI](https://github.com/tansuozcelebi/Veditor/actions/workflows/ci.yml/badge.svg)](https://github.com/tansuozcelebi/Veditor/actions/workflows/ci.yml)

Veditor, tamamen tarayıcıda çalışan çok kanallı bir video editörüdür. Birden fazla video/ses kanalını aynı anda
oynatır, kliplerinizi keser/böler/taşır, ses ekleyip mikserler, seslendirme kaydeder, geçiş efektleri ve yazı
katmanları ekler ve sonucu tek bir video dosyası olarak dışa aktarır. Medya hiçbir zaman makinenizden çıkmaz.

Uygulama **React 19 + TypeScript + Vite + Tailwind CSS v4 + shadcn/ui (new-york)** ile yazılmıştır ve
`src/features/video-editor` altında **kendi kendine yeten bir özellik modülü** olarak paketlenmiştir. Bu sayede
başka bir shadcn tabanlı uygulamaya (örneğin **KREAWMS-FRONTEND-SHADCN**) bir menü sayfası / rota olarak
kopyalanıp takılabilir. Ayrıntılar için [Başka bir uygulamaya entegrasyon](#başka-bir-uygulamaya-entegrasyon-wms) bölümüne bakın.

> English summary: Veditor is a browser-only multi-track video editor built with React 19, TypeScript, Vite,
> Tailwind v4 and shadcn/ui. It composites several video layers (full-frame or picture-in-picture), mixes multiple
> audio tracks with volume/fades, records voice-overs, adds text layers and clip transitions, and exports via
> `MediaRecorder` (WebM VP9/VP8 + Opus, or MP4 where supported). The editor ships as a self-contained feature
> module (`src/features/video-editor`) that can be mounted as a route inside any shadcn-based host app.

![Veditor screenshot](docs/screenshot.png)

## Özellikler

| Alan | Özellik |
| --- | --- |
| **Çok kanallı oynatıcı** | Sınırsız video ve ses kanalı. Video kanalları katman olarak (üstteki kanal öne) Canvas üzerinde birleştirilir; **Kanal Izgarası** modu tüm kanalları yan yana gösterir. Web Audio API ile tüm kanallar aynı anda miks edilir. |
| **Medya** | Video, ses ve görsel içe aktarma (sürükle-bırak veya dosya seçici). Küçük resimler, dalga formu, süre/çözünürlük analizi. |
| **Düzenleme** | Sürükleyerek taşıma (kanallar arası dahil), uçlardan kırpma, oynatma kafasında bölme (**S**), çoğaltma, silme, yapışma (snap), çakışma engelleme, geri al / yeniden yap (100 adım), sağ tık menüsü. |
| **Ses ekleme** | Ses dosyası ekleme, **mikrofonla seslendirme kaydı** (zaman çizelgesi oynatılırken), video klibin **sesini ayrı kanala kopyalama**, klip ve kanal bazında ses seviyesi, sessiz, solo, fade-in / fade-out. |
| **Görüntü** | Klip başına opaklık, sığdırma modu (sığdır/kapla/esnet), ölçek ve konum; hazır **PiP** (resim içinde resim) ve yarım ekran yerleşimleri. |
| **Geçiş efektleri** | Klip başına giriş/çıkış geçişi: çapraz erime, sola/sağa/yukarı/aşağı kaydırma, yakınlaşma, sola/sağa silme, bulanıklık. Bitişik önceki klip varsa iki klip harmanlanır (önceki klip uzatılır, sesler çapraz geçer); yoksa klip alttaki katmandan belirir. |
| **Yazı katmanı** | Video kanallarına yazı klipleri (**T** tuşu veya "Yazı Ekle"): çok satırlı metin, yazı tipi, boyut, renk, kalın/italik, hizalama, arka plan kutusu, kontur, gölge, satır aralığı; konum/ölçek/opaklık ve geçişler tüm kliplerde olduğu gibi çalışır. |
| **Dışa aktarma** | WebM (VP9/VP8 + Opus) ya da tarayıcı destekliyorsa MP4 (H.264 + AAC); yalnızca ses (Opus / AAC). Çözünürlük (1080p, 720p, 4K, dikey, kare, özel), kare hızı, bit hızı, ilerleme çubuğu, önizleme ve indirme. WebM çıktısına süre bilgisi otomatik eklenir. |
| **Proje** | Proje ayarları (çözünürlük, FPS, arka plan), proje dosyasını JSON olarak kaydetme / açma (medya dosyaları yeniden eşleştirilir), TR / EN arayüz. |

## Çalıştırma

```bash
npm install
npm run dev          # Vite geliştirme sunucusu: http://localhost:8080 (tarayıcıyı açar)
npm run build        # tip denetimi + üretim derlemesi → dist/
npm run preview      # dist/ klasörünü http://localhost:8080 üzerinden sunar
```

Geliştirme kabuğu (`src/app/App.tsx`) bir yan menü ile üç rota içerir; editör `/video-editor` altındadır.
**Chrome / Edge** (Chromium tabanlı tarayıcılar) önerilir; Firefox'ta dışa aktarma WebM ile sınırlıdır, Safari'de
MediaRecorder desteği kısıtlıdır. Node 20+ gerekir.

## Kullanım

1. **İçe Aktar** ile video / ses / görsel dosyalarını ekleyin (ya da sol panele veya zaman çizelgesine sürükleyin).
2. Medya kartındaki **＋** ile oynatma kafasına ekleyin, çift tıklayın ya da doğrudan istediğiniz kanala sürükleyin.
   Ses dosyaları otomatik olarak ses kanalına gider; video bir ses kanalına bırakılırsa yalnızca sesi kullanılır.
3. Klipleri sürükleyin, uçlarından kırpın, **S** ile bölün. Sağ tık menüsünde tüm işlemler vardır.
4. Bir klibi seçince sağdaki **Özellikler** panelinde ses, fade, opaklık, ölçek, konum, geçişler ve yazı ayarları görünür.
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
index.html                         Vite giriş sayfası (#root)
src/main.tsx                       React kökü
src/index.css                      Tailwind v4 + shadcn tema değişkenleri (oklch), dark variant
src/app/App.tsx                    Geliştirme kabuğu: yan menü + react-router rotaları (host uygulamayı taklit eder)
src/lib/utils.ts                   shadcn `cn()` yardımcısı
src/components/ui/                 shadcn/ui bileşenleri (new-york): button, input, textarea, label, separator, badge,
                                   switch, slider, select, native-select, dialog, context-menu, tooltip, scroll-area, sonner
src/features/video-editor/         ▶ ÖZELLİK MODÜLÜ (host uygulamaya kopyalanacak klasör)
  index.ts                         Genel API: <VideoEditor />, Store, Player, Exporter, i18n, tipler
  editor.css                       Zaman çizelgesi / klip / medya kartı stilleri (.veditor altında, shadcn değişkenlerini kullanır)
  components/VideoEditor.tsx       Ana bileşen: düzen, düzenleme komutları, kısayollar, diyaloglar
  components/TopBar.tsx            Proje adı, aç/kaydet, dil, dışa aktar
  components/MediaLibrary.tsx      Medya kitaplığı (içe aktarma, sürükle-bırak, kayıt)
  components/Preview.tsx           Canvas önizleme, taşıma kontrolleri, görünüm modu, monitör sesi
  components/TimelinePanel.tsx     Araç çubuğu + zaman çizelgesi (Radix ContextMenu ile sağ tık menüsü)
  components/Inspector.tsx         Klip / kanal / proje özellik paneli
  components/ExportDialog.tsx      Dışa aktarma diyaloğu (ilerleme, önizleme, indirme)
  components/RecordDialog.tsx      Mikrofon kayıt diyaloğu
  components/OpenProjectDialog.tsx Proje açarken medya eşleştirme
  hooks/useEditor.tsx              EditorSession (createEditorSession / getDefaultEditorSession), EditorProvider (attach/destroy),
                                   useEditor, useStoreEvents, usePlayerTime, useI18n
  hooks/useImportFiles.ts          Bildirimli dosya içe aktarma
  engine/types.ts                  Track, Clip, Project, MediaItem, Export* tipleri
  engine/state.ts                  Proje modeli, seçim, geri al / yeniden yap, yerleşim/çakışma, bölme, biçimlendirme
  engine/media.ts                  İçe aktarma, metadata, küçük resimler, dalga formu
  engine/player.ts                 Oynatma motoru: AudioContext saati, Web Audio miks grafı, Canvas kompozit, geçişler, yazı
  engine/timeline.ts               Zaman çizelgesi DOM motoru (cetvel, sürükleme/kırpma/yapışma) – React ref ile sarılır
  engine/exporter.ts               MediaRecorder tabanlı dışa aktarma
  engine/webm-fix.ts               WebM çıktısına Duration alanı ekleyen EBML yamalayıcı
  engine/i18n.ts                   TR / EN çeviriler
test/                              Playwright uçtan uca duman testi (üretim derlemesine karşı) ve fikstür üretici
```

**Katmanlar:** `engine/` React'ten bağımsız, tip güvenli sınıflardan oluşur (Store olay yayar, Player/Exporter
bu Store'u kullanır). Bu nesneler bir `EditorSession` içinde React ağacının dışında yaşar; `EditorProvider`
bağlanırken motoru `attach()`, ayrılırken `destroy()` eder (proje korunur, medya öğeleri serbest bırakılır); bileşenler
`useStoreEvents([...])` ile yalnızca ilgili olaylarda yeniden çizilir (`useSyncExternalStore`). Zaman çizelgesi
performans nedeniyle imperatif kalır ve `TimelinePanel` içinde bir ref üzerinden yönetilir.

**Oynatma senkronu:** Ana saat `AudioContext.currentTime`'dır. Her karede aktif kliplerin öğeleri kaynak
konumuna (`offset + (t - start)`) hizalanır; 200 ms'den fazla sapan öğe yeniden konumlanır, yaklaşan klipler
1,5 sn önceden hazırlanır. Her klip kendi `GainNode`'una, her kanal kendi kanal kazancına bağlıdır; miks hem
hoparlöre hem de dışa aktarma için `MediaStreamDestination`'a gider.

## Başka bir uygulamaya entegrasyon (WMS)

Editör, KREAWMS-FRONTEND-SHADCN gibi bir shadcn/ui uygulamasına **bir menü öğesi + rota** olarak eklenmek üzere
tasarlandı. Varsayılan host varsayımları: Vite + React + TypeScript, Tailwind CSS v4, shadcn/ui (new-york, CSS
değişkenleri, `@/` takma adı), lucide-react ikonları, react-router. Adımlar:

1. **Klasörü kopyalayın:** `src/features/video-editor/` → host uygulamada aynı yola.
2. **shadcn bileşenlerini sağlayın:** Host'ta yoksa `npx shadcn@latest add button input textarea label separator
   badge switch slider select dialog context-menu tooltip scroll-area sonner` çalıştırın. `native-select`
   shadcn kayıt defterinde yeni bir bileşendir; yoksa `src/components/ui/native-select.tsx` dosyasını kopyalayın.
   Modül yalnızca `@/components/ui/*` ve `@/lib/utils` yollarına bağımlıdır.
3. **Bağımlılıklar:** `react-router-dom` hariç `package.json` içindeki `dependencies` (radix-ui, lucide-react,
   sonner, clsx, tailwind-merge, class-variance-authority) host'ta bulunmalıdır. Host shadcn'in eski
   `@radix-ui/react-*` paketlerini kullanıyorsa `src/components/ui` içindeki `from 'radix-ui'` içe aktarmaları
   host'un kendi bileşenleriyle değiştirilebilir; editör bileşenleri Radix'e doğrudan bağımlı değildir.
4. **Rota ve menü:**

   ```tsx
   import { VideoEditor } from '@/features/video-editor';

   // Rota (react-router örneği)
   <Route path="/video-editor" element={<VideoEditor embedded />} />

   // Menü öğesi (sidebar)
   { title: 'Video Editörü', url: '/video-editor', icon: Clapperboard }
   ```

   Editör, kendisini saran kapsayıcının yüksekliğini doldurur; sayfa kapsayıcısına `h-full min-h-0`
   (ya da `h-[calc(100vh-…)]`) vermeniz yeterlidir. `embedded` özelliği üst çubuktaki markayı gizler.
5. **Tema:** Editör koyu temada çalışacak şekilde kök öğesine `dark` sınıfını ekler ve yalnızca shadcn CSS
   değişkenlerini (`--background`, `--primary`, `--sidebar` …) kullanır; host'un renk paleti otomatik uygulanır.
   Host'ta `@custom-variant dark (&:is(.dark *))` (Tailwind v4 shadcn varsayılanı) tanımlı olmalıdır.
6. **Geri çağrılar:** `onExport(result, fileName)` ile dışa aktarılan dosyayı WMS'e yükleyebilir,
   `onReady(ctx)` ile `store`/`player`/`exporter` nesnelerine erişebilirsiniz.
7. **Menü geçişlerinde proje korunur:** Proje, medya, geri al geçmişi ve oynatma kafası bir **editör
   oturumunda** (`EditorSession`) yaşar; bu nesne React ağacının dışındadır. Kullanıcı başka bir menü
   sayfasına geçip geri döndüğünde editör aynı oturuma yeniden bağlanır, hiçbir şey kaybolmaz (video/ses
   öğeleri ve AudioContext ayrılırken serbest bırakılır, dönüşte yeniden kurulur). Varsayılan olarak paylaşılan
   tek bir oturum kullanılır; kontrolü elinize almak için oturumu bir kez oluşturup `session` özelliği ile verin:

   ```tsx
   import { VideoEditor, createEditorSession, resetDefaultEditorSession } from '@/features/video-editor';

   const editorSession = createEditorSession();   // modül düzeyinde: uygulama ömrü boyunca tek örnek
   <Route path="/video-editor" element={<VideoEditor embedded session={editorSession} />} />

   // Çıkış yaparken paylaşılan varsayılan oturumu boşaltmak için:
   resetDefaultEditorSession();
   ```

Host uygulamanın `package.json` ve `components.json` dosyaları paylaşılırsa bileşen sürümleri ve takma adlar
birebir hizalanabilir.

## Test ve CI

```bash
npm install
npx playwright install chromium
npm run lint          # ESLint (typescript-eslint, react-hooks, react-refresh)
npm run build         # tsc + vite build
npm test              # Playwright duman testi (dist/ üzerinden)
```

Aynı adımlar GitHub Actions üzerinde her push ve pull request için otomatik çalışır (`.github/workflows/ci.yml`);
ekran görüntüsü ve dışa aktarılan örnek video iş akışı çıktısı olarak yüklenir.

Test, üretim derlemesini yerel bir sunucudan (SPA yedeği ile) başsız Chromium'da açar; deterministik fikstürler
(iki VP8 video, WAV ton, PNG) üretir, içe aktarma → yerleştirme → bölme/geri alma → fare ile sürükleme/kırpma →
oynatma/kompozit/ızgara → sesi ayırma → sahte mikrofonla seslendirme kaydı → geçişler → yazı katmanı → sağ tık
menüsü → proje kaydet/aç → dışa aktarma akışını doğrular ve çıktıyı Playwright ile gelen ffmpeg ile kontrol eder.
Çıktılar `test/output/` altına yazılır.

### Otomatik birleştirme (auto-merge)

Özel depolarda ücretsiz planda dal koruma kuralı olmadığı için GitHub'ın kendi auto-merge'i CI'yı bekleyemez.
Bu yüzden iş akışında CI'ya bağlı bir `automerge` işi vardır: **`automerge` etiketi** taşıyan ve taslak olmayan bir
pull request, test işi yeşil olur olmaz merge commit ile `main` dalına birleştirilir. Etiketi kaldırmak veya PR'ı
taslağa çevirmek otomatik birleştirmeyi durdurur.

## Desteklenen dosyalar (tüm kodekler)

Tarayıcılar yalnızca kendi derlemelerinde bulunan kodekleri açar: telifli kodekler olmadan derlenmiş Chromium
sürümleri **H.264/AAC** dosyalarını (telefon ve WhatsApp videolarının neredeyse tamamı) reddeder, HEVC/H.265,
ProRes, DivX ve WMV'yi ise hiçbir tarayıcı açmaz. Veditor bu boşluğu kendi kodek setiyle kapatır: tarayıcı bir
dosyayı çözemezse dosya **ffmpeg.wasm** ile (açık kaynak, `@ffmpeg/core`) WebM'e (VP8 + Vorbis) dönüştürülür ve
öyle eklenir. Kullanıcı yalnızca bir ilerleme bildirimi görür; başka bir işlem yapması gerekmez.

| Tür | Doğrudan açılanlar | Otomatik dönüştürülenler |
| --- | --- | --- |
| Video | WebM (VP8/VP9/AV1), MP4/MOV (H.264 + AAC, tarayıcı destekliyorsa) | H.264/AAC (desteklenmiyorsa), HEVC/H.265, ProRes, MPEG-2 (.mts/.m2ts), AVI/DivX, WMV, FLV, 3GP, VOB, MXF |
| Ses | MP3, WAV, M4A/AAC, OGG/Opus, FLAC | WMA, AC3, AMR, AIFF, CAF |
| Görsel | PNG, JPEG, GIF, WebP, AVIF, SVG | — (HEIC/HEIF dönüştürülmez) |

**Nasıl çalışır**

- Kodek çekirdeği (`ffmpeg-core.js` + `ffmpeg-core.wasm`, ~31 MB) derleme sırasında `node_modules`'tan
  `public/ffmpeg/` altına kopyalanır (`scripts/copy-ffmpeg-core.mjs`, `npm run build`/`dev` öncesinde otomatik
  çalışır) ve sitenin kendi alan adından sunulur. Dosya yoksa unpkg/jsDelivr'a düşülür.
- Çekirdek yalnızca ilk dönüştürmede indirilir, sonra tarayıcı önbelleğinde kalır; hiç dönüştürme gerekmezse
  hiç indirilmez. Her dağıtımdan sonra çekirdeğin sitede gerçekten sunulduğu HTTP ile denetlenir.
- Dönüştürme tek iş parçacıklı WebAssembly'de çalışır: kabaca gerçek zamanın 0,5–1 katı hızında ilerler
  (6 saniyelik klip ≈ 4 saniye). Görüntü en fazla 1080p'ye ölçeklenir ve 8 bit 4:2:0'a çevrilir (HDR/10 bit
  kaynaklar için gerekli). Bildirimde geçen ve tahmini süre görünür; uzun dönüşümler **İptal** ile durdurulabilir.
- Bir deneme başarısız olursa sırayla daha ucuz ayarlarla tekrar denenir: 1080p → 720p → yalnızca video
  (ses akışı çevrilemiyorsa). Bellek hatasından sonra kodek çekirdeği sıfırlanır, böylece sonraki dosya
  önceki çöküşten etkilenmez. Çıktıda görüntü akışı yoksa ya da dosya boşsa bu bir hata olarak bildirilir.
- Dosya türü MIME tipinden, uzantıdan ya da (ikisi de yoksa) dosyanın ilk baytlarından belirlenir; uzantısız
  kamera dosyaları da tanınır.
- Dönüştürme de başarısız olursa bildirim nedenini söyler (bozuk dosya, okunamadı, süre doldu). 400 MB'tan büyük
  dosyalarda dalga formu çizilmez; klip yine de normal kullanılır.

### Konsol tanılaması

Her içe aktarma tarayıcıda olup bittiği için hata ayıklama bilgisi konsola yazılır (F12 → Console):

- Açılışta bir **ortam raporu**: tarayıcının çözebildiği kodekler tablosu, `blob:` oynatmanın çalışıp
  çalışmadığı, WebAssembly desteği, kodek çekirdeğine erişilip erişilemediği ve o ana kadarki CSP ihlalleri.
- Her dosya için adım adım **içe aktarma izi**: türün nasıl belirlendiği (MIME / uzantı / dosya başlığı),
  metadata sonucu, tarayıcı reddettiyse `MediaError` kodu ve mesajı, dönüştürme kararı, dönüştürme ilerlemesi
  ve sonucu, küçük resim / dalga formu sayıları. Başarısız içe aktarmalar katlanmamış bir grup olarak açılır.
- `window.veditor.diagnostics()` ile ortam raporunu istediğiniz an tekrar alabilirsiniz;
  `window.veditor` ayrıca `store`, `player`, `importFiles` ve `ffmpeg` yardımcılarını da verir.

Bir dosya açılmıyorsa konsoldaki `[veditor] import ✖ …` grubu nedeni doğrudan gösterir: kodek desteği yok,
dosya bozuk, süre doldu ya da sayfanın güvenlik politikası engelliyor.

### Güvenlik politikası (CSP)

Editör yerel dosyaları `blob:` adresleriyle oynatır, küçük resimleri `data:` olarak üretir ve kodek çekirdeğini
WebAssembly ile derler. Barındırma panellerinin sıkça eklediği `default-src 'self'` gibi dar bir
**Content-Security-Policy** bunların hepsini engeller ve hata mesajları dosya bozukmuş gibi görünür. Derlemeyle
giden `.htaccess` çalışan bir politika yazar (Apache'de `Header set`, üst düzeyde tanımlı başlığı değiştirir):

```
media-src 'self' blob: data:      img-src 'self' data: blob:
worker-src 'self' blob:           script-src ... 'wasm-unsafe-eval' blob:
```

Politika yine de engelliyorsa başlık Apache'den **sonra** ekleniyordur (CDN/proxy ya da barındırma paneli); o
zaman oradan düzeltilmelidir. Uygulama bu durumu tanır ve "sitenin güvenlik politikası engelliyor" uyarısını
gösterir; her dağıtımdan sonra sunucunun gönderdiği CSP başlığı ayrıca denetlenir.

> Lisans notu: `@ffmpeg/core` **GPL-2.0-or-later** ile dağıtılır ve bir worker içinde ayrı bir program olarak
> (ffmpeg komut satırı aracını çağırmak gibi) çalıştırılır; Veditor'un kendi kodu MIT olarak kalır. GPL
> istemeyen bir dağıtım için `public/ffmpeg/` klasörünü boş bırakıp dönüştürmeyi devre dışı bırakabilir ya da
> LGPL bir derleme (ör. libav.js) kullanabilirsiniz.

## Yayınlama (SiteGround'a dağıtım)

Uygulama statik bir derlemedir (`dist/`); SiteGround'a **FTPS** ile yüklenir. Tek bir dağıtım betiği hem yerelde hem
CI'da kullanılır: `scripts/deploy-siteground.mjs`.

### Otomatik: her commit'te

`main` dalına düşen her commit (auto-merge dahil) `.github/workflows/ci.yml` içindeki **Deploy to SiteGround** işini
tetikler: lint + derleme + uçtan uca test yeşil olduktan sonra uygulama derlenir ve yüklenir. Gerekli **repository
secrets**:

| Secret | Açıklama |
| --- | --- |
| `SITEGROUND_FTP_HOST` | FTP sunucu adresi (Site Tools → Site → FTP Accounts'ta gösterilir) |
| `SITEGROUND_FTP_USER` | FTP kullanıcı adı |
| `SITEGROUND_FTP_PASSWORD` | FTP parolası |
| `SITEGROUND_REMOTE_DIR` | Hedef klasör, örn. `public_html` ya da `public_html/veditor` (FTP hesabının kök dizinine göre) |
| `SITEGROUND_FTP_PORT` | `21` (FTP / açık FTPS) |

İsteğe bağlı ayarlar (repository **variable** ya da **secret** olarak, ikisi de okunur): `SITEGROUND_SITE_URL` (yayın adresi; verilirse yükleme sonrası ana sayfa,
`assets/` dosyaları ve `/video-editor` rotası HTTP ile doğrulanır), `SITEGROUND_BASE_PATH` (uygulama alt klasörde
yayınlanıyorsa URL **yolu**, örn. `/veditor/`; site kökündeyse hiç eklemeyin, tam adres yazılırsa yalnızca yol kısmı
kullanılır), `SITEGROUND_FTP_SECURE` (`true` = açık FTPS, varsayılan; `false` = düz FTP; `implicit` = örtük FTPS),
`SITEGROUND_VERIFY` (`auto` = varsayılan: yanlış/eksik dosya işi kırmızı yapar, SiteGround bot korumasının 202 ara sayfası yalnızca
uyarır; `strict` = her hata kırmızı; `warn` = yalnızca uyar; `off` = kontrol yok). İş elle de başlatılabilir (Actions → CI → Run workflow).

### Elle: `npm run deploy`

```bash
cp .env.deploy.example .env.deploy   # değerleri doldurun (.env.deploy git'e girmez)
npm run deploy:dry                   # derler, nelerin yükleneceğini/silineceğini gösterir, değişiklik yapmaz
npm run deploy                       # derler ve yükler
```

Betik `dist/` içeriğini yükler (önce varlıklar, en son `index.html`; böylece ziyaretçi eksik varlığa işaret eden bir
sayfa görmez), `assets/` altında artık kullanılmayan eski paketleri siler (`--no-prune` ile kapatılır), geçici ağ
hatalarında yeniden dener ve `SITEGROUND_SITE_URL` verilmişse yayını HTTP üzerinden doğrular. Derlemeyle birlikte
gelen `public/.htaccess` SPA yönlendirmesini (`/video-editor` → `index.html`), önbellek başlıklarını ve MIME
türlerini ayarlar; hedef klasör bu uygulamaya ayrılmış olmalıdır.

## Sınırlamalar

- Dışa aktarma gerçek zamanlıdır (MediaRecorder); arka plandaki sekmelerde kare üretimi durur.
- MP4 çıktısı yalnızca tarayıcı `MediaRecorder` ile `video/mp4` destekliyorsa listelenir (Chrome 126+ birçok platformda destekler).
- Proje dosyası medya içermez; açarken dosyalar ada göre yeniden eşleştirilir.
- Hız değiştirme (yavaş/hızlı çekim) bu sürümde yoktur.

## Lisans

MIT
