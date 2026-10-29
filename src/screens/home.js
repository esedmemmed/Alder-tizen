/*
 * Home (Alder's MainActivity): the profile in use, as a cinema rather than a catalogue. The whole screen is one title's art,
 * sharp where nothing sits on it, with light shading behind the words and the cards (docs/home-dune.png, library.png).
 *
 *  - Browse (every page): one row of poster cards along the bottom, the focused title's logo, facts and description top left.
 *    Down and up slide whole rows in; Home opens on Continue Watching.
 *  - Pages in the top pill: Home, Shows, Movies, My List (Live exists for `params.page` but has no pill, as in Alder). A page opens
 *    when the remote has rested on its name for SWITCH_WAIT; OK on a page's name goes down into it. Search is the pill's icon.
 *  - Shows and Movies end with genre rows; the chips above jump to them. My List is a grid with filter and sort chips.
 *  - Saved answers draw first and fresh ones replace them (Alder's savedX pattern), so a page is not blank while the network answers.
 *
 *   router.push('home', { page? })
 *
 * Not ported, because Alder has them switched off or they do not exist on this TV: the cinema screensaver and the idle dim (Alder:
 * "off, not wanted yet"), Android TV's Watch Next channel (DECISIONS.md), the update offer (Apps2Samsung updates the app).
 *
 * The page is built from data and only the row in use (and the ones beside it) has cards in the DOM: PLAN.md's budget for this TV.
 * Rows are `entries`: { key, order, title, items, more, selected, row }. `row` is the mounted createRow, or null.
 */
import { h, clear } from '../lib/dom.js';
import { iconSvg } from '../ui/icons.js';
import { createRow } from '../ui/row.js';
import { createCard, disposeCard } from '../ui/card.js';
import { chip } from '../ui/chip.js';
import { pill } from '../ui/button.js';
import { openPanel } from '../ui/panel.js';
import { createArt } from '../ui/art.js';
import { runClock } from '../app/clock.js';
import { logoFor, sharp } from '../lib/images.js';
import { log as appLog } from '../lib/log.js';
import { ApiException, NO_SESSION } from '../core/stremio.js';
import * as M from '../app/home-model.js';

const PAD = 96;
const CARD_W = 176;
const CARD_H = 264;
const CARD_GAP = 28;
const ROW_STEP = 440; // px a row takes: heading, room above the cards, the cards, room for the caption below
const GRID_W = 240;
const GRID_H = 360;
const GRID_GAP = 32;
const GRID_STEP = GRID_H + GRID_GAP + 16; // a grid row: room above for the focused poster's growth, the poster, the gap
const GRID_TOP = 544;
const WARM_AFTER = 3000; // ms after the page opens before the other pages' posters are fetched ahead
const FOCUS_TOP_WAIT = 400; // ms the rows get to answer before the remote starts on the first one
const HERO_TOP_WAIT = 150;
const COLUMNS = M.LIST_COLUMNS;

const FILTERS = [['all', 'All'], ['movies', 'Movies'], ['shows', 'Shows']];
const SORTS = [['recent', 'Recently added'], ['name', 'A–Z'], ['unwatched', 'Unwatched first']];

export function createHomeScreen(params = {}) {
  let ctx = null;
  let session = null;
  let root = null;
  let profile = null;
  let dead = false;

  let page = M.PAGES.indexOf(params.page) >= 0 ? params.page : 'Home';
  let gen = 0; // which page-load the answers belong to: late ones from an earlier page are dropped
  let library = [];
  const metas = new Map();   // title id -> Meta: full details, fetched once per title
  const answers = new Map(); // catalogAnswerKey -> [{ metas, saved }]: the rows' answers this session (and from disk)
  let entries = [];          // this page's rows, in order
  let activeEntry = null;
  let heroItem = null;
  let touched = false;       // a key was pressed since the page opened: saved copies then wait for the next visit
  let focusedSomething = false;
  let held = false;          // Left or Right is being held: the row glides instead of stepping
  let jump = false;          // OK on a page's name: go down into its rows once they are in
  let genre = null;          // the genre chip in use on Shows and Movies
  let jumpTo = null;         // a chip's row that was not made yet when OK was pressed
  let listFilter = 'all';
  let listSort = 'recent';
  let lastListChip = null;
  let grid = null;           // My List's grid: { items, rows, mounted, at }
  let loadMoreSections = null;
  let refreshLibrary = null;
  let refreshAddons = null;
  let failedShown = false;
  let emptyNote = false;     // the note says there is nothing to show (it goes once a row arrives)
  let pendingPage = page;
  const timers = {};
  const genreChips = new Map(); // genre | null -> chip
  const listChips = [];         // { kind, value, chip }
  let navItems = null;
  const pool = M.newestFirst(6, (f) => setTimeout(f, 0)); // title details, newest request first

  // ---- DOM ----
  const art = { layer: null };
  let heroEl, titleEl, nameEl, logoImg, factsEl, factsText, ratingEl, scoreEl, addedEl, aboutEl;
  let captionEl, captionText, hintEl, countEl, listHintEl, rowsEl, gridEl, gridTrack, chipsEl, noteEl, headerEl, avatarEl, searchEl, clockEl;
  let stopClock = null;
  let aboutFor = null;

  const log = () => (ctx && ctx.log) || appLog;
  const isCatalog = () => M.isCatalogPage(page);
  const inside = (el, within) => !!(el && within && within.contains(el));
  const focusedEl = () => document.activeElement;
  const timer = (name, ms, fn) => { clearTimeout(timers[name]); timers[name] = setTimeout(fn, ms); };

  // ======================================================================================================
  // the frame: art, hero, rows, caption, top bar
  // ======================================================================================================

  function build() {
    art.layer = createArt(ctx.images);
    titleEl = h('div', { class: 'hm-title' });
    nameEl = h('div', { class: 't-hero on-art hm-name' });
    logoImg = h('img', { class: 'hm-logo', alt: '' });
    titleEl.appendChild(nameEl);
    titleEl.appendChild(h('div', { class: 'hm-logobox' }, logoImg));
    factsText = h('span', { class: 'hm-facts-text' });
    ratingEl = h('span', { class: 'imdb', hidden: true }, 'IMDb');
    scoreEl = h('span', { class: 'hm-score', hidden: true });
    addedEl = h('span', { class: 'hm-added t-3', hidden: true });
    factsEl = h('div', { class: 'hm-facts t-small on-art' }, factsText, ratingEl, scoreEl, addedEl);
    aboutEl = h('div', { class: 'hm-about t-body on-art' });
    heroEl = h('div', { class: 'hm-hero' }, titleEl, factsEl, aboutEl);

    rowsEl = h('div', { class: 'hm-rows' });
    gridTrack = h('div', { class: 'hm-grid-track' });
    gridEl = h('div', { class: 'hm-grid' }, gridTrack);
    chipsEl = h('div', { class: 'hm-chips', hidden: true });
    noteEl = h('div', { class: 'hm-note' });
    captionText = h('span');
    captionEl = h('div', { class: 'caption glass hm-caption', hidden: true }, captionText);
    hintEl = h('div', { class: 'hm-next caps', hidden: true });
    countEl = h('div', { class: 't-small t-3 hm-count', hidden: true });
    listHintEl = h('div', { class: 'hm-listhint t-small t-2 glass', hidden: true }, 'Hold OK for options');

    buildHeader();
    root.appendChild(art.layer.el);
    root.appendChild(h('div', { class: 'hm-topshade' }));
    root.appendChild(heroEl);
    root.appendChild(rowsEl);
    root.appendChild(gridEl);
    root.appendChild(noteEl);
    root.appendChild(countEl);
    root.appendChild(listHintEl);
    root.appendChild(captionEl);
    root.appendChild(hintEl);
    root.appendChild(chipsEl);
    root.appendChild(headerEl);
  }

  /** The profile's round avatar (OK: switch profile, settings), every destination in one capsule with Search first, the clock. */
  function buildHeader() {
    avatarEl = h('div', { class: 'avatar', 'data-focus': '', tabindex: '-1', role: 'button', 'aria-label': 'Profile' }, profile.name.charAt(0).toUpperCase());
    avatarEl.addEventListener('click', profileMenu);
    searchEl = h('div', { class: 'nav-item nav-search', 'data-focus': '', tabindex: '-1', role: 'button', 'aria-label': 'Search' },
      h('span', { class: 'icon', html: iconSvg('search') }));
    searchEl.addEventListener('click', () => ctx.router.push('search', {}));
    navItems = new Map();
    const pill_ = h('div', { class: 'navpill glass' }, searchEl);
    M.NAV_PAGES.forEach((label) => {
      const el = h('div', { class: 'nav-item', 'data-focus': '', tabindex: '-1', role: 'tab' }, label);
      // A page opens as soon as the remote rests on its name. OK on Shows or Movies goes to its genres.
      el.addEventListener('focus', () => {
        clearTimeout(timers.switchPage);
        if (label !== page) { pendingPage = label; timers.switchPage = setTimeout(() => { if (pendingPage !== page && document.activeElement === navItems.get(pendingPage)) { jump = false; showPage(pendingPage); } }, M.SWITCH_WAIT); }
      });
      el.addEventListener('click', () => {
        clearTimeout(timers.switchPage);
        if (label !== page) { jump = true; showPage(label); return; }
        if (isCatalog() || page === 'My List') { const c = chipToFocus(); if (c) ctx.engine.focus(c.el); else focusFirstRow(); } else focusFirstRow();
      });
      navItems.set(label, el);
      pill_.appendChild(el);
    });
    clockEl = h('div', { class: 'clock' });
    stopClock = runClock(clockEl);
    headerEl = h('div', { class: 'topbar' }, avatarEl, pill_, clockEl);
    styleNav();
  }

  /** A tungsten dot marks the open page. */
  function styleNav() {
    navItems.forEach((el, label) => el.classList.toggle('on', label === page));
  }

  function profileMenu() {
    const items = ['Switch profile', 'Settings'];
    openPanel(ctx, {
      title: profile.name, items,
      onPick: (i) => { if (i === 0) ctx.router.push('profiles', { pick: true }); else ctx.router.push('settings', {}); },
    });
  }

  // ======================================================================================================
  // the hero: the focused title, top left, and its art across the screen
  // ======================================================================================================

  /** Shows [item]'s art across the screen. The poster only once it is certain there is no art: a cropped poster is blurry. */
  function showArt(item, ready) {
    const url = item.art || (item.settled ? item.poster : null);
    if (!url) return;
    art.layer.show(url, { ready });
  }

  function episodeOf(item) {
    const m = metas.get(item.id);
    return item.videoId && m ? m.videos.find((v) => v.id === item.videoId) || null : null;
  }

  function showHero(item) {
    heroItem = item;
    heroEl.classList.add('on');
    nameEl.textContent = item.name;
    titleEl.classList.remove('has-logo');
    ctx.images.load(logoImg, item.logo, { onDone() { if (heroItem === item) titleEl.classList.add('has-logo'); } });
    const meta = metas.get(item.id) || null;
    const ep = episodeOf(item);
    factsText.textContent = M.heroFacts(item, meta, ep);
    const rating = (meta && meta.rating) || (item.facts.find((f) => f.indexOf('IMDb') === 0) || '').replace(/^IMDb /, '');
    ratingEl.hidden = scoreEl.hidden = !rating;
    scoreEl.textContent = rating || '';
    // Leads with a dot only when facts or a rating sit before it (a title with no details yet showed "· Added").
    const lead = !factsText.textContent && !rating ? '' : '·  ';
    addedEl.textContent = item.addedAt ? lead + 'Added ' + M.addedAgo(item.addedAt) : '';
    addedEl.hidden = !(page === 'My List' && addedEl.textContent);
    aboutEl.hidden = page === 'My List';
    const description = (ep && ep.overview && ep.overview.trim() ? ep.overview : null) || item.about || '';
    if (!aboutEl.hidden && aboutFor !== description) { aboutFor = description; fitAbout(description); }
    if (page === 'Home' || isCatalog()) showCaption(item);
    showArt(item);
  }

  /** Two lines of description, cut at a sentence when it is too long (Alder: the layout's ellipsis, then synopsisAtSentence). */
  function fitAbout(text) {
    aboutEl.textContent = text;
    if (aboutEl.scrollHeight <= aboutEl.clientHeight + 1) return;
    let lo = 0;
    let hi = text.length;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      aboutEl.textContent = text.slice(0, mid) + '…';
      if (aboutEl.scrollHeight <= aboutEl.clientHeight + 1) lo = mid; else hi = mid - 1;
    }
    aboutEl.textContent = M.synopsisAtSentence(text, lo);
  }

  function lengthOf(item, meta) {
    if (item.type === 'series') {
      const n = new Set(((meta && meta.videos) || []).map((v) => v.season).filter((s) => s > 0)).size;
      return n > 0 ? M.seasons(n) : null;
    }
    return (meta && meta.runtime) || null;
  }

  /** The line under the focused card: time left and where it stopped, else its name and year (or length). */
  function showCaption(item) {
    const remaining = item.left ? item.left.split(M.DOT).filter((p) => /left$/.test(p)).pop() : null;
    const stop = item.stoppedAt > 0 ? 'Stopped at ' + M.elapsed(item.stoppedAt) : null;
    const meta = metas.get(item.id) || null;
    const detail = page === 'Home' ? (meta && meta.year) || item.facts.find((f) => /^\d/.test(f)) || null : lengthOf(item, meta);
    const parts = [remaining, stop].filter(Boolean);
    captionText.textContent = (parts.length ? parts : [item.name, detail].filter(Boolean)).join(M.DOT);
    captionEl.hidden = false;
    placeCaption();
  }

  /** The caption sits under the focused card, also where the row stops sliding near its end. */
  function placeCaption() {
    const e = activeEntry;
    let x = 0;
    if (e && e.row && inside(focusedEl(), rowsEl)) x = Math.max(0, e.selected * e.row.step - e.row.scroll);
    const room = 1920 - 2 * PAD - captionEl.offsetWidth;
    captionEl.style.transform = 'translate3d(' + Math.max(0, Math.min(x, room)) + 'px,0,0)';
    clearHint();
  }

  /** The next row's name and the caption share one line: a long caption that reaches the name hides it. */
  function clearHint() {
    if (hintEl.hidden || captionEl.hidden) { hintEl.style.visibility = ''; return; }
    const captionEnd = PAD + parseFloat((/translate3d\(([\d.]+)px/.exec(captionEl.style.transform) || [0, 0])[1]) + captionEl.offsetWidth;
    const hintLeft = 1920 - PAD - hintEl.offsetWidth;
    hintEl.style.visibility = captionEnd + 64 > hintLeft ? 'hidden' : '';
  }

  /** Rows below the row in use keep their names hidden (one peeking in at the bottom sat under the caption): the hint names the next. */
  function updateNextRow() {
    if (page !== 'Home' && !isCatalog()) { hintEl.hidden = true; return; }
    // No row in use (the remote is on the chips or the top bar): the row sitting in the band counts.
    const next = entries[Math.max(0, entries.indexOf(activeEntry)) + 1];
    hintEl.textContent = next ? '▾  ' + next.title.toUpperCase() : '';
    hintEl.hidden = !next;
    clearHint();
  }

  // ======================================================================================================
  // titles: details the catalog did not send, fetched once per title from the meta add-on
  // ======================================================================================================

  function fill(item) {
    if (item.filled) return;
    item.filled = true;
    const have = metas.get(item.id);
    if (have) { applyMeta(item, have); return; }
    pool.run((done) => {
      let m = null;
      try { m = session.savedMeta(item.type, item.id); } catch (e) { m = null; }
      const finish = (meta) => {
        done();
        if (dead) return;
        if (!meta) { settle(item); return; }
        metas.set(item.id, meta);
        applyMeta(item, meta);
      };
      if (m) finish(m);
      else session.meta(item.type, item.id).then(finish, () => finish(null));
    });
  }

  function applyMeta(item, m) {
    if (!item.art) item.art = m.background;
    if (!item.logo) item.logo = m.logo;
    if (!item.about) item.about = m.description || '';
    if (!item.facts.length || item.resume) item.facts = M.factsOf(m);
    settle(item);
  }

  /** [item] has all it will get: its card, the hero and whatever waited on it go ahead. */
  function settle(item) {
    item.settled = true;
    if (item.onFill) { const fns = item.onFill; item.onFill = null; fns.forEach((f) => f()); }
    if (!item.poster && item.art) pictureFor(item);
    if (heroItem === item) { aboutFor = null; showHero(item); }
  }

  /** A card whose title has no poster takes the title's art once it is known. */
  function pictureFor(item) {
    const cards = [];
    entries.forEach((e) => { if (e.row) e.items.forEach((it, i) => { if (it === item) { const c = e.row.cardAt(i); if (c) cards.push(c); } }); });
    if (grid) grid.mounted.forEach((g) => g.cards.forEach((c, i) => { if (g.items[i] === item) cards.push(c); }));
    cards.forEach((c) => ctx.images.load(c._img, sharp(item.art, 360), { onDone() { c._img.classList.add('on'); c.classList.add('has-img'); } }));
  }

  /** Gets [item]'s full-screen art ready ahead (fetching its details first if need be), so moving to it is instant. */
  function warm(item) {
    if (item.warming) return;
    item.warming = true;
    const ahead = () => { if (item.art) ctx.images.prefetch(sharp(item.art, 1920)); if (item.logo) ctx.images.prefetch(item.logo); };
    if (item.art) { ahead(); return; }
    (item.onFill = item.onFill || []).push(ahead);
    fill(item);
  }

  // ======================================================================================================
  // pages
  // ======================================================================================================

  /**
   * Opens [p]. With [quick], it draws from last time's answers kept on disk (library, add-ons, catalogs) at once and asks the
   * network behind them: catalogs refresh for the next visit, and the library replaces what is shown only if it changed and
   * the remote has not been touched yet.
   */
  function showPage(p, quick = true) {
    if (p !== page) { genre = null; jumpTo = null; chipsEl.hidden = true; clear(chipsEl); genreChips.clear(); listChips.length = 0; lastListChip = null; }
    page = p;
    const g = ++gen;
    const gridPage = p === 'My List';
    clearTimeout(timers.focusTop); clearTimeout(timers.heroTop);
    dropAll();
    clearGrid();
    noteEl.hidden = true;
    emptyNote = false;
    clear(noteEl);
    heroEl.classList.remove('on');
    heroEl.classList.toggle('grid', gridPage);
    heroItem = null;
    aboutFor = null;
    captionEl.hidden = true;
    hintEl.hidden = true;
    countEl.hidden = !gridPage;
    listHintEl.hidden = !gridPage;
    root.classList.toggle('hm-gridpage', gridPage);
    gridEl.hidden = !gridPage;
    touched = false;
    focusedSomething = false;
    loadMoreSections = null;
    refreshLibrary = null;
    failedShown = false;
    styleNav();
    // chips: My List's filter and sort now, Shows' and Movies' genres once the rows tell which are not empty
    if (gridPage) { showListChips(); chipsEl.hidden = false; } else if (isCatalog()) { chipsEl.hidden = true; } else { chipsEl.hidden = true; clear(chipsEl); genreChips.clear(); }

    const failedToLoad = (error) => {
      forgetIfSessionGone(error);
      if (failedShown || dead || page !== p || g !== gen) return;
      failedShown = true;
      noteEl.hidden = false;
      clear(noteEl);
      const again = pill('Try again', { onClick: () => showPage(page) });
      noteEl.appendChild(h('div', { class: 't-body t-2 on-art' }, "Couldn't reach Stremio. Check the TV's connection."));
      noteEl.appendChild(h('div', { class: 'hm-note-act' }, again));
      if (!focusedSomething && !inside(focusedEl(), headerEl)) ctx.engine.focus(again);
    };

    if (p === 'Home' || p === 'My List') {
      let shown = null; // what is on screen, to tell whether the fresh library changed anything
      let fresh = false;
      const show = (list, force = false) => {
        if (dead || g !== gen) return;
        const cw = session.books.continueWatching(list);
        const what = M.continueSignature(p === 'Home' ? cw : list);
        // Saved copies wait once the remote is in use; Stremio's own answer always goes in (focus stays on its title below), or a
        // stale disk copy could hide a show for the whole visit.
        if (what === shown || (shown !== null && touched && !force)) return;
        const firstShow = shown === null;
        shown = what;
        library = list;
        if (p === 'Home') {
          const was = focusedItemId();
          setContinue(cw.map(M.libraryItem), was, firstShow);
        } else rebuildLibrary(firstShow);
      };
      if (quick && library.length) show(library); // the library already in memory: no wait on a revisit
      if (quick) { const kept = session.savedLibrary(); if (kept && !fresh) show(kept); }
      const ask = () => {
        session.library({ refresh: true }).then((list) => {
          if (g !== gen) return;
          fresh = true;
          show(list, true);
        }, (error) => { if (shown === null) failedToLoad(error); else forgetIfSessionGone(error); });
      };
      ask();
      refreshLibrary = ask;
    }
    if (p === 'My List') return;

    let built = false;
    let builtFrom = null; // the add-ons the rows came from, to tell when Stremio's fresh list differs
    const buildFrom = (addons) => {
      if (built || g !== gen || dead) return;
      built = true;
      builtFrom = addons.map((a) => a.id);
      buildCatalogs(p, g, addons, quick);
    };
    if (quick) { const kept = session.savedAddons(); if (kept) buildFrom(kept); }
    // Every page asks Stremio for the add-on list once as it opens (and again when Alder comes back to the front), and redraws only
    // when the list differs from the one its rows came from: add-ons added or removed elsewhere.
    const checkAddons = (drawn) => session.addons({ refresh: true }).then((fresh) => {
      if (g !== gen || dead) return;
      if (built && builtFrom.join() !== fresh.map((a) => a.id).join()) showPage(p, false); else drawn(fresh);
    }, (error) => { if (!built && g === gen) failedToLoad(error); });
    checkAddons(buildFrom);
    refreshAddons = () => checkAddons(() => {});
  }

  /** Signed out elsewhere (or the session expired): this TV forgets the profile, which can then sign in again. */
  function forgetIfSessionGone(error) {
    if (error instanceof ApiException && error.code === NO_SESSION) {
      session.removeProfile(profile.id);
      ctx.router.reset(session.profiles.all().length ? 'profiles' : 'signin', {});
    }
  }

  // ---- catalogs ----

  function buildCatalogs(p, g, addons, quick) {
    const shelves = M.shelvesFor(p, addons);
    const catalogs = shelves.map((s) => s.catalog);
    if (!catalogs.length) {
      const what = p === 'Movies' ? 'movie' : p === 'Live' ? 'live' : 'show';
      showNote(p === 'Home'
        // Home holds only Continue and Watchly's picks, so a new account sees nothing there without a word.
        ? "Picks for you show here once Watchly is installed on this profile's Stremio account. Shows and Movies have more to browse."
        : 'None of your addons has ' + what + ' catalogs. Add one (AIOMetadata, Cinemeta) in Stremio.');
    }
    const genres = M.catalogGenres([].concat(...catalogs.map((c) => c.genres)));
    const sections = M.sectionsFor(p, shelves);
    const isGenre = (name) => genres.some((x) => x.toLowerCase() === name.toLowerCase());
    const genreNames = isCatalog() ? sections.slice(0, M.nextCatalogSection(sections.length, 0)).map((s) => s.title).filter(isGenre) : [];
    const genreResults = {};
    if (isCatalog() && !genreNames.length) { showGenreChips([]); chipsEl.hidden = false; }
    let batchPending = 0;
    let built = 0;

    const buildSection = (i) => {
      const { title, sources, picked } = sections[i];
      if (isCatalog() && isGenre(title) && genreNames.indexOf(title) < 0) genreNames.push(title);
      built = Math.max(built, i + 1);
      const rowCatalogs = sources.map((s) => s.catalog);
      const key = M.catalogAnswerKey(p, title, picked, rowCatalogs.map((c) => c.addon.transportUrl + '/' + c.type + '/' + c.id));
      const sourceAnswers = rowCatalogs.map(() => null);
      let completed = 0;
      let reported = false;
      let version = 0;

      const onAnswer = (results) => {
        if (g !== gen || dead) return;
        const mine = ++version;
        const items = [];
        const seen = new Set();
        results.forEach((r) => r.metas.forEach((m) => { if (!M.isAddonMessage(m.name) && !seen.has(m.id)) { seen.add(m.id); items.push(M.metaItem(m)); } }));
        if (completed === rowCatalogs.length && !reported) {
          reported = true;
          batchPending--;
          if (batchPending === 0) setTimeout(() => { if (loadMoreSections) loadMoreSections(); }, 0);
        }
        if (completed === rowCatalogs.length && genreNames.indexOf(title) >= 0) {
          genreResults[title] = items.length > 0;
          // Resolve empty rows before showing chips.
          const ready = M.settledGenres(genreNames, genreResults);
          if (ready) {
            showGenreChips(ready);
            chipsEl.hidden = false;
            if (activeEntry && inside(focusedEl(), rowsEl)) markChip(activeEntry.title);
          }
        }
        // The rest of the first page first, then the add-on's next pages when it takes `skip`.
        // shortcut (Alder's too): genre rows use each source's first page.
        let more;
        if (rowCatalogs.length === 1) {
          const catalog = rowCatalogs[0];
          if (catalog.pages && picked === null) {
            more = (from) => (from < items.length ? Promise.resolve(items.slice(from, from + M.PAGE))
              : catalog.addon.catalogPage(catalog, from).then((ms) => ms.filter((m) => !M.isAddonMessage(m.name)).map(M.metaItem)));
          } else more = later(items);
        } else {
          const all = items.slice();
          const counts = results.map((r) => r.metas.length);
          const exhausted = rowCatalogs.map(() => false);
          more = async (from) => {
            if (from >= all.length && picked === null) {
              for (let j = 0; j < rowCatalogs.length; j++) {
                const catalog = rowCatalogs[j];
                if (!catalog.pages || exhausted[j]) continue;
                const next = await catalog.addon.catalogPage(catalog, counts[j]);
                counts[j] += next.length;
                exhausted[j] = next.length === 0;
                const known = new Set(all.map((x) => x.id));
                next.forEach((m) => { if (!known.has(m.id) && !M.isAddonMessage(m.name)) { known.add(m.id); all.push(M.metaItem(m)); } });
                if (all.length > from) break;
              }
            }
            return all.slice(from, from + M.PAGE);
          };
        }
        if (!items.length) { if (completed === rowCatalogs.length) setTimeout(() => { if (loadMoreSections) loadMoreSections(); }, 0); return; }
        if (mine !== version) return;
        const old = entries.find((e) => e.key === 'sec' + i);
        const shownCount = Math.max(M.START, old ? old.items.length : M.START);
        setCatalogRow('sec' + i, i, title, items.slice(0, shownCount), more, items);
        // Nothing to continue: Home's first picture comes from the first catalog's top title (Alder's cinema did this).
        if (i === 0) log().debug('home', 'page ' + p + ': first row in');
        if (jumpTo === title) { jumpTo = null; const e = entries.find((x) => x.key === 'sec' + i); if (e) setTimeout(() => focusEntry(e, 0), 0); }
      };

      // Answers already read this session (or warmed from disk) build the row at once: switching to a page does not wait for the
      // network. A disk answer (saved) refreshes once; after that the row is marked done for the session.
      const update = () => {
        const current = sourceAnswers.map((a) => a || { metas: [], saved: true });
        if (current.some((a) => a.metas.length)) answers.set(key, current);
        onAnswer(current);
      };
      const refresh = (index) => {
        const c = rowCatalogs[index];
        c.addon.catalog(c, picked, M.CATALOG_WAIT).then((ms) => {
          if (g !== gen || dead) return;
          if (ms.length) { sourceAnswers[index] = { metas: ms, saved: false }; update(); }
        }, () => {});
      };
      const kept = answers.get(key);
      if (quick && kept && kept.length === rowCatalogs.length) {
        kept.forEach((a, index) => { sourceAnswers[index] = { metas: a.metas, saved: false }; });
        completed = rowCatalogs.length;
        update();
        kept.forEach((a, index) => { if (a.saved) refresh(index); });
      } else {
        rowCatalogs.forEach((c, index) => {
          let first;
          try {
            const saved = quick ? c.addon.savedCatalog(c, picked) : null;
            first = saved ? Promise.resolve({ metas: saved, saved: true }) : c.addon.catalog(c, picked, M.CATALOG_WAIT).then((ms) => ({ metas: ms, saved: false }));
          } catch (e) { first = Promise.reject(e); }
          first.catch((e) => { log().warn('home', 'row ' + title + ' (' + c.id + ', genre ' + picked + ') failed: ' + (e && e.message)); return { metas: [], saved: false }; })
            .then((answer) => {
              if (g !== gen || dead) return;
              sourceAnswers[index] = answer;
              completed++;
              update();
              if (answer.saved) refresh(index);
            });
        });
      }
    };

    let nextSection = M.nextCatalogSection(sections.length, 0);
    batchPending = nextSection;
    for (let i = 0; i < nextSection; i++) buildSection(i);
    loadMoreSections = () => {
      const at = entries.indexOf(activeEntry);
      const nearFocus = at >= 0 && activeEntry.section >= 0 && built - 1 - activeEntry.section < 3;
      if (g === gen && nextSection < sections.length && nearFocus) {
        const end = M.nextCatalogSection(sections.length, nextSection);
        batchPending = end - nextSection;
        for (let i = nextSection; i < end; i++) buildSection(i);
        nextSection = end;
      }
    };
  }

  /** The rest of a list already in hand, a page at a time: a row of hundreds of cards would be slow to build. */
  const later = (all) => (all.length <= M.START ? null : (from) => Promise.resolve(all.slice(from, from + M.PAGE)));

  function showNote(text) {
    emptyNote = true;
    noteEl.hidden = false;
    clear(noteEl);
    noteEl.appendChild(h('div', { class: 't-body t-3' }, text));
  }

  // ---- shown rows ----

  const hasFocus = (e) => !!(e.row && inside(focusedEl(), e.row.el));
  const focusedItemId = () => {
    const e = entries.find(hasFocus);
    return e ? (e.items[e.selected] || {}).id || null : null;
  };

  function insertEntry(e) {
    let at = entries.length;
    for (let i = 0; i < entries.length; i++) if (entries[i].order > e.order) { at = i; break; }
    entries.splice(at, 0, e);
    renumber();
  }

  /** Rows sit one band apart; the page slides so the row in use is in the band. */
  function renumber() {
    entries.forEach((e, i) => { e.top = i * ROW_STEP; if (e.row) e.row.el.style.top = e.top + 'px'; });
    place();
  }

  function place() {
    const at = entries.indexOf(activeEntry);
    rowsEl.style.transform = 'translate3d(0,' + (-Math.max(0, at) * ROW_STEP) + 'px,0)';
    entries.forEach((e, i) => {
      if (!e.row) return;
      e.row.el.classList.toggle('away', at >= 0 && i < at);
      e.row.el.classList.toggle('below', at >= 0 && i > at);
    });
  }

  function mountEntry(e) {
    if (e.row) return e.row;
    const row = createRow({
      title: e.title, items: e.items, images: ctx.images, name: 'hm-' + e.key, className: 'hm-row',
      itemWidth: CARD_W, itemHeight: CARD_H, gap: CARD_GAP, padLeft: PAD, safeRight: PAD, slide: true, buffer: 0.5,
      renderItem: (item, i, box) => renderCard(item, i, box, false),
      onSelect: (item) => openDetails(item),
      // Hold OK on a title in progress lists its sources (Alder: play(item, pick = true)).
      onHold: e.kind === 'continue' ? (item) => play(item, true) : null,
      onFocusItem: (item, i) => focusedCard(e, item, i),
    });
    row.el.style.top = e.top + 'px';
    ctx.engine.registerGroup(row.el, row.group);
    e.row = row;
    rowsEl.appendChild(row.el);
    if (e.selected) row.ensure(e.selected);
    place();
    return row;
  }

  function dropRow(e) {
    if (!e.row) return;
    ctx.engine.unregisterGroup(e.row.el);
    e.row.destroy();
    if (e.row.el.parentNode) e.row.el.parentNode.removeChild(e.row.el);
    e.row = null;
  }

  function dropAll() {
    entries.forEach(dropRow);
    entries = [];
    activeEntry = null;
    clear(rowsEl);
    rowsEl.style.transform = '';
  }

  function renderCard(item, i, box, tick) {
    const card = createCard({ name: item.name, poster: item.poster, progress: item.progress, watched: tick && item.finished }, i, box, ctx.images);
    if (item.progress > 0) card.classList.add('has-foot');
    return card;
  }

  /** Replaces what a row shows (a fresh answer): the remote stays on the title it was on, wherever it moved. */
  function replaceItems(e, items, more, all) {
    const focused = hasFocus(e);
    const id = e.items[e.selected] ? e.items[e.selected].id : null;
    const was = !!e.row;
    dropRow(e);
    e.items = items;
    e.more = more;
    e.all = all || items;
    e.fetching = false;
    const at = id ? items.findIndex((it) => it.id === id) : -1;
    e.selected = at >= 0 ? at : 0;
    if (focused) focusEntry(e, e.selected);
    else if (was && Math.abs(entries.indexOf(e) - Math.max(0, entries.indexOf(activeEntry))) <= 1) mountEntry(e);
    updateNextRow();
  }

  /** A catalog row. A fresh answer for a row the remote is in waits until it leaves (its cards would change under it). */
  function setCatalogRow(key, section, title, items, more, all) {
    const e = entries.find((x) => x.key === key);
    if (!e) {
      insertEntry({ key, kind: 'catalog', order: section + 1, section, title, items, all, more, selected: 0, row: null, top: 0, pending: null, fetching: false });
      rowAdded();
      return;
    }
    if (hasFocus(e)) { e.pending = () => replaceItems(e, items, more, all); return; }
    replaceItems(e, items, more, all);
  }

  /** Home's Continue row: the first row, in place at once (the fresh library always goes in), the remote kept on its title. */
  function setContinue(items, was, firstShow) {
    let e = entries.find((x) => x.key === 'continue');
    if (!items.length) { if (e) { dropRow(e); entries.splice(entries.indexOf(e), 1); if (activeEntry === e) activeEntry = null; renumber(); } return; }
    const more = later(items);
    if (!e) {
      e = { key: 'continue', kind: 'continue', order: 0, section: -1, title: 'Continue', items: items.slice(0, M.START), all: items, more, selected: 0, row: null, top: 0, pending: null, fetching: false };
      insertEntry(e);
      rowAdded();
    } else {
      const keep = Math.max(M.START, e.items.length);
      const at = was ? items.findIndex((it) => it.id === was) : -1;
      replaceItems(e, items.slice(0, Math.max(keep, at + 1)), more, items);
      if (at >= 0) e.selected = at;
    }
    // Continue came in after a quicker row below took the first focus: the remote starts on Continue.
    if (firstShow && !touched && focusedSomething && inside(focusedEl(), rowsEl) && entries[0] === e && activeEntry !== e) focusFirstRow();
  }

  /** A row was added: give slower ones above a moment, then start at the top row, not the quickest. */
  function rowAdded() {
    // The note about missing catalogs belongs to an empty page; with a row on it, it would sit under the cards.
    if (emptyNote) { emptyNote = false; noteEl.hidden = true; }
    // The first row shows in the band whether or not the remote is in it.
    if (entries[0] && !entries[0].row) mountEntry(entries[0]);
    if (!focusedSomething) timer('focusTop', FOCUS_TOP_WAIT, focusTop);
    // A page opened by resting on its name: the remote stays in the top bar and the top row's first title shows above as soon as
    // the top rows are in (they answer within a few tens of ms of each other).
    if (inside(focusedEl(), headerEl)) timer('heroTop', HERO_TOP_WAIT, heroTop);
    updateNextRow();
  }

  function focusTop() {
    if (focusedSomething || dead) return;
    focusedSomething = true;
    if (inside(focusedEl(), headerEl) && !jump) return;
    jump = false;
    focusFirstRow();
  }

  function heroTop() {
    if (!inside(focusedEl(), headerEl)) return;
    const e = entries[0];
    const item = page === 'My List' ? (grid ? grid.items[grid.at] : null) : e ? e.items[e.selected] : null;
    if (item && item !== heroItem) { fill(item); showHero(item); }
  }

  function focusFirstRow() {
    if (page === 'My List') return gridFocus(grid && grid.at ? grid.at : 0);
    const e = entries[0];
    if (!e) return false;
    return focusEntry(e, e.selected);
  }

  function focusEntry(e, i) {
    const row = mountEntry(e);
    const card = row.focusIndex(Math.min(i, e.items.length - 1));
    return !!card;
  }

  /** The remote reached card [i] of row [e]: it is the row in use, its title brightens, the hero shows it. */
  function focusedCard(e, item, i) {
    focusedSomething = true;
    e.selected = i;
    setActive(e);
    fill(item);
    showHero(item);
    placeCaption();
    updateNextRow();
    if (e.section >= 0 && page !== 'Home') markChip(e.title);
    if (i >= e.items.length - M.AHEAD) fetchMore(e);
    // Racing past, the cards beside are not where the remote will stop: fetching their art would only queue full-screen
    // downloads and decodes that compete with the row's own pictures.
    if (!held) [i - 1, i + 1].forEach((k) => { if (e.items[k]) warm(e.items[k]); });
    setTimeout(() => { if (loadMoreSections) loadMoreSections(); flushPending(); }, 0);
  }

  function setActive(e) {
    const changed = activeEntry !== e;
    if (changed && activeEntry && activeEntry.row) activeEntry.row.el.classList.remove('lit');
    activeEntry = e;
    if (e.row) e.row.el.classList.add('lit');
    place();
    if (changed) {
      // Only the row in use and its neighbours keep cards.
      const at = entries.indexOf(e);
      entries.forEach((x, k) => { if (x.row && Math.abs(k - at) > 1) dropRow(x); });
    }
  }

  /** The remote left the rows: they settle back (cards at full strength, the title quiet). */
  function unlight() {
    if (activeEntry && activeEntry.row) activeEntry.row.el.classList.remove('lit');
  }

  function flushPending() {
    entries.forEach((e) => { if (e.pending && !hasFocus(e)) { const fn = e.pending; e.pending = null; fn(); } });
  }

  /** More titles for a row near its end: a catalog's next page, or the rest of a long library. Stops once an answer brings nothing new. */
  function fetchMore(e) {
    if (!e.more || e.fetching) return;
    e.fetching = true;
    const from = e.items.length;
    Promise.resolve().then(() => e.more(from)).then((got) => {
      e.fetching = false;
      if (dead || entries.indexOf(e) < 0) return;
      const known = new Set(e.items.map((it) => it.id));
      const fresh = got.filter((it) => !known.has(it.id)); // a failed page can be asked again
      if (!fresh.length) { e.more = null; return; }
      e.items = e.items.concat(fresh);
      if (e.row) e.row.append(fresh);
    }, () => { e.fetching = false; });
  }

  /** Moves the remote to the row above or below, onto the same card index. */
  function moveRow(dir) {
    const at = entries.indexOf(activeEntry);
    const next = entries[at + dir];
    if (!next) return false;
    return focusEntry(next, activeEntry.selected);
  }

  // ---- chips ----

  /** All, then one chip per genre row on the page; a chip jumps to its row, and the dot follows the row in use. */
  function showGenreChips(names) {
    const hadFocus = inside(focusedEl(), chipsEl);
    const focusedGenre = hadFocus ? Array.from(genreChips.entries()).filter((kv) => kv[1].el === focusedEl()).map((kv) => kv[0])[0] : undefined;
    clear(chipsEl);
    genreChips.clear();
    [null].concat(names).forEach((value) => {
      const c = chip(value || 'All', { selected: value === genre, onClick: () => {
        const target = value === null ? entries.find((e) => e.section >= 0) || entries[0] : entries.find((e) => e.title === value);
        // Rows far down the page are still being made: the remote goes there as soon as it is in.
        if (target) focusEntry(target, 0); else jumpTo = value;
      } });
      genreChips.set(value, c);
      chipsEl.appendChild(c.el);
    });
    if (hadFocus) { const c = genreChips.get(focusedGenre) || genreChips.get(null); if (c) ctx.engine.focus(c.el); }
  }

  function markChip(rowTitle) {
    const open = genreChips.has(rowTitle) ? rowTitle : null;
    genre = open; // Back and Down from the top bar return to this chip
    genreChips.forEach((c, value) => c.select(value === open));
  }

  /** My List: filter chips, "Sort", sort chips. */
  function showListChips() {
    clear(chipsEl);
    listChips.length = 0;
    const add = (kind, value, label, selected, click) => {
      const c = chip(label, { selected, onClick: click });
      c.el.addEventListener('focus', () => { lastListChip = c; });
      listChips.push({ kind, value, chip: c, label });
      chipsEl.appendChild(c.el);
    };
    FILTERS.forEach(([value, label]) => add('filter', value, label, value === listFilter, () => {
      if (listFilter !== value) { listFilter = value; styleListChips(); redrawLibrary(); }
    }));
    chipsEl.appendChild(h('span', { class: 't-small t-3 hm-sort' }, 'Sort'));
    SORTS.forEach(([value, label]) => add('sort', value, label, value === listSort, () => {
      if (listSort !== value) { listSort = value; styleListChips(); redrawLibrary(); }
    }));
  }

  function styleListChips() {
    listChips.forEach((c) => c.chip.select(c.kind === 'filter' ? c.value === listFilter : c.value === listSort));
  }

  /** Where Up from the rows (and Down from the top bar) goes first: the chip in use. */
  function chipToFocus() {
    if (page === 'My List') return lastListChip || (listChips.find((c) => c.kind === 'filter' && c.value === listFilter) || {}).chip || null;
    if (isCatalog() && !chipsEl.hidden) return genreChips.get(genre) || genreChips.get(null) || null;
    return null;
  }

  // ======================================================================================================
  // My List: a grid, six across
  // ======================================================================================================

  function clearGrid() {
    if (grid) grid.mounted.forEach((g) => { g.cards.forEach((c) => disposeCard(c, ctx.images)); });
    grid = null;
    clear(gridTrack);
    gridTrack.style.transform = '';
  }

  function showLibrary(first) {
    clearGrid();
    const items = M.listItems(library, listFilter, listSort).map(M.libraryItem);
    const rows = M.listRowCount(items.length, COLUMNS);
    countEl.textContent = items.length ? M.listCountText(1, rows, items.length) : '';
    listHintEl.hidden = !items.length;
    if (!items.length) {
      heroItem = null;
      heroEl.classList.remove('on');
      art.layer.clear();
      const all = M.listItems(library, 'all', 'recent');
      noteEl.hidden = false;
      clear(noteEl);
      noteEl.appendChild(h('div', { class: 't-body t-2' }, !all.length && listFilter === 'all' ? 'Titles you save with + appear here'
        : 'No ' + (listFilter === 'movies' ? 'movies' : listFilter === 'shows' ? 'shows' : 'unwatched titles') + ' in My List'));
      return;
    }
    noteEl.hidden = true;
    grid = { items, rows, mounted: new Map(), at: 0 };
    mountGridRows(0);
    if (first) timer('focusTop', FOCUS_TOP_WAIT, focusTop);
    if (inside(focusedEl(), headerEl)) timer('heroTop', HERO_TOP_WAIT, heroTop);
  }

  /** The focused row, the one above and two below hold cards. */
  function mountGridRows(r) {
    const keep = new Set();
    for (let k = Math.max(0, r - 1); k <= Math.min(grid.rows - 1, r + 2); k++) {
      keep.add(k);
      if (grid.mounted.has(k)) continue;
      const slice = grid.items.slice(k * COLUMNS, (k + 1) * COLUMNS);
      const el = h('div', { class: 'hm-grid-row', style: { top: (k * GRID_STEP + 16) + 'px' } });
      const cards = slice.map((item, c) => {
        const card = renderCard(item, k * COLUMNS + c, { left: PAD + c * (GRID_W + GRID_GAP), width: GRID_W, height: GRID_H }, true);
        el.appendChild(card);
        return card;
      });
      gridTrack.appendChild(el);
      grid.mounted.set(k, { el, cards, items: slice });
    }
    Array.from(grid.mounted.keys()).forEach((k) => {
      if (keep.has(k)) return;
      const g = grid.mounted.get(k);
      g.cards.forEach((c) => disposeCard(c, ctx.images));
      if (g.el.parentNode) g.el.parentNode.removeChild(g.el);
      grid.mounted.delete(k);
    });
  }

  function gridCard(i) {
    const g = grid.mounted.get(Math.floor(i / COLUMNS));
    return g ? g.cards[i % COLUMNS] || null : null;
  }

  function gridFocus(i) {
    if (!grid || !grid.items.length) return false;
    i = Math.max(0, Math.min(grid.items.length - 1, i));
    const r = Math.floor(i / COLUMNS);
    mountGridRows(r);
    gridTrack.style.transform = 'translate3d(0,' + (-r * GRID_STEP) + 'px,0)';
    const card = gridCard(i);
    return card ? ctx.engine.focus(card) : false;
  }

  function focusedGridCard(i) {
    focusedSomething = true;
    grid.at = i;
    const item = grid.items[i];
    countEl.textContent = M.listCountText(Math.floor(i / COLUMNS) + 1, grid.rows, grid.items.length);
    fill(item);
    showHero(item);
    // Racing past, the cards beside are not where the remote will stop.
    if (!held) [i - 1, i + 1].forEach((k) => { if (grid.items[k]) warm(grid.items[k]); });
  }

  function gridKey(a) {
    const i = grid ? grid.at : 0;
    const n = grid ? grid.items.length : 0;
    if (!n) return false;
    const r = Math.floor(i / COLUMNS);
    const c = i % COLUMNS;
    if (a === 'left') { if (c > 0) gridFocus(i - 1); return true; }
    if (a === 'right') { if (c < COLUMNS - 1 && i + 1 < n) gridFocus(i + 1); return true; }
    if (a === 'down') {
      if (r + 1 < grid.rows) gridFocus(Math.min((r + 1) * COLUMNS + c, n - 1));
      return true;
    }
    if (a === 'up') {
      if (r > 0) gridFocus((r - 1) * COLUMNS + c);
      else { const ch = chipToFocus(); if (ch) ctx.engine.focus(ch.el); }
      return true;
    }
    return false;
  }

  /** The grid again from the library in hand (a fresh answer, a filter, a sort): the remote stays on its title, wherever it moved. */
  function rebuildLibrary(first) {
    if (page !== 'My List') return;
    const was = grid ? (grid.items[grid.at] || {}).id : null;
    const hadGrid = !!grid && inside(focusedEl(), gridEl);
    showLibrary(first);
    if (!grid) return;
    const at = was ? grid.items.findIndex((it) => it.id === was) : -1;
    if (hadGrid) gridFocus(at >= 0 ? at : 0);
    else if (!first) { const it = grid.items[0]; grid.at = 0; if (it) { fill(it); showHero(it); } }
  }

  const redrawLibrary = () => rebuildLibrary(false);

  /** Hold OK on a title: take it out of My List, or mark it watched. Saved to Stremio, then the grid is drawn again. */
  function listMenu(item) {
    const original = library.find((it) => it._id === item.id);
    if (!original) return;
    const options = item.finished ? ['Remove from My List'] : ['Remove from My List', 'Mark as watched'];
    openPanel(ctx, {
      title: item.name, items: options,
      onPick: (selected) => {
        const updated = JSON.parse(JSON.stringify(original));
        if (selected === 0) session.books.setInList(updated, false);
        else session.books.markTitleWatched(updated, (metas.get(item.id) || { videos: [] }).videos);
        session.saveLibrary([updated]).then(() => {
          library = library.map((it) => (it._id === item.id ? updated : it));
          if (page === 'My List' && !dead) redrawLibrary();
        }, (error) => {
          forgetIfSessionGone(error);
          if (page === 'My List' && !dead) openPanel(ctx, { title: "Couldn't update My List", items: ['OK'], message: 'Check the connection and try again.' });
        });
      },
    });
  }

  // ======================================================================================================
  // going places
  // ======================================================================================================

  /** Resume: straight to the sources for the episode Continue Watching points at; with [pick] (held OK) they are all listed. */
  function play(item, pick = false) {
    const videoId = item.videoId || item.id;
    const meta = metas.get(item.id) || null;
    const videos = meta ? meta.videos : [];
    const at = videos.findIndex((v) => v.id === videoId);
    const next = at >= 0 ? videos[at + 1] || null : null;
    const video = at >= 0 ? videos[at] : null;
    const code = item.type === 'series' && item.left ? item.left.split(M.DOT)[0] : null;
    ctx.router.push('streams', {
      type: item.type, id: item.id, name: item.name, poster: item.poster, videoId, nextVideoId: next ? next.id : null, pick,
      background: (meta && meta.background) || item.art, logo: (meta && meta.logo) || item.logo,
      still: video ? video.thumbnail : null, runtime: meta ? meta.runtime : null,
      episode: video ? 'S' + video.season + ' E' + video.episode + '  ·  ' + video.title : null,
      label: [item.name, code && /^S/.test(code) ? code : null].filter(Boolean).join('  ·  '),
    });
  }

  function openDetails(item) {
    ctx.router.push('details', { type: item.type, id: item.id, name: item.name, poster: item.poster, background: item.art, videoId: item.videoId });
  }

  // ======================================================================================================
  // keys
  // ======================================================================================================

  function zone() {
    const el = focusedEl();
    if (inside(el, rowsEl)) return 'rows';
    if (inside(el, gridEl)) return 'grid';
    if (inside(el, chipsEl)) return 'chips';
    if (inside(el, headerEl)) return 'header';
    return null;
  }

  /** The card the remote last had, for coming down from the top bar or the chips. */
  function toCards() {
    if (page === 'My List') return gridFocus(grid ? grid.at : 0);
    if (activeEntry) return focusEntry(activeEntry, activeEntry.selected);
    return focusFirstRow();
  }

  function navItem() { return navItems.get(page) || null; }

  function keyDown(a) {
    const z = zone();
    if (z === 'grid') return gridKey(a);
    if (z === 'rows') {
      if (a === 'down') { moveRow(1); return true; }
      if (a === 'up') {
        if (moveRow(-1)) return true;
        // Up from the first row: the chip in use, else the page's name in the top bar.
        const c = chipToFocus();
        if (c) { ctx.engine.focus(c.el); return true; }
        const n = navItem();
        if (n) ctx.engine.focus(n);
        return true;
      }
      return false; // Left and Right: the row keeps them (its ends stop the remote)
    }
    if (z === 'chips') {
      if (a === 'up') { const n = navItem(); if (n) ctx.engine.focus(n); return true; }
      if (a === 'down') { toCards(); return true; }
      return false;
    }
    if (z === 'header') {
      if (a === 'down') {
        // Coming down from the top bar the remote goes to the chips (a page that has them), else to where it was in the rows.
        const c = chipToFocus();
        if (c) { ctx.engine.focus(c.el); return true; }
        toCards();
        return true;
      }
      if (a === 'up') return true;
    }
    return false;
  }

  // ======================================================================================================
  // memory: the other pages' first pictures, from last time's answers
  // ======================================================================================================

  /** Shows' and Movies' rows read from disk into memory ahead, so the first switch to them draws at once; My List's first rows of posters fetched. */
  function warmPages() {
    if (dead) return;
    const addons = session.savedAddons();
    if (!addons) return;
    const lib = session.savedLibrary() || [];
    M.listItems(lib, 'all', 'recent').slice(0, COLUMNS * 3).forEach((it) => { const p = M.libraryItem(it).poster; if (p) ctx.images.prefetch(p); });
    const work = [];
    ['Shows', 'Movies'].forEach((p) => {
      const secs = M.sectionsFor(p, M.shelvesFor(p, addons));
      secs.forEach((s, i) => work.push(() => {
        const key = M.catalogAnswerKey(p, s.title, s.picked, s.sources.map((x) => x.catalog.addon.transportUrl + '/' + x.catalog.type + '/' + x.catalog.id));
        if (answers.has(key)) return;
        const kept = s.sources.map((x) => x.catalog.addon.savedCatalog(x.catalog, s.picked));
        if (kept.some((k) => !k)) return;
        answers.set(key, kept.map((ms) => ({ metas: ms, saved: true })));
        if (i < 2) kept.forEach((ms) => ms.slice(0, M.FIRST).forEach((m) => { const u = m.poster || m.background; if (u) ctx.images.prefetch(M.posterUrl(u)); }));
        // The first title's full-screen art too, so the page opens on its own picture, not the last page's.
        if (i === 0 && kept[0][0] && kept[0][0].background) ctx.images.prefetch(sharp(kept[0][0].background, 1920));
      }));
    });
    // One answer at a time: reading and parsing a kept answer is main-thread work.
    const step = () => { const job = work.shift(); if (!job || dead) return; try { job(); } catch (e) { /* a kept answer that does not parse is skipped */ } timers.warm = setTimeout(step, 40); };
    step();
  }

  // ======================================================================================================
  // the screen
  // ======================================================================================================

  return {
    mount(el, p, context) {
      ctx = context;
      session = context.session;
      root = el;
      profile = session.profile();
      if (!profile) { ctx.router.replace('profiles', {}); return; }
      el.classList.add('hm-screen');
      build();
      // The rows in use: lit while the remote is in them; their neighbours and the others settle back when it leaves.
      root.addEventListener('focusin', (e) => {
        if (!inside(e.target, rowsEl)) { unlight(); setTimeout(flushPending, 0); }
        // The caption names the focused card: none while the remote is up in the top bar.
        if (inside(e.target, headerEl)) captionEl.hidden = true;
        if (inside(e.target, gridEl)) {
          const card = e.target.closest ? e.target.closest('.card') : null;
          if (card && grid) focusedGridCard(Number(card.getAttribute('data-index')));
        }
        if (inside(e.target, chipsEl) && page !== 'My List') { /* the dot follows the row in use; a chip does not move it */ }
      });
      root.addEventListener('click', (e) => {
        if (!inside(e.target, gridEl)) return;
        const card = e.target.closest ? e.target.closest('.card') : null;
        if (card && grid) openDetails(grid.items[Number(card.getAttribute('data-index'))]);
      });
      root.addEventListener('alder:hold', (e) => {
        if (!inside(e.target, gridEl)) return;
        const card = e.target.closest ? e.target.closest('.card') : null;
        if (card && grid) listMenu(grid.items[Number(card.getAttribute('data-index'))]);
      });
      showPage(page);
      timers.warmPages = setTimeout(warmPages, WARM_AFTER);
    },

    unmount() {
      dead = true;
      gen++;
      Object.keys(timers).forEach((k) => clearTimeout(timers[k]));
      if (stopClock) stopClock();
      if (art.layer) art.layer.destroy();
      entries.forEach(dropRow);
      if (grid) clearGrid();
    },

    suspend() { held = false; },

    // Back from a title or the player: Continue Watching may have moved on, so this asks Stremio, not the disk. Only the library's
    // rows are redrawn, so the remote stays where it was on the rest of the page.
    resume() {
      if (dead) return;
      if (refreshLibrary) refreshLibrary();
      if (refreshAddons) refreshAddons();
    },

    onKey(evt) {
      if (evt.type !== 'press') return false;
      touched = true;
      const a = evt.action;
      if (a === 'left' || a === 'right') { held = !!evt.repeat; rowsEl.classList.toggle('held', held); }
      if (a === 'back') {
        // Back from the rows goes up, not out: to the chips on a page that has them (a genre jump left you deep in the page), else
        // to the open page's name. Back from there leaves as usual.
        const z = zone();
        if (z === 'rows' || z === 'grid') {
          if (evt.repeat) return true;
          const c = chipToFocus();
          if (c && c.el && c.el.getClientRects().length) ctx.engine.focus(c.el); else { const n = navItem(); if (n) ctx.engine.focus(n); }
          return true;
        }
        return false;
      }
      if (a === 'up' || a === 'down' || (zone() === 'grid' && (a === 'left' || a === 'right'))) return keyDown(a);
      return false;
    },
  };
}

export const homeScreens = { home: createHomeScreen };
