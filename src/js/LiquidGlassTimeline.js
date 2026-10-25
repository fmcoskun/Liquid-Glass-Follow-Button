/* LiquidGlassTimeline.js — MOGRT zaman çizelgesinin Web Animations API motoru.
 *
 * Tüm sekans tek bir 5.5 sn'lik "master" timeline'dır: her eleman/özellik grubu için
 * DURATION uzunluğunda, duraklatılmış bir element.animate() oluşturulur. Fazlar bu
 * timeline üzerinde aralıklardır; scrub sadece currentTime atamasıdır.
 */
(function (global) {
  'use strict';

  const DURATION = 5500;
  const FPS = 30;
  const PHASES = Object.freeze({
    intro: Object.freeze({ from: 0, to: 1000 }),
    idle: Object.freeze({ from: 1000, to: 4000 }),
    outro: Object.freeze({ from: 4000, to: 5500 }),
  });
  const AUTO_FOLLOW_AT = 2700; // imlecin Follow'a "bastığı" an
  const LOOP_GAP = 800;        // döngüde iki tekrar arasındaki boş kare süresi

  const EASE = Object.freeze({
    pop: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
    outExpo: 'cubic-bezier(0.16, 1, 0.3, 1)',
    outQuint: 'cubic-bezier(0.22, 1, 0.36, 1)',
    inOut: 'cubic-bezier(0.76, 0, 0.24, 1)',
    in: 'cubic-bezier(0.55, 0, 1, 0.45)',
    soft: 'cubic-bezier(0.45, 0, 0.55, 1)',
  });

  /** Sönümlü yay (damped harmonic oscillator) eğrisini CSS linear() easing'ine örnekler. */
  function springEasing({ stiffness = 200, damping = 17, mass = 1, samples = 64 } = {}) {
    const w0 = Math.sqrt(stiffness / mass);
    const zeta = Math.min(damping / (2 * Math.sqrt(stiffness * mass)), 0.99);
    const wd = w0 * Math.sqrt(1 - zeta * zeta);
    const settle = -Math.log(0.001) / (zeta * w0); // zarf %0.1'in altına inene kadar
    const x = (t) => 1 - Math.exp(-zeta * w0 * t) * (Math.cos(wd * t) + ((zeta * w0) / wd) * Math.sin(wd * t));
    const points = [];
    for (let i = 0; i < samples; i++) points.push(+x((settle * i) / samples).toFixed(4));
    points.push(1);
    return `linear(${points.join(', ')})`;
  }

  const hasLinearEasing = global.CSS && CSS.supports('transition-timing-function', 'linear(0, 1)');
  const SPRING = hasLinearEasing ? springEasing() : 'cubic-bezier(0.34, 1.3, 0.64, 1)';
  const SPRING_SNAPPY = hasLinearEasing ? springEasing({ stiffness: 320, damping: 24 }) : EASE.outQuint;

  const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
  const bump = (t, a, b) => (t <= a || t >= b ? 0 : Math.sin(Math.PI * ((t - a) / (b - a))));
  const px = (n) => `${n}px`;
  const removeWhenDone = (anim, node) => anim.finished.then(() => node.remove(), () => node.remove());

  /** `at` (ms) değerli kareleri master süreye yayılmış, duraklatılmış bir animasyona çevirir. */
  function track(el, frames) {
    const keyframes = frames.map(({ at, ...props }) => ({ ...props, offset: at / DURATION }));
    const anim = el.animate(keyframes, { duration: DURATION, fill: 'both' });
    anim.pause();
    return anim;
  }

  function spawn(parent, className, x, y, size) {
    const node = document.createElement('span');
    node.className = className;
    node.setAttribute('aria-hidden', 'true');
    node.style.cssText = `left:${x}px;top:${y}px;width:${size}px;height:${size}px`;
    parent.appendChild(node);
    return node;
  }

  class LiquidGlassTimeline extends EventTarget {
    /**
     * @param {{wrap: HTMLElement, pill: HTMLElement, text: HTMLElement, button: HTMLElement,
     *          sheen: HTMLElement, cursor: HTMLElement, displacement?: SVGElement}} els
     */
    constructor(els, options = {}) {
      super();
      this.el = els;
      this.width = options.width ?? 440;
      this.radius = options.radius ?? 26;
      this.refraction = options.refraction ?? 18;
      this.loop = options.loop ?? true;
      this.autoFollow = options.autoFollow ?? true;
      this.reducedMotion = !!options.reducedMotion;

      this._anims = [];
      this._state = 'idle'; // idle | playing | holding (döngü arası bekleme)
      this._range = { from: 0, to: DURATION, mode: 'full' };
      this._resolve = null;
      this._holdUntil = 0;
      this._lastT = 0;
      this._surge = 0;
      this._raf = 0;
      this._tick = this._tick.bind(this);

      this._build();
      this.seek(0);
    }

    static timecode(ms) {
      const frames = Math.round((Math.max(0, ms) / 1000) * FPS);
      const s = Math.floor(frames / FPS);
      return [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60, frames % FPS]
        .map((n) => String(n).padStart(2, '0'))
        .join(':');
    }

    get duration() { return DURATION; }

    get currentTime() {
      const t = this._anims[0] ? this._anims[0].currentTime : 0;
      return typeof t === 'number' ? t : 0;
    }

    get isPlaying() { return this._state !== 'idle'; }

    get phase() {
      const t = this.currentTime;
      if (t < PHASES.intro.to) return 'intro';
      return t < PHASES.idle.to ? 'idle' : 'outro';
    }

    // ── Faz oynatıcıları (Promise: aralık tamamlanınca true, kesilirse false) ──
    playIntro() { return this._run(PHASES.intro.from, PHASES.intro.to, 'intro'); }
    playIdle() { return this._run(PHASES.idle.from, PHASES.idle.to, 'idle'); }
    playOutro() { return this._run(PHASES.outro.from, PHASES.outro.to, 'outro'); }
    playFullLoop() { return this._run(0, DURATION, 'full'); }

    /** Transport "oynat": kaldığı yerden sona kadar (sondaysa baştan). */
    play() {
      const t = this.currentTime;
      return this._run(t >= DURATION - 1 ? 0 : t, DURATION, 'full');
    }

    pause() {
      if (this._state === 'idle') return;
      this._anims.forEach((a) => a.pause());
      this._holdUntil = 0;
      this._setState('idle');
      this._settle(false);
    }

    toggle() {
      if (!this.isPlaying) return this.play();
      this.pause();
      return Promise.resolve(false);
    }

    seek(ms) {
      this.pause();
      this._seekRaw(clamp(ms, 0, DURATION));
      this._lastT = this.currentTime;
      this._render();
    }

    setRefraction(value) {
      this.refraction = value;
      this._render();
    }

    setGeometry({ width = this.width, radius = this.radius } = {}) {
      if (width === this.width && radius === this.radius) return;
      this.width = width;
      this.radius = radius;
      this.rebuild();
    }

    setReducedMotion(on) {
      if (!!on === this.reducedMotion) return;
      this.reducedMotion = !!on;
      this.rebuild();
    }

    /** Kareleri güncel ayarlarla yeniden kurar; oynatma konumu ve durumu korunur. */
    rebuild() {
      const t = this.currentTime;
      const wasPlaying = this._state === 'playing';
      this._anims.forEach((a) => a.cancel());
      this._build();
      this._seekRaw(t);
      if (wasPlaying) this._anims.forEach((a) => a.play());
      this._render();
    }

    /** Follow tıklaması: buton içi ripple + cam yüzeyde dalga + jöle + kırılma dalgalanması. */
    playRipple(clientX, clientY) {
      const { pill, button } = this.el;
      const b = button.getBoundingClientRect();
      if (!b.width || !button.offsetWidth) return;
      const kb = b.width / button.offsetWidth; // ekran → yerel ölçek
      const x = clientX ?? b.left + b.width / 2;
      const y = clientY ?? b.top + b.height / 2;
      const dot = spawn(button, 'lg-follow__ripple', (x - b.left) / kb, (y - b.top) / kb,
        Math.hypot(button.offsetWidth, button.offsetHeight) * 2);

      if (this.reducedMotion) {
        const fade = dot.animate(
          { opacity: [0.45, 0], transform: ['translate(-50%, -50%) scale(1)', 'translate(-50%, -50%) scale(1)'] },
          { duration: 450, easing: 'ease-out' });
        removeWhenDone(fade, dot);
        return;
      }

      removeWhenDone(dot.animate(
        { opacity: [0.75, 0], transform: ['translate(-50%, -50%) scale(0)', 'translate(-50%, -50%) scale(1)'] },
        { duration: 720, easing: EASE.outQuint }), dot);

      const p = pill.getBoundingClientRect();
      const kp = p.width / pill.offsetWidth || 1;
      const wave = spawn(pill, 'lg-pill__wave', (x - p.left) / kp, (y - p.top) / kp, pill.offsetWidth * 2.2);
      removeWhenDone(wave.animate(
        { opacity: [0.9, 0], transform: ['translate(-50%, -50%) scale(0.04)', 'translate(-50%, -50%) scale(1)'] },
        { duration: 1000, easing: EASE.outExpo }), wave);

      // Master transform'un üzerine eklenir (composite: add), timeline'ı bozmaz
      pill.animate(
        { transform: ['scale(1)', 'scale(1.018, 0.965)', 'scale(0.995, 1.012)', 'scale(1)'] },
        { duration: 560, easing: 'ease-out', composite: 'add' });

      this._surge = 1.8;
      this._ensureLoop();
    }

    // ── İç işleyiş ──

    _run(from, to, mode) {
      this._settle(false);
      this._range = { from, to, mode };
      this._start();
      return new Promise((resolve) => { this._resolve = resolve; });
    }

    _start() {
      this._holdUntil = 0;
      this._seekRaw(this._range.from);
      this._lastT = this._range.from;
      this._anims.forEach((a) => a.play());
      this._setState('playing');
      this._ensureLoop();
    }

    _settle(completed) {
      const resolve = this._resolve;
      this._resolve = null;
      if (resolve) resolve(completed);
    }

    _seekRaw(ms) {
      this._anims.forEach((a) => { a.currentTime = ms; });
    }

    _emit(type, detail) {
      this.dispatchEvent(new CustomEvent(type, { detail }));
    }

    _setState(state) {
      if (state === this._state) return;
      this._state = state;
      this._emit('statechange', { state, playing: this.isPlaying });
    }

    _ensureLoop() {
      if (!this._raf) this._raf = requestAnimationFrame(this._tick);
    }

    _tick(now) {
      this._raf = 0;

      if (this._state === 'playing') {
        const t = this.currentTime;
        if (this.autoFollow && this._lastT < AUTO_FOLLOW_AT && t >= AUTO_FOLLOW_AT) {
          this._emit('cue', { name: 'autoFollow', time: t });
        }
        this._lastT = t;

        if (t >= this._range.to) {
          this._anims.forEach((a) => a.pause());
          this._seekRaw(this._range.to);
          if (this._range.mode === 'full' && this.loop) {
            this._holdUntil = now + LOOP_GAP;
            this._setState('holding');
          } else {
            this._setState('idle');
            this._settle(true);
          }
        }
      } else if (this._state === 'holding' && now >= this._holdUntil) {
        this._range = { from: 0, to: DURATION, mode: 'full' };
        this._emit('loopstart');
        this._start();
      }

      this._surge = this._surge > 0.01 ? this._surge * 0.93 : 0;
      this._render();
      if (this._state !== 'idle' || this._surge > 0) this._ensureLoop();
    }

    /** Kırılma şiddeti: morph fazlarında ve ripple sonrasında yükselir. */
    _render() {
      const t = this.currentTime;
      const energy = this.reducedMotion ? 0 : 1.3 * bump(t, 120, 1150) + 1.1 * bump(t, 4250, 5100);
      const surge = this.reducedMotion ? 0 : this._surge;
      if (this.el.displacement) {
        this.el.displacement.setAttribute('scale', (this.refraction * (1 + energy + surge)).toFixed(2));
      }
      this._emit('timeupdate', { time: t, phase: this.phase });
    }

    /** İmleç hedefi: sarmalayıcı merkezine göre butonun merkezi (yerel px). */
    _cursorTarget() {
      const { wrap, button } = this.el;
      const w = wrap.getBoundingClientRect();
      const b = button.getBoundingClientRect();
      const k = w.width / wrap.offsetWidth || 1;
      return {
        x: (b.left + b.width / 2 - (w.left + w.width / 2)) / k,
        y: (b.top + b.height / 2 - (w.top + w.height / 2)) / k,
      };
    }

    _build() {
      const { pill, text, button, sheen, cursor } = this.el;
      const T = DURATION;
      const W = px(this.width);
      const R = px(this.radius);

      if (this.reducedMotion) {
        // Yalnızca opacity: boyut, konum, ışık geçişi ve imleç hareketi yok
        this._anims = [
          track(pill, [{ at: 0, width: W, borderRadius: R }, { at: T, width: W, borderRadius: R }]),
          track(pill, [
            { at: 0, opacity: 0 }, { at: 300, opacity: 1 },
            { at: 5150, opacity: 1 }, { at: T, opacity: 0 },
          ]),
          track(text, [
            { at: 0, opacity: 0 }, { at: 250, opacity: 0 }, { at: 600, opacity: 1 },
            { at: 4000, opacity: 1 }, { at: 4300, opacity: 0 }, { at: T, opacity: 0 },
          ]),
          track(button, [
            { at: 0, opacity: 0, visibility: 'hidden' }, { at: 250, opacity: 0, visibility: 'hidden' },
            { at: 600, opacity: 1, visibility: 'visible' }, { at: 4000, opacity: 1, visibility: 'visible' },
            { at: 4300, opacity: 0, visibility: 'hidden' }, { at: T, opacity: 0, visibility: 'hidden' },
          ]),
          track(sheen, [{ at: 0, opacity: 0 }, { at: T, opacity: 0 }]),
          track(cursor, [{ at: 0, opacity: 0 }, { at: T, opacity: 0 }]),
        ];
        return;
      }

      const c = this._cursorTarget();
      const aim = (dx, dy, s = 1) => `translate(${(c.x + dx).toFixed(1)}px, ${(c.y + dy).toFixed(1)}px) scale(${s})`;

      this._anims = [
        // Faz 1: 96×88 damla → yay eğrisiyle tam kapsül. Faz 3: hızla 44×88 dikey kapsüle büzülme
        track(pill, [
          { at: 0, width: '96px', borderRadius: '44px' },
          { at: 260, width: '96px', borderRadius: '44px', easing: SPRING },
          { at: 1000, width: W, borderRadius: R },
          { at: 4300, width: W, borderRadius: R, easing: EASE.inOut },
          { at: 4950, width: '44px', borderRadius: '22px' },
          { at: T, width: '44px', borderRadius: '22px' },
        ]),
        // Damlanın belirmesi, açılırken sıvı esnemesi (hacim korunumu), sonda kaybolma
        track(pill, [
          { at: 0, opacity: 0, transform: 'scale(0.2)', easing: EASE.pop },
          { at: 300, opacity: 1, transform: 'scale(1)', easing: EASE.soft },
          { at: 560, opacity: 1, transform: 'scale(1.015, 0.93)', easing: EASE.soft },
          { at: 820, opacity: 1, transform: 'scale(0.995, 1.025)', easing: EASE.soft },
          { at: 1000, opacity: 1, transform: 'scale(1)' },
          { at: 4300, opacity: 1, transform: 'scale(1)', easing: EASE.soft },
          { at: 4800, opacity: 1, transform: 'scale(0.97, 1.06)', easing: EASE.outQuint },
          { at: 4950, opacity: 1, transform: 'scale(1)', easing: EASE.in },
          { at: 5400, opacity: 0, transform: 'scale(0.35)' },
          { at: T, opacity: 0, transform: 'scale(0.35)' },
        ]),
        // Metinler: odak dışından netleşerek gelir, outro'da önce solar
        track(text, [
          { at: 0, opacity: 0, transform: 'translateX(-14px)', filter: 'blur(8px)' },
          { at: 580, opacity: 0, transform: 'translateX(-14px)', filter: 'blur(8px)', easing: EASE.outQuint },
          { at: 950, opacity: 1, transform: 'translateX(0px)', filter: 'blur(0px)' },
          { at: 4000, opacity: 1, transform: 'translateX(0px)', filter: 'blur(0px)', easing: 'ease-in' },
          { at: 4280, opacity: 0, transform: 'translateX(-6px)', filter: 'blur(6px)' },
          { at: T, opacity: 0, transform: 'translateX(-6px)', filter: 'blur(6px)' },
        ]),
        // Buton: gizliyken visibility:hidden → tıklanamaz ve odaklanamaz
        track(button, [
          { at: 0, opacity: 0, transform: 'scale(0.75)', filter: 'blur(8px)', visibility: 'hidden' },
          { at: 660, opacity: 0, transform: 'scale(0.75)', filter: 'blur(8px)', visibility: 'hidden', easing: EASE.pop },
          { at: 1000, opacity: 1, transform: 'scale(1)', filter: 'blur(0px)', visibility: 'visible' },
          { at: 3960, opacity: 1, transform: 'scale(1)', filter: 'blur(0px)', visibility: 'visible', easing: 'ease-in' },
          { at: 4240, opacity: 0, transform: 'scale(0.88)', filter: 'blur(6px)', visibility: 'hidden' },
          { at: T, opacity: 0, transform: 'scale(0.88)', filter: 'blur(6px)', visibility: 'hidden' },
        ]),
        // Faz 2: diyagonal ışık yansıması
        track(sheen, [
          { at: 0, transform: 'translateX(-150%) skewX(-20deg)' },
          { at: 1450, transform: 'translateX(-150%) skewX(-20deg)', easing: EASE.soft },
          { at: 2550, transform: 'translateX(360%) skewX(-20deg)' },
          { at: T, transform: 'translateX(360%) skewX(-20deg)' },
        ]),
        // Faz 2: otomatik tıklama imleci (sadece autoFollow açıkken görünür)
        track(cursor, [
          { at: 0, opacity: 0, transform: aim(110, 70) },
          { at: 2000, opacity: 0, transform: aim(110, 70), easing: EASE.outQuint },
          { at: 2550, opacity: 1, transform: aim(4, 6) },
          { at: 2640, opacity: 1, transform: aim(4, 6), easing: EASE.soft },
          { at: 2710, opacity: 1, transform: aim(4, 6, 0.82), easing: EASE.soft },
          { at: 2820, opacity: 1, transform: aim(4, 6) },
          { at: 3250, opacity: 1, transform: aim(4, 6), easing: EASE.in },
          { at: 3650, opacity: 0, transform: aim(80, 60) },
          { at: T, opacity: 0, transform: aim(80, 60) },
        ]),
      ];
    }
  }

  Object.assign(LiquidGlassTimeline, { DURATION, FPS, PHASES, AUTO_FOLLOW_AT, EASE, SPRING, SPRING_SNAPPY, springEasing });
  global.LiquidGlassTimeline = LiquidGlassTimeline;
})(window);
