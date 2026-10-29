/*
 * The player's views over the engine: Alder's controls (docs/controls.jpg), the pause shade, the loading overlay, the
 * Skip intro pill and the cards (Up next, "Keeps buffering", "Source failed", and Info: the shape of the picture and the way
 * to the title page, which the Info button used to open at once). A port of buildControls(), showControls(),
 * hideControls(), updateProgress(), buildLoading(), showUpNext(), showStall() and showSourceError() in PlayerActivity.kt.
 *
 * Focus here is one of our own, not the shell's focus engine: the player takes every key (the screen returns true for
 * all of them), so a class marks the focused control. That is also what Alder's dispatchKeyEvent does: it decides
 * itself which key goes where.
 *
 * createControls({ host, engine, timers, clockText, toast }) -> {
 *   el, shown(), show(focus), hide(force), key(evt) -> handled, cardOpen(), onOpenOptions, setOptionsOpen(bool), destroy()
 * }
 */
import { h } from '../lib/dom.js';
import { iconSvg } from '../ui/icons.js';
import { keyHint } from '../ui/chip.js';
import { PLAYER } from '../core/playback.js';
import { logoFor } from '../lib/images.js';
import { createBar, formatClock, formatLeft } from './bar.js';
import { PICTURE_NAMES, PICTURE } from './picture.js';

const { HIDE, SKIP } = PLAYER;
const REFRESH = 500; // ms between updates of the bar and the times (Alder's progressTask)
const DOT = '  ·  ';

/** "11:26 PM" */
export function wallClockText(date) {
  const h12 = date.getHours() % 12 || 12;
  return h12 + ':' + String(date.getMinutes()).padStart(2, '0') + ' ' + (date.getHours() < 12 ? 'AM' : 'PM');
}

/** How far a Left/Right press on the bar moves: Alder's 10 s, then 30 s and 60 s while the key is held. */
export function scrubStep(repeatCount) {
  return repeatCount < 10 ? SKIP : repeatCount < 30 ? 30000 : 60000;
}

export function createControls({ host, engine, timers = { setTimeout: (f, ms) => setTimeout(f, ms), clearTimeout: (id) => clearTimeout(id) },
  clockText = () => wallClockText(new Date()), toast = null, images = null }) {
  const { setTimeout: later, clearTimeout: cancel } = timers;
  let isShown = false;
  let focus = 'play'; // 'bar' | 'audio' | 'stream' | 'play' | 'next' | 'info'
  let hideTimer = null;
  let refreshTimer = null;
  let optionsOpen = false;
  let card = null; // { kind: 'upnext' | 'stall' | 'error', actions: [el], at }
  let playing = true;
  let repeatCount = 0;
  let destroyed = false;
  let lastLogo = null;

  // ---- the controls ----
  const topName = h('div', { class: 'pl-topname t-title on-art ellipsis' });
  const logo = h('img', { class: 'pl-logo', alt: '' });
  logo.style.display = 'none';
  const clock = h('div', { class: 'pl-clock t-2 on-art' }, clockText());
  const pauseTitle = h('div', { class: 'pl-pausetitle t-hero on-art ellipsis' });
  const pauseFacts = h('div', { class: 'pl-pausefacts t-small t-2 on-art' });
  const pauseInfo = h('div', { class: 'pl-pauseinfo' }, h('div', { class: 'caps on-art', style: { color: 'var(--tungsten)' } }, 'Paused'), pauseTitle, pauseFacts);
  pauseInfo.style.display = 'none';
  const elapsed = h('div', { class: 'pl-elapsed t-small on-art' });
  const length = h('div', { class: 'pl-length t-small on-art' });
  const bar = createBar(1728);
  bar.el.classList.add('pl-mainbar');

  const buttons = {};
  function button(id, label, icon, primary) {
    const words = h('div', { class: 'pl-btn-label t-small t-2 on-art' }, label);
    const circle = h('div', { class: 'pl-btn' + (primary ? ' primary' : ''), role: 'button', 'aria-label': label, html: iconSvg(icon) });
    const cell = h('div', { class: 'pl-cell' + (primary ? ' primary' : '') }, circle, words);
    buttons[id] = { id, cell, circle, words, label };
    return cell;
  }
  const audioCell = button('audio', 'Audio & subtitles', 'subtitles', false);
  const streamCell = button('stream', 'Change stream', 'layers', false);
  const playCell = button('play', 'Pause', 'pause', true);
  const nextCell = button('next', 'Next episode', 'next_episode', false);
  const infoCell = button('info', 'Info', 'info', false);
  nextCell.style.display = 'none';
  const row = h('div', { class: 'pl-buttons' }, audioCell, streamCell, h('div', { class: 'pl-divider' }), playCell, h('div', { class: 'pl-divider' }), nextCell, infoCell);
  const hints = h('div', { class: 'pl-hints' }, keyHint('OK', 'Play / pause'), keyHint('◀ ▶', 'Seek on the bar'));

  const controls = h('div', { class: 'pl-controls' },
    h('div', { class: 'pl-shade-top' }), h('div', { class: 'pl-shade-bottom' }),
    logo, topName, clock, pauseInfo, bar.el, elapsed, length, row, hints);

  // ---- the layers over the picture ----
  const pausedShade = h('div', { class: 'pl-pausedshade' });
  pausedShade.style.display = 'none';
  const status = h('div', { class: 'pl-status t-body on-art' });
  const loadingBar = createBar(1608);
  const loadingStart = h('div', { class: 'pl-loading-start t-small t-2 on-art' });
  const loadingLeft = h('div', { class: 'pl-loading-left t-small t-2 on-art' });
  const loading = h('div', { class: 'pl-loading' }, h('div', { class: 'pl-loading-dim' }),
    h('div', { class: 'pl-loading-center' }, h('div', { class: 'pl-ring' }), status), loadingBar.el, loadingStart, loadingLeft);
  loading.style.display = 'none';
  loadingBar.el.classList.add('pl-loadingbar');
  const skipPill = h('div', { class: 'pl-skip glass t-body bold on-art' });
  skipPill.style.display = 'none';
  const cardHost = h('div', { class: 'pl-cardhost' });

  const el = h('div', { class: 'pl-layers' }, pausedShade, controls, loading, cardHost, skipPill);
  host.appendChild(el);

  // ---- focus ----
  function order() { return ['audio', 'stream', 'play'].concat(engine.titleInfo().hasNext ? ['next'] : [], ['info']); }

  function setFocus(id) {
    focus = id;
    bar.focus(id === 'bar');
    Object.keys(buttons).forEach((k) => {
      const on = k === id;
      buttons[k].circle.classList.toggle('focus', on);
      buttons[k].words.classList.toggle('on', on);
    });
  }

  // ---- show and hide ----
  function startHide() {
    cancel(hideTimer);
    hideTimer = null;
    if (playing && isShown) hideTimer = later(() => hide(false), HIDE);
  }

  /** Brings the controls up with [id] focused (null: leaves focus where it is) and restarts the time to hide. */
  function show(id) {
    if (destroyed) return;
    cancel(hideTimer);
    if (!isShown) {
      isShown = true;
      controls.style.display = '';
      void controls.offsetWidth;
      controls.classList.add('on');
      engine.setControlsShown(true);
      if (subtitleRaise) subtitleRaise(true);
      refresh();
      setFocus(id || 'play');
    } else if (id) setFocus(id);
    startHide();
  }

  function hide(force) {
    if (!force && !playing) return;
    if (!isShown) return;
    isShown = false;
    cancel(hideTimer);
    controls.classList.remove('on');
    engine.setControlsShown(false);
    if (subtitleRaise) subtitleRaise(false);
    // opacity fades out over 250 ms; the layer stays for that long so it can fade
    later(() => { if (!isShown) controls.style.display = 'none'; }, 260);
  }
  controls.style.display = 'none';

  let subtitleRaise = null;

  // ---- progress ----
  function refresh() {
    cancel(refreshTimer);
    refreshTimer = null;
    if (destroyed) return;
    const s = engine.snapshot();
    const info = engine.titleInfo();
    if (isShown || optionsOpen) {
      const left = s.live ? '' : formatLeft(s.position, s.duration);
      if (isShown) {
        bar.set(s.position, s.position, s.live ? 0 : s.duration);
        elapsed.textContent = s.live ? 'Live' : formatClock(s.position);
        length.textContent = s.live ? '' : left;
        clock.textContent = clockText();
        const facts = engine.remainingFacts(Date.now());
        pauseFacts.textContent = [info.subtitle, facts.left, facts.ends].filter(Boolean).join(DOT);
        pauseTitle.textContent = info.title;
      }
      if (api.onProgress) api.onProgress(s, left);
    }
    if (loading.style.display !== 'none') updateLoadingBar(s);
    refreshTimer = later(refresh, REFRESH);
  }

  function updateLoadingBar(s) {
    const duration = s.live ? 0 : s.duration;
    loadingBar.set(s.position, s.position, duration);
    loadingStart.textContent = duration > 0 ? formatClock(s.position) : '';
    loadingLeft.textContent = duration > 0 ? formatLeft(s.position, duration) : '';
  }

  function showTitle() {
    const info = engine.titleInfo();
    topName.textContent = info.name;
    pauseTitle.textContent = info.title;
    nextCell.style.display = info.hasNext ? '' : 'none';
    // Alder's chain: the title's logo picture, else its name in serif type, else nothing (never an id). The name shows until
    // a logo has loaded, and comes back if the logo fails.
    const url = info.logo || logoFor(engine.params.metaId);
    if (url && url !== lastLogo && images) {
      lastLogo = url;
      images.load(logo, url, {
        urgent: true,
        onDone: () => { logo.style.display = ''; topName.style.display = 'none'; },
        onFail: () => { logo.style.display = 'none'; topName.style.display = ''; },
      });
    }
  }

  // ---- play / pause ----
  function setPlaying(on) {
    playing = on;
    buttons.play.circle.innerHTML = iconSvg(on ? 'pause' : 'play');
    buttons.play.label = on ? 'Pause' : 'Play';
    buttons.play.circle.setAttribute('aria-label', buttons.play.label);
    buttons.play.words.textContent = on ? 'Pause' : 'Play';
    pausedShade.style.display = on ? 'none' : '';
    pauseInfo.style.display = on ? 'none' : '';
    if (on) { if (isShown) startHide(); } else if (!optionsOpen && !card) show('play');
  }

  // ---- the loading overlay ----
  function setLoading(visible, message) {
    if (visible) { status.textContent = message || ''; loading.style.display = ''; updateLoadingBar(engine.snapshot()); }
    else { loading.style.display = 'none'; status.textContent = ''; }
  }

  // ---- the Skip intro pill ----
  let skipWanted = false;
  function setSkip(visible, label) {
    skipWanted = visible;
    if (visible) skipPill.textContent = label + '   OK';
    skipPill.style.display = visible && !card ? '' : 'none'; // a card sits where the pill does
  }

  // ---- the cards ----
  function closeCard() {
    card = null;
    while (cardHost.firstChild) cardHost.removeChild(cardHost.firstChild);
    if (skipWanted) skipPill.style.display = '';
  }

  function cardFocus(i) {
    if (!card) return;
    card.at = Math.max(0, Math.min(card.actions.length - 1, i));
    card.actions.forEach((a, k) => a.el.classList.toggle('focus', k === card.at));
  }

  function openCard(kind, node, actions, at = 0) {
    closeCard();
    cardHost.appendChild(node);
    skipPill.style.display = 'none';
    card = { kind, actions, at };
    cardFocus(at);
  }

  function pillAction(label, icon, run) {
    const node = h('div', { class: 'pl-pill', role: 'button' }, icon ? h('span', { class: 'icon', html: iconSvg(icon) }) : null, h('span', { class: 'label' }, label));
    return { el: node, run };
  }
  function chipAction(label, run) {
    return { el: h('div', { class: 'pl-chip', role: 'button' }, label), run };
  }

  function showUpNext(next) {
    if (isShown) hide(true);
    setLoading(false);
    const playNow = pillAction('Play now', 'play', () => engine.playNext());
    const credits = chipAction('Watch the credits', () => engine.dismissUpNext());
    const node = h('div', { class: 'pl-card pl-upnext on-art' },
      h('div', { class: 'caps', style: { color: 'var(--tungsten)' } }, 'Up next'),
      h('div', { class: 'pl-card-title t-hero' }, (next && next.title && next.title.trim()) || 'Episode ' + (next ? next.episode : '')),
      h('div', { class: 'pl-card-sub t-small t-2' }, next ? 'S' + next.season + ' E' + next.episode : ''),
      h('div', { class: 'pl-card-actions' }, playNow.el, credits.el));
    openCard('upnext', node, [playNow, credits], 0);
  }

  function showStall(data) {
    const lower = pillAction('Switch to ' + data.lower + 'p', null, () => engine.lowerQuality());
    const keep = chipAction('Keep ' + data.height + 'p', () => engine.dismissStall());
    const other = chipAction('Other sources', () => engine.changeStream());
    const node = h('div', { class: 'pl-card pl-stall' },
      h('div', { class: 'caps', style: { color: 'var(--tungsten)' } }, 'Keeps buffering'),
      h('div', { class: 'pl-card-title t-title' }, 'Switch to ' + data.lower + 'p?'),
      h('div', { class: 'pl-card-text t-small t-2' }, 'This ' + data.height + 'p source stopped 3 times in a minute. A smaller file may play more smoothly from ' + formatClock(data.position) + '.'),
      h('div', { class: 'pl-card-actions' }, lower.el, keep.el, other.el));
    openCard('stall', node, [lower, keep, other], 0);
  }

  /**
   * The Info button. Alder's opens the title page; here it first says what is on the screen, because the question people
   * have when a film "doesn't fill the screen" is whether the bars are in the file. The title page is one press further.
   */
  function showInfo() {
    if (isShown) hide(true);
    setLoading(false);
    const info = engine.titleInfo();
    const pic = engine.pictureInfo();
    const close = pillAction('Close', null, () => closeCard());
    const details = chipAction('Title page', () => engine.info());
    const shows = pic.showing === PICTURE.FILL ? 'Fill  ·  zoomed in, ' + (pic.crop ? pic.crop + '% of the picture is cut off' : 'nothing is cut off for this film')
      : pic.mode === PICTURE.FILL && pic.reason ? 'Fit  ·  Fill is not applied: ' + pic.reason
      : PICTURE_NAMES.fit + '  ·  the whole picture' + (pic.bars ? ', black bars where the shapes differ' : '');
    const source = engine.currentSource();
    const node = h('div', { class: 'pl-card pl-stall pl-info on-art' },
      h('div', { class: 'caps', style: { color: 'var(--tungsten)' } }, 'Info'),
      h('div', { class: 'pl-card-title t-title' }, info.title || info.name || ''),
      info.subtitle ? h('div', { class: 'pl-card-sub t-small t-2' }, info.subtitle) : null,
      h('div', { class: 'pl-card-text t-body' }, pic.shape ? 'Picture  ·  ' + pic.text : "Picture  ·  this file doesn't say its size"),
      pic.note ? h('div', { class: 'pl-card-text t-small t-2' }, pic.note) : null,
      h('div', { class: 'pl-card-text t-small t-2' }, 'Showing  ·  ' + shows),
      source && source.label ? h('div', { class: 'pl-card-text t-small t-3' }, 'Source  ·  ' + source.label) : null,
      h('div', { class: 'pl-card-actions' }, close.el, details.el));
    openCard('info', node, [close, details], 0);
  }

  function showSourceError() {
    const other = pillAction('Other sources', null, () => engine.changeStream());
    const node = h('div', { class: 'pl-card pl-error' },
      h('div', { class: 'caps', style: { color: 'var(--tungsten)' } }, 'Source failed'),
      h('div', { class: 'pl-card-title t-title' }, 'Try another source'),
      h('div', { class: 'pl-card-actions' }, other.el));
    openCard('error', node, [other], 0);
  }

  // ---- engine events ----
  const off = [
    engine.on('playing', (d) => setPlaying(d.playing)),
    engine.on('loading', (d) => setLoading(d.visible, d.message)),
    engine.on('started', () => { setLoading(false); showTitle(); }),
    engine.on('meta', showTitle),
    engine.on('scrub', () => { if (isShown || optionsOpen) refresh(); }),
    engine.on('skip', (d) => setSkip(d.visible, d.label)),
    engine.on('upNext', (d) => showUpNext(d.video)),
    engine.on('upNextHide', () => { if (card && card.kind === 'upnext') closeCard(); }),
    engine.on('stall', (d) => showStall(d)),
    engine.on('stallHide', () => { if (card && card.kind === 'stall') closeCard(); }),
    engine.on('sourceError', showSourceError),
    engine.on('notice', (d) => { if (toast) toast(d.message); }),
  ];
  showTitle();

  // ---- keys ----
  /** A key for the controls and cards (the options panel and the media keys are the screen's). Returns handled. */
  function key(evt) {
    const a = evt.action;
    const press = evt.type === 'press' || (evt.type === 'hold' && a === 'ok');
    if (!press) return true;
    if (!evt.repeat) repeatCount = 0; else repeatCount++;

    if (card) {
      if (a === 'back') {
        if (!evt.repeat) { if (card.kind === 'upnext') engine.dismissUpNext(); else if (card.kind === 'info') closeCard(); else engine.dismissStall(); }
        return true;
      }
      if (a === 'left') cardFocus(card.at - 1);
      else if (a === 'right') cardFocus(card.at + 1);
      else if (a === 'ok') card.actions[card.at].run();
      return true;
    }

    // Skip intro: OK jumps past it while the pill shows over the picture (the controls down).
    if (!isShown && a === 'ok' && engine.skipSegment()) return true;

    if (!isShown) {
      if (a === 'left' || a === 'right') { show('bar'); return true; }
      if (a === 'ok') { engine.togglePlay(); show('play'); return true; } // the dispatcher gives one press per OK: no wake-key bookkeeping
      if (a === 'up' || a === 'down') { show('play'); return true; }
      return false;
    }

    if (a === 'back') { if (!evt.repeat) hide(true); return true; }
    startHide(); // any key keeps them up a while longer
    if (focus === 'bar') {
      if (a === 'left') engine.scrub(-scrubStep(repeatCount));
      else if (a === 'right') engine.scrub(scrubStep(repeatCount));
      else if (a === 'down') setFocus('play');
      else if (a === 'ok') engine.togglePlay();
      return true;
    }
    const ids = order();
    const i = ids.indexOf(focus);
    if (a === 'left') setFocus(ids[Math.max(0, i - 1)]);
    else if (a === 'right') setFocus(ids[Math.min(ids.length - 1, i + 1)]);
    else if (a === 'up') setFocus('bar');
    else if (a === 'ok') activate(focus);
    return true;
  }

  function activate(id) {
    if (id === 'audio') { if (api.onOpenOptions) api.onOpenOptions(); }
    else if (id === 'stream') engine.changeStream();
    else if (id === 'play') engine.togglePlay();
    else if (id === 'next') engine.playNext();
    else if (id === 'info') showInfo();
  }

  const api = {
    el,
    shown: () => isShown,
    show, hide, key,
    cardOpen: () => !!card,
    onOpenOptions: null,
    onProgress: null,
    /** The options panel is up: the controls give way to it (Alder's openOptions hides them). */
    setOptionsOpen(on) {
      optionsOpen = !!on;
      if (on) { hide(true); controls.style.display = 'none'; refresh(); }
    },
    setSubtitleRaise(fn) { subtitleRaise = fn; },
    /** The hidden-app case: stop the timers; start() again on return. */
    refresh,
    focusId: () => focus,
    destroy() {
      destroyed = true;
      cancel(hideTimer); cancel(refreshTimer);
      off.forEach((f) => f());
      if (el.parentNode) el.parentNode.removeChild(el);
    },
  };
  refresh();
  return api;
}
