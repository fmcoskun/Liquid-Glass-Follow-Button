# Liquid Glass Follow Button — Geliştirme Kuralları

Premiere Pro MOGRT'si "Liquid Glass Lower Third 10" (Quick Edit Pro) takip butonunun
vanilla web yeniden yapımı. Build adımı yok; `index.html` doğrudan tarayıcıda veya OBS
Browser Source içinde açılır.

## Dizin yapısı

```
index.html                     SVG filtre (#liquid-refraction), sahne, transport, timeline, inspector işaretlemesi
src/styles/base.css            Uygulama kabuğu: Premiere tarzı paneller, monitör, timeline, inspector, overlay modu
src/styles/liquid-glass.css    Sadece bileşen: kapsül, bevel/rim ışıkları, sheen, Follow butonu, ripple, cursor
src/js/LiquidGlassTimeline.js  WAAPI motoru: tek 5.5 sn master timeline, playIntro/Idle/Outro/FullLoop, ripple
src/js/StudioInspector.js      Properties paneli ↔ config bağlama, URL parametreleri, OBS bağlantısı
src/js/main.js                 Orkestrasyon: follow durumu, transport, scrub, klavye, reduced-motion, overlay
```

## Kurallar

- **Bağımlılık ve build yok.** Vanilla HTML/CSS/JS. Yalnızca Google Fonts (Inter) harici kaynaktır.
- **ES modülü kullanma.** `file://` ve OBS "Local file" kaynaklarında `type="module"` CORS ile
  engellenir. Her script bir IIFE'dir, `window` üzerine tek bir global bırakır ve `defer` ile
  şu sırayla yüklenir: `LiquidGlassTimeline.js` → `StudioInspector.js` → `main.js`.
- **Zaman çizelgesi tek kaynaktır.** Faz sınırları `LiquidGlassTimeline.PHASES` içindedir
  (intro 0–1000, idle 1000–4000, outro 4000–5500 ms). Timeline UI, cue'lar ve dokümantasyon
  bu sabitten türetilir; sayıları başka yerde kopyalama.
- **Master timeline modeli.** Her eleman/özellik grubu için `DURATION` uzunluğunda tek bir
  duraklatılmış `element.animate()` vardır (`fill: 'both'`, `at` ms → `offset`). Oynatma =
  aynı `currentTime`'dan `play()`; scrub = `currentTime` ataması. Faz oynatıcıları sadece
  aralık seçer. Geometri/hareket ayarı değişince `rebuild()` çağrılır, `currentTime` korunur.
- **WAAPI'nin sahip olduğu özellikler:** kapsülde `width`, `border-radius`, `transform`,
  `opacity`; metin/butonda `opacity`, `transform`, `filter` (+ butonda `visibility`). Bu
  özellikleri CSS hover/transition ile değiştirme — `fill` CSS'i ezer. Hover efektleri
  `background-color`/`box-shadow` ile yapılır.
- **Ek animasyonlar master'ı bozmaz:** ripple jöle efekti `composite: 'add'` kullanır.
- **Kırılma (refraction):** `backdrop-filter: … url(#liquid-refraction)` yalnızca Chromium'da
  çizilir; `main.js` bunu algılayıp `<html>`'e `lg-svg-backdrop` sınıfını ekler. Diğer
  tarayıcılarda yalnızca blur + saturate kalır. Şiddet `feDisplacementMap@scale` üzerinden
  rAF ile sürülür (morph fazlarında ve ripple'da artar), boşta rAF çalışmaz.
- **Erişilebilirlik zorunlu:** `prefers-reduced-motion` (veya inspector'daki simülasyon)
  açıkken timeline yalnızca opacity fade'lerinden oluşan alternatif keyframe'lerle kurulur;
  sheen, cursor, jöle, dalga ve kırılma artışı kapanır. Buton `aria-pressed` taşır, durum
  değişimi `#srLive` ile duyurulur, gizliyken `visibility: hidden` olur (odaklanamaz).
- **Ölçek:** Kapsül piksel değerleri MOGRT'nin 1080p ölçüsüdür. Monitör küçüldüğünde
  `.lower-third` sarmalayıcısı `--lt-scale` ile küçülür; kapsülün kendi `transform`'una dokunma.
  Ekran → yerel koordinat çevirisi için `getBoundingClientRect().width / offsetWidth` oranı kullan.
- **Yorum dili Türkçe, tanımlayıcılar İngilizce.**

## Doğrulama

Test altyapısı yok. Değişiklikten sonra `index.html`'i Chromium tabanlı bir tarayıcıda aç ve
kontrol et: konsol hatasız, Intro/Idle/Outro/Full Loop, scrub, Follow ripple + `Following ✓`,
tüm inspector kontrolleri, üç arka plan modu, reduced-motion simülasyonu, `?overlay=1`.
