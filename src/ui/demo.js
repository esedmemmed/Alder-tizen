/*
 * The Phase 1 demo screen: Home's look (top bar, hero text, three rows of 40 cards, caption) with generated
 * posters, to prove the foundation end to end: D-pad focus across 3 rows x 40 cards, virtualised rows, the focus
 * rim, OK -> a stub title page, Back, hold OK -> a panel, a toast. Replaced by the real screens in Phase 4.
 *
 * Nothing here touches the network: posters are SVG data URIs, so it also runs in the production build.
 */
import { h } from '../lib/dom.js';
import { iconSvg } from './icons.js';
import { createRow } from './row.js';
import { pill, roundButton } from './button.js';
import { keyHint } from './chip.js';
import { openPanel } from './panel.js';

// ---- generated content --------------------------------------------------------------------------------------

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ADJ = ['Midnight', 'Silent', 'Golden', 'Broken', 'Distant', 'Paper', 'Winter', 'Hollow', 'Burning', 'Quiet', 'Last', 'Iron', 'Salt', 'Velvet', 'Northern', 'Hidden'];
const NOUN = ['Orchard', 'Harbour', 'Signal', 'Garden', 'Empire', 'Letters', 'Mirror', 'Season', 'Station', 'Voyage', 'Lanterns', 'Archive', 'Meridian', 'Tide', 'Fortune', 'Atlas'];
const GENRE = ['Drama', 'Action', 'Comedy', 'Thriller', 'Adventure', 'Mystery', 'Sci-Fi', 'Romance'];

export function posterSvg(title, hue) {
  const words = title.split(' ');
  const lines = [];
  let line = '';
  words.forEach((w) => { if ((line + ' ' + w).trim().length > 11 && line) { lines.push(line); line = w; } else line = (line + ' ' + w).trim(); });
  if (line) lines.push(line);
  const text = lines.map((l, i) => '<text x="24" y="' + (330 + i * 52) + '" font-family="Georgia,serif" font-size="46" fill="#f3eee6" fill-opacity="0.92">' + l + '</text>').join('');
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 352 528"><defs>'
    + '<linearGradient id="g" x1="0" y1="0" x2="0.4" y2="1"><stop offset="0" stop-color="hsl(' + hue + ',42%,34%)"/><stop offset="1" stop-color="hsl(' + ((hue + 28) % 360) + ',48%,11%)"/></linearGradient>'
    + '<radialGradient id="r" cx="0.7" cy="0.25" r="0.6"><stop offset="0" stop-color="hsl(' + ((hue + 20) % 360) + ',70%,70%)" stop-opacity="0.5"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient></defs>'
    + '<rect width="352" height="528" fill="url(#g)"/><rect width="352" height="528" fill="url(#r)"/>'
    + '<circle cx="250" cy="150" r="64" fill="none" stroke="#f3d9b1" stroke-opacity="0.35" stroke-width="3"/>' + text + '</svg>';
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

export function demoItems(seed, count, { progress = false, watched = false } = {}) {
  const r = rng(seed);
  const out = [];
  for (let i = 0; i < count; i++) {
    const name = ADJ[Math.floor(r() * ADJ.length)] + ' ' + NOUN[Math.floor(r() * NOUN.length)];
    const hue = Math.floor(r() * 360);
    const minutes = 84 + Math.floor(r() * 90);
    out.push({
      id: 'demo-' + seed + '-' + i,
      name,
      poster: posterSvg(name, hue),
      year: 1998 + Math.floor(r() * 27),
      genre: GENRE[Math.floor(r() * GENRE.length)],
      runtime: Math.floor(minutes / 60) + 'h ' + (minutes % 60) + 'm',
      rating: (5.5 + r() * 3.4).toFixed(1),
      progress: progress ? 0.08 + r() * 0.8 : 0,
      watched: watched && r() < 0.25,
      left: Math.floor(minutes * (1 - 0.3)) + 'm left',
    });
  }
  return out;
}

const DESCRIPTION = 'A quiet harbour town keeps a secret older than its lighthouse, and one winter a stranger arrives with the only key that opens it.';

function clockText(date) {
  const h12 = date.getHours() % 12 || 12;
  return h12 + ':' + String(date.getMinutes()).padStart(2, '0') + ' ' + (date.getHours() < 12 ? 'AM' : 'PM');
}

// ---- the screens --------------------------------------------------------------------------------------------

/** A stub "title page": proves push / Back and focus restoration. */
function stubScreen(params) {
  let ctx = null;
  return {
    mount(root, p, context) {
      ctx = context;
      const item = params.item;
      root.appendChild(h('div', { class: 'demo-art' }));
      root.appendChild(h('div', { class: 'demo-shade-left' }));
      root.appendChild(h('div', { class: 'demo-shade-bottom' }));
      root.appendChild(h('div', { class: 'stub' },
        h('div', { class: 't-hero on-art' }, item.name),
        h('div', { class: 'meta t-body' }, item.year + '  ·  ' + item.genre + '  ·  ' + item.runtime + '  ·  IMDb ' + item.rating),
        h('div', { class: 'desc t-body on-art' }, DESCRIPTION),
        h('div', { class: 'buttons' },
          pill('Play', { icon: 'play', onClick: () => ctx.toast('Play: the player arrives in Phase 3') }),
          roundButton('check', { label: 'My List', onClick: () => ctx.toast('Added to My List') }),
          roundButton('info', { label: 'Details' }))));
      root.appendChild(h('div', { class: 'back-hint' }, keyHint('Back', 'Return to Home')));
      context.engine.focus(root.querySelector('.pill'));
    },
  };
}

/** The demo Home. params: { clock } fixes the clock text (screenshots). */
function homeScreen(params) {
  let ctx = null;
  const rows = [];
  let clockTimer = null;

  function onSelect(item, i, card) {
    ctx.router.push('stub', { item });
  }
  function onHold(item) {
    openPanel(ctx, {
      title: item.name, items: ['Add to My List', 'Mark as watched', 'Remove from Continue', 'Cancel'], focus: 0,
      onPick: (i) => ctx.toast(['Added to My List', 'Marked as watched', 'Removed', 'Cancelled'][i]),
    });
  }

  return {
    mount(root, p, context) {
      ctx = context;
      const heroTitle = h('div', { class: 't-hero on-art' }, '');
      const heroMeta = h('div', { class: 'meta t-body' });
      const heroDesc = h('div', { class: 'desc t-body on-art' }, DESCRIPTION);
      const captionText = h('span', null, '');
      const caption = h('div', { class: 'caption glass' }, captionText);
      const nextHint = h('div', { class: 'next-hint caps' });
      const clock = h('div', { class: 'clock' }, params.clock || clockText(new Date()));

      const navItems = ['Home', 'Shows', 'Movies', 'My List'].map((label, i) =>
        h('div', { class: 'nav-item' + (i === 0 ? ' on' : ''), 'data-focus': '', tabindex: '-1', 'data-nav': label, onclick: () => ctx.toast(label + ' arrives in Phase 4') }, label));
      const search = h('div', { class: 'nav-item', 'data-focus': '', tabindex: '-1', 'data-nav': 'Search', onclick: () => ctx.toast('Search arrives in Phase 4') },
        h('span', { class: 'icon', html: iconSvg('search') }));

      const specs = [
        { title: 'Continue', seed: 11, opts: { progress: true } },
        { title: 'Popular movies', seed: 22, opts: { watched: true } },
        { title: 'Popular shows', seed: 33, opts: {} },
      ];
      const rowsEl = h('div', { class: 'rows' });
      specs.forEach((s, r) => {
        const row = createRow({
          title: s.title, name: 'row-' + r, items: demoItems(s.seed, 40, s.opts), images: context.images,
          onSelect, onHold,
          onFocusItem: (item) => showItem(item, r),
        });
        row.el.style.top = (r * 430) + 'px';
        // Rows slide under the top bar as focus moves, so measured positions mid-slide can put the bar nearer than the row
        // above. Up and Down between rows are therefore declared, as Alder's Home moves between its rows by index.
        if (r > 0) row.el.setAttribute('data-up', '[data-focus-group="row-' + (r - 1) + '"]');
        row.el.setAttribute('data-down', r + 1 < specs.length ? '[data-focus-group="row-' + (r + 1) + '"]' : 'none');
        context.engine.registerGroup(row.el, row.group);
        rows.push(row);
        rowsEl.appendChild(row.el);
      });

      function showItem(item, r) {
        heroTitle.textContent = item.name;
        heroMeta.innerHTML = '';
        heroMeta.appendChild(h('span', null, item.year));
        heroMeta.appendChild(h('span', { class: 'sep' }, '·'));
        heroMeta.appendChild(h('span', null, item.genre));
        heroMeta.appendChild(h('span', { class: 'sep' }, '·'));
        heroMeta.appendChild(h('span', null, item.runtime));
        heroMeta.appendChild(h('span', { class: 'imdb' }, 'IMDb'));
        heroMeta.appendChild(h('span', null, item.rating));
        captionText.textContent = item.progress > 0 ? item.left + '  ·  Stopped at 31:34' : item.genre + '  ·  ' + item.runtime;
        rowsEl.style.transform = 'translate3d(0,' + (-r * 430) + 'px,0)';
        rows.forEach((row, k) => { row.el.classList.toggle('away', k < r); row.el.classList.toggle('below', k > r); });
        nextHint.textContent = r + 1 < rows.length ? '▾  ' + specs[r + 1].title : '';
        root.setAttribute('data-row', r);
      }

      root.appendChild(h('div', { class: 'demo-art' }));
      root.appendChild(h('div', { class: 'demo-shade-left' }));
      root.appendChild(h('div', { class: 'demo-shade-bottom' }));
      root.appendChild(h('div', { class: 'demo-shade-top' }));
      root.appendChild(h('div', { class: 'topbar' },
        h('div', { class: 'avatar' }, 'E'),
        h('div', { class: 'navpill glass' }, search, navItems),
        clock));
      root.appendChild(h('div', { class: 'hero' }, heroTitle, heroMeta, heroDesc));
      root.appendChild(rowsEl);
      root.appendChild(caption);
      root.appendChild(nextHint);

      showItem(rows[0].itemAt(0), 0);
      const first = rows[0].focusIndex(0);
      if (!first) context.engine.focusFirst();

      if (!params.clock) clockTimer = setInterval(() => { clock.textContent = clockText(new Date()); }, 30000);
    },
    unmount() {
      if (clockTimer) clearInterval(clockTimer);
      rows.forEach((r) => r.destroy());
    },
    onKey(evt) {
      // Back at the bottom of the stack would exit the app: the router asks main.js, which says so here in dev.
      return false;
    },
  };
}

export const demoScreens = {
  home: homeScreen,
  stub: stubScreen,
};
