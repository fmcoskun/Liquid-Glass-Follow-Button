/* StudioInspector.js — Premiere "Properties" paneli: kontroller ↔ config ↔ canlı bileşen.
 *
 * Görsel özellikleri (metin, CSS değişkenleri, arka plan, kırılma, geometri) doğrudan
 * uygular. Takip durumuna veya sistem tercihine bağlı anahtarlar (button, buttonActive,
 * motion) için yalnızca 'change' olayı yayar; onları main.js uygular.
 */
(function (global) {
  'use strict';

  const DEFAULTS = Object.freeze({
    name: 'Quick Edit Pro',
    title: 'video editor',
    button: 'Follow',
    buttonActive: 'Following ✓',
    blur: 18,
    refraction: 18,
    rim: 1,
    tint: 0.42,
    width: 440,
    radius: 26,
    background: 'mesh',
    loop: true,
    autoFollow: true,
    motion: 'system',
  });

  const CHOICES = Object.freeze({
    background: ['oled', 'mesh', 'transparent'],
    motion: ['system', 'reduce'],
  });

  // OBS bağlantısında taşınmayan, ortama özgü anahtarlar
  const LOCAL_ONLY = new Set(['background', 'motion']);

  class StudioInspector extends EventTarget {
    /**
     * @param {HTMLElement} root  Inspector paneli
     * @param {{docEl: HTMLElement, stage: HTMLElement, pill: HTMLElement, title: HTMLElement,
     *          subtitle: HTMLElement, cursor: HTMLElement, timeline: LiquidGlassTimeline}} graphic
     */
    constructor(root, graphic) {
      super();
      this.root = root;
      this.graphic = graphic;
      this.config = { ...DEFAULTS };

      const onInput = (e) => this._onInput(e);
      root.addEventListener('input', onInput);
      root.addEventListener('change', onInput);
      root.querySelector('[data-action="reset"]')?.addEventListener('click', () => this.reset());
      root.querySelector('[data-action="copy-obs"]')?.addEventListener('click', () => this.copyShareUrl());

      for (const key of Object.keys(DEFAULTS)) this._commit(key, DEFAULTS[key], true);
    }

    static get DEFAULTS() { return DEFAULTS; }

    /** Ham değeri (input veya URL) doğrular; geçersizse undefined döner. */
    parse(key, raw) {
      if (!(key in DEFAULTS)) return undefined;
      const fallback = DEFAULTS[key];

      if (typeof fallback === 'boolean') {
        return raw === true || raw === 'true' || raw === '1' || raw === 'on';
      }
      if (typeof fallback === 'number') {
        const n = Number(raw);
        if (raw === '' || raw === null || !Number.isFinite(n)) return undefined;
        const slider = this._slider(key);
        return slider ? Math.min(Number(slider.max), Math.max(Number(slider.min), n)) : n;
      }
      if (CHOICES[key]) return CHOICES[key].includes(raw) ? raw : undefined;
      return String(raw).slice(0, 40);
    }

    fromParams(params) {
      const patch = {};
      for (const key of Object.keys(DEFAULTS)) {
        if (!params.has(key)) continue;
        const value = this.parse(key, params.get(key));
        if (value !== undefined) patch[key] = value;
      }
      return patch;
    }

    set(patch) {
      for (const [key, value] of Object.entries(patch)) this._commit(key, value, true);
    }

    reset() {
      this.set(DEFAULTS);
    }

    /** Mevcut ayarlarla şeffaf, yalnızca bileşeni gösteren OBS Browser Source bağlantısı. */
    shareUrl() {
      const url = new URL(global.location.href);
      url.search = '';
      url.hash = '';
      for (const [key, value] of Object.entries(this.config)) {
        if (LOCAL_ONLY.has(key) || value === DEFAULTS[key]) continue;
        url.searchParams.set(key, typeof value === 'boolean' ? (value ? '1' : '0') : value);
      }
      url.searchParams.set('background', 'transparent');
      url.searchParams.set('overlay', '1');
      return url.toString();
    }

    async copyShareUrl() {
      const field = this.root.querySelector('[data-share-url]');
      const status = this.root.querySelector('[data-share-status]');
      const url = this.shareUrl();
      if (field) field.value = url;
      let copied = false;
      try {
        await navigator.clipboard.writeText(url);
        copied = true;
      } catch {
        // file:// veya izin yoksa: eski yöntem
        if (field) {
          field.select();
          copied = document.execCommand('copy');
        }
      }
      if (status) status.textContent = copied ? 'Bağlantı panoya kopyalandı ✓' : 'Panoya erişilemedi — bağlantıyı elle kopyalayın.';
    }

    // ── İç işleyiş ──

    _slider(key) {
      return this.root.querySelector(`input[type="range"][data-key="${key}"]`);
    }

    _onInput(e) {
      const input = e.target.closest('[data-key]');
      if (!input || !this.root.contains(input)) return;
      if (input.type === 'radio' && !input.checked) return;
      const raw = input.type === 'checkbox' ? input.checked : input.value;
      const value = this.parse(input.dataset.key, raw);
      if (value !== undefined) this._commit(input.dataset.key, value, false);
    }

    _commit(key, value, syncControls) {
      const changed = this.config[key] !== value;
      this.config[key] = value;
      this._apply(key, value);
      if (syncControls) this._syncControls(key, value);
      this._syncOutput(key, value);
      const field = this.root.querySelector('[data-share-url]');
      if (field) field.value = this.shareUrl();
      if (changed) this.dispatchEvent(new CustomEvent('change', { detail: { key, value, config: { ...this.config } } }));
    }

    _apply(key, value) {
      const g = this.graphic;
      const css = g.docEl.style;
      switch (key) {
        case 'name':
          g.title.textContent = value;
          g.pill.setAttribute('aria-label', `${value || 'Kanal'} — takip bandı`);
          break;
        case 'title': g.subtitle.textContent = value; break;
        case 'blur': css.setProperty('--glass-blur', `${value}px`); break;
        case 'rim': css.setProperty('--rim-intensity', String(value)); break;
        case 'tint': css.setProperty('--glass-tint', String(value)); break;
        case 'width':
          css.setProperty('--pill-width', `${value}px`);
          g.timeline.setGeometry({ width: value });
          break;
        case 'radius':
          css.setProperty('--pill-radius', `${value}px`);
          g.timeline.setGeometry({ radius: value });
          break;
        case 'refraction': g.timeline.setRefraction(value); break;
        case 'background': g.stage.dataset.bg = value; break;
        case 'loop': g.timeline.loop = value; break;
        case 'autoFollow':
          g.timeline.autoFollow = value;
          g.cursor.hidden = !value;
          break;
        default: break; // button, buttonActive, motion → main.js
      }
    }

    _syncControls(key, value) {
      this.root.querySelectorAll(`[data-key="${key}"]`).forEach((input) => {
        if (input.type === 'checkbox') input.checked = value;
        else if (input.type === 'radio') input.checked = input.value === value;
        else if (input.value !== String(value)) input.value = value;
      });
    }

    _syncOutput(key, value) {
      const out = this.root.querySelector(`[data-out="${key}"]`);
      if (out) out.textContent = `${Number(value).toFixed(Number(out.dataset.decimals || 0))}${out.dataset.unit || ''}`;
      const slider = this._slider(key);
      if (slider) {
        const min = Number(slider.min);
        const pct = ((value - min) / (Number(slider.max) - min)) * 100;
        slider.style.setProperty('--fill', `${pct}%`);
      }
    }
  }

  global.StudioInspector = StudioInspector;
})(window);
