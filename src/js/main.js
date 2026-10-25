/* main.js — Orkestrasyon: timeline + inspector + follow durumu + transport + scrub + klavye + OBS overlay. */
(function () {
  'use strict';

  const { LiquidGlassTimeline, StudioInspector } = window;
  const { PHASES, DURATION, FPS } = LiquidGlassTimeline;
  const $ = (sel) => document.querySelector(sel);
  const docEl = document.documentElement;
  const params = new URLSearchParams(location.search);
  const isOverlay = params.get('overlay') === '1';

  const els = {
    stage: $('#stage'),
    wrap: $('#lowerThird'),
    pill: $('#lgPill'),
    text: $('#lgText'),
    title: $('#lgTitle'),
    subtitle: $('#lgSubtitle'),
    button: $('#lgFollow'),
    label: $('#lgFollowLabel'),
    sheen: $('#lgSheen'),
    cursor: $('#lgCursor'),
    displacement: $('#lgDisplacement'),
    live: $('#srLive'),
  };

  // backdrop-filter içindeki SVG url() yalnızca Chromium'da (Chrome, Edge, OBS/CEF) çizilir
  const svgBackdrop = /Chrome\/\d+/.test(navigator.userAgent)
    && CSS.supports('backdrop-filter', 'url(#liquid-refraction)');
  docEl.classList.toggle('lg-svg-backdrop', svgBackdrop);
  docEl.classList.toggle('is-overlay', isOverlay);

  // ── Monitör ölçeği: 1080p ölçüsündeki bileşen küçük monitörde orantılı küçülür ──
  function fitLowerThird() {
    const scale = isOverlay ? 1 : Math.min(1, Math.max(0.5, els.stage.clientWidth / 1000));
    els.stage.style.setProperty('--lt-scale', scale.toFixed(3));
  }
  fitLowerThird();
  new ResizeObserver(fitLowerThird).observe(els.stage);

  // ── Çekirdek ──
  const motionQuery = matchMedia('(prefers-reduced-motion: reduce)');
  const timeline = new LiquidGlassTimeline(els, { reducedMotion: motionQuery.matches });
  const inspector = new StudioInspector($('#inspector'), {
    docEl,
    stage: els.stage,
    pill: els.pill,
    title: els.title,
    subtitle: els.subtitle,
    cursor: els.cursor,
    timeline,
  });

  const initial = inspector.fromParams(params);
  if (isOverlay && !params.has('background')) initial.background = 'transparent';
  inspector.set(initial);
  $('[data-refraction-note]').hidden = svgBackdrop;

  // ── Follow durumu ──
  let following = false;

  const labelFor = (on) => (on ? inspector.config.buttonActive : inspector.config.button);

  function setFollowing(on, { announce = true } = {}) {
    const btn = els.button;
    const from = btn.offsetWidth;
    following = on;
    els.label.textContent = labelFor(on);
    btn.classList.toggle('is-following', on);
    btn.setAttribute('aria-pressed', String(on));
    // Döngü başındaki sessiz sıfırlamada duyuru ve geçiş animasyonu yok
    if (!announce) return;
    els.live.textContent = `${inspector.config.name}: ${on ? 'takip ediliyor' : 'takipten çıkıldı'}`;
    if (timeline.reducedMotion) return;
    const to = btn.offsetWidth;
    if (from && from !== to) {
      btn.animate({ width: [`${from}px`, `${to}px`] }, { duration: 480, easing: LiquidGlassTimeline.SPRING_SNAPPY });
    }
    els.label.animate(
      { opacity: [0, 1], transform: ['translateY(5px)', 'translateY(0px)'], filter: ['blur(4px)', 'blur(0px)'] },
      { duration: 340, easing: LiquidGlassTimeline.EASE.outQuint });
  }

  function toggleFollow(clientX, clientY) {
    timeline.playRipple(clientX, clientY);
    setFollowing(!following);
  }

  els.button.addEventListener('click', (e) => {
    // Klavye ile tetiklenen tıklamada (detail 0) ripple butonun merkezinden çıkar
    const fromPointer = e.detail > 0;
    toggleFollow(fromPointer ? e.clientX : undefined, fromPointer ? e.clientY : undefined);
  });

  timeline.addEventListener('cue', ({ detail }) => {
    if (detail.name === 'autoFollow' && !following) toggleFollow();
  });

  timeline.addEventListener('loopstart', () => setFollowing(false, { announce: false }));

  // ── Hareket tercihi (sistem veya simülasyon) ──
  const motionStatus = $('[data-motion-status]');

  function applyMotion() {
    const reduce = inspector.config.motion === 'reduce' || motionQuery.matches;
    docEl.classList.toggle('reduce-motion', reduce);
    timeline.setReducedMotion(reduce);
    motionStatus.textContent = motionQuery.matches
      ? 'Sistem: "hareketi azalt" AÇIK — yalnızca solma geçişleri kullanılıyor.'
      : `Sistem: standart hareket.${reduce ? ' Simülasyon aktif — yalnızca solma geçişleri.' : ''}`;
  }

  motionQuery.addEventListener('change', applyMotion);
  applyMotion();

  inspector.addEventListener('change', ({ detail: { key } }) => {
    if (key === 'button' || key === 'buttonActive') {
      els.label.textContent = labelFor(following);
      timeline.rebuild(); // buton genişliği değişti → imleç hedefi yeniden ölçülür
    }
    if (key === 'motion') applyMotion();
  });

  // ── Transport ──
  const ui = {
    timecode: $('#timecode'),
    duration: $('#duration'),
    ruler: $('#timelineRuler'),
    track: $('#timelineTrack'),
    playhead: $('#playhead'),
    toggle: $('[data-transport="toggle"]'),
    clips: {},
  };

  const CLIP_LABELS = { intro: 'Intro · Damla → Kapsül', idle: 'Idle · Işık + Follow', outro: 'Outro · Büzülme' };

  function transport(cmd) {
    switch (cmd) {
      case 'start':
        timeline.seek(0);
        setFollowing(false, { announce: false });
        break;
      case 'toggle':
        if (!timeline.isPlaying && timeline.currentTime >= DURATION - 1) setFollowing(false, { announce: false });
        timeline.toggle();
        break;
      case 'intro':
        setFollowing(false, { announce: false });
        timeline.playIntro();
        break;
      case 'idle': timeline.playIdle(); break;
      case 'outro': timeline.playOutro(); break;
      case 'loop':
        setFollowing(false, { announce: false });
        timeline.playFullLoop();
        break;
      default: break;
    }
  }

  document.querySelectorAll('[data-transport]').forEach((btn) => {
    btn.addEventListener('click', () => transport(btn.dataset.transport));
  });

  // ── Timeline UI (PHASES sabitinden üretilir) ──
  const pct = (ms) => `${(ms / DURATION) * 100}%`;

  for (const [name, { from, to }] of Object.entries(PHASES)) {
    const clip = document.createElement('div');
    clip.className = `clip clip--${name}`;
    clip.style.left = pct(from);
    clip.style.width = `calc(${pct(to - from)} - 1px)`;
    clip.innerHTML = `<span class="clip__name">${CLIP_LABELS[name]}</span>`
      + `<span class="clip__time">${(from / 1000).toFixed(1)}–${(to / 1000).toFixed(1)} s</span>`;
    ui.track.insertBefore(clip, ui.playhead);
    ui.clips[name] = clip;
  }

  for (let ms = 0; ms <= DURATION; ms += 250) {
    const tick = document.createElement('span');
    tick.className = ms % 1000 === 0 ? 'tick tick--major' : ms % 500 === 0 ? 'tick tick--mid' : 'tick';
    tick.style.left = pct(ms);
    if (ms % 500 === 0) tick.dataset.label = `${(ms / 1000).toFixed(1)}s`;
    ui.ruler.appendChild(tick);
  }

  ui.duration.textContent = LiquidGlassTimeline.timecode(DURATION);

  timeline.addEventListener('timeupdate', ({ detail: { time, phase } }) => {
    const tc = LiquidGlassTimeline.timecode(time);
    ui.timecode.textContent = tc;
    ui.playhead.style.left = pct(time);
    ui.track.setAttribute('aria-valuenow', String(Math.round(time)));
    ui.track.setAttribute('aria-valuetext', tc);
    for (const [name, clip] of Object.entries(ui.clips)) clip.classList.toggle('is-active', name === phase);
  });

  timeline.addEventListener('statechange', ({ detail: { playing } }) => {
    ui.toggle.classList.toggle('is-playing', playing);
    ui.toggle.setAttribute('aria-label', playing ? 'Duraklat' : 'Oynat');
  });

  // Scrub: sürükleyerek veya ok tuşlarıyla kare kare
  const timeFromPointer = (e) => {
    const r = ui.track.getBoundingClientRect();
    return ((e.clientX - r.left) / r.width) * DURATION;
  };

  ui.track.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    ui.track.setPointerCapture(e.pointerId);
    ui.track.focus({ preventScroll: true });
    timeline.seek(timeFromPointer(e));
  });

  ui.track.addEventListener('pointermove', (e) => {
    if (ui.track.hasPointerCapture(e.pointerId)) timeline.seek(timeFromPointer(e));
  });

  ui.track.addEventListener('keydown', (e) => {
    const frame = 1000 / FPS;
    const step = e.shiftKey ? frame * 10 : frame;
    const delta = { ArrowLeft: -step, ArrowDown: -step, ArrowRight: step, ArrowUp: step }[e.key];
    if (delta !== undefined) timeline.seek(timeline.currentTime + delta);
    else if (e.key === 'Home') timeline.seek(0);
    else if (e.key === 'End') timeline.seek(DURATION);
    else return;
    e.preventDefault();
  });

  // ── Global kısayollar (form alanlarında devre dışı) ──
  const SHORTCUTS = { ' ': 'toggle', 1: 'intro', 2: 'idle', 3: 'outro', l: 'loop', Home: 'start' };

  document.addEventListener('keydown', (e) => {
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || isOverlay) return;
    if (e.target instanceof Element && e.target.closest('input, textarea, select, button, summary, [contenteditable]')) return;
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (key === 'f') {
      if (getComputedStyle(els.button).visibility === 'visible') toggleFollow();
    } else if (SHORTCUTS[key]) {
      transport(SHORTCUTS[key]);
    } else {
      return;
    }
    e.preventDefault();
  });

  // ── Başlat: font yüklenince ölçüleri tazele ve MOGRT'yi oynat ──
  const fontsReady = document.fonts ? document.fonts.ready : Promise.resolve();
  Promise.race([fontsReady, new Promise((r) => setTimeout(r, 1500))]).then(() => {
    timeline.rebuild();
    timeline.playFullLoop();
  });

  // Hata ayıklama ve otomasyon için
  window.liquidGlassApp = { timeline, inspector, setFollowing, get following() { return following; } };
})();
