# Liquid Glass Follow Button

Premiere Pro MOGRT'si **Quick Edit Pro — Liquid Glass Lower Third 10**'daki sıvı cam takip
butonunun saf HTML5 + CSS3 + SVG filtreleri + Web Animations API ile yeniden yapımı.
Referans video: [How to Create a Liquid Glass Follow Button in Premiere Pro (2026)](https://www.youtube.com/watch?v=-OAhOtf_rLs)

## Çalıştırma

Build gerekmez. `index.html`'i tarayıcıda açın (çift tıklama yeterli; scriptler ES modülü
olmadığından `file://` üzerinden de çalışır). En iyi sonuç için Chromium tabanlı tarayıcı
kullanın: SVG kırılması (`backdrop-filter: url(#liquid-refraction)`) yalnızca Chrome/Edge/OBS'de
çizilir; Firefox/Safari'de blur + saturate ile zarifçe geriler.

## Zaman çizelgesi (5.5 sn, 30 fps)

| Faz | Aralık | Ne olur |
| --- | --- | --- |
| **Intro** | 0.0–1.0 s | 96×88 cam damla belirir, yay eğrisiyle (CSS `linear()` spring) 440 px'e açılır; metin ve buton bulanıktan netleşir |
| **Idle** | 1.0–4.0 s | Diyagonal ışık yansıması geçer; 2.7 sn'de (isteğe bağlı) imleç `Follow`'a basar → ripple + `Following ✓` |
| **Outro** | 4.0–5.5 s | İçerik solar, kapsül hızla 44×88 dikey kapsüle büzülür ve kaybolur |

Morph fazlarında ve her tıklamada `feDisplacementMap` şiddeti anlık yükselir (sıvı dalgalanma).

## Kontroller

**Transport:** Başa sar, Oynat/Duraklat, faz bazında Intro / Idle / Outro, Full Loop.
Timeline şeridi sürüklenerek scrub edilir.

**Klavye:** `Space` oynat/duraklat · `1` `2` `3` faz · `L` tam döngü · `F` follow ·
`Home` başa · timeline odaktayken `←` `→` 1 kare (`Shift` ile 10 kare), `End` sona.

**Properties paneli:**

- **Text** — Text 1 (isim), Text 2 (unvan), Text 3 (buton) ve takip edildi metni
- **Liquid Glass** — Glass Blur, Refraction, Rim Intensity, Glass Tint, Pill Width, Pill Radius
- **Background** — OLED Siyah / Renkli Mesh / OBS Şeffaf
- **Motion** — Döngü, otomatik tıklama, azaltılmış hareket simülasyonu
- **Export · OBS Overlay** — mevcut ayarlarla şeffaf overlay bağlantısını kopyalar

## OBS / canlı yayın

`index.html?overlay=1` yalnızca bileşeni şeffaf arka planla, 1080p ölçüsünde gösterir ve
döngüde oynatır. Inspector'daki **Export · OBS Overlay** bölümü tüm özelleştirmeleri içeren
bağlantıyı üretir. OBS'de *Browser Source* ekleyin, **Local file** kutusunu işaretlemeden
bağlantıyı URL alanına yapıştırın, boyutu 1920×1080 yapın.

Desteklenen URL parametreleri: `name`, `title`, `button`, `buttonActive`, `blur`, `refraction`,
`rim`, `tint`, `width`, `radius`, `background` (`oled|mesh|transparent`), `loop`, `autoFollow`
(`1|0`), `overlay=1`. Sayılar kaydırıcı sınırlarına sıkıştırılır, geçersiz değerler yok sayılır.

## Erişilebilirlik

- `prefers-reduced-motion: reduce` canlı izlenir; açıkken boyut/konum animasyonu, ışık geçişi,
  imleç, jöle, dalga ve kırılma artışı kapanır, yalnızca solma geçişleri kalır. Panelden
  simüle edilebilir.
- Buton `aria-pressed` taşır, durum değişimi canlı bölgeyle duyurulur, klavye ile
  tetiklenebilir; gizliyken `visibility: hidden` olduğu için odaklanamaz.
- Timeline şeridi `role="slider"` olarak klavyeyle kullanılabilir.

## Yapı

```
index.html                     SVG filtre, sahne, transport, timeline, inspector
src/styles/base.css            Premiere tarzı uygulama kabuğu + overlay modu
src/styles/liquid-glass.css    Cam bileşeni: değişkenler, bevel/rim, sheen, buton, ripple
src/js/LiquidGlassTimeline.js  WAAPI master timeline, faz oynatıcıları, ripple
src/js/StudioInspector.js      Properties paneli bağlama, URL parametreleri, OBS bağlantısı
src/js/main.js                 Orkestrasyon, follow durumu, scrub, klavye
```

Geliştirme kuralları için [CLAUDE.md](CLAUDE.md)'ye bakın.
