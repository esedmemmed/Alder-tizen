/*
 * Boot: polyfills first (this import must stay first: it patches the engine before any other module runs), then the
 * shell: log handlers, TV keys, focus engine, router, toast, and the first screen.
 */
import './lib/compat.js';
import { installed as polyfilled } from './lib/compat.js';
import { ENV, IS_DEV, VERSION } from './lib/env.js';
import { log, installGlobalHandlers } from './lib/log.js';
import { attachKeys, registerKeys } from './lib/keys.js';
import { createFocusEngine } from './lib/focus.js';
import { createRouter } from './lib/router.js';
import { appImages } from './lib/images.js';
import { createToaster } from './ui/toast.js';
import { demoScreens } from './ui/demo.js';
import { playerScreens } from './player/screen.js';
import { diagnosticsScreens } from './screens/diagnostics.js';
import { demoPlayerServices } from './player/demo.js';

export function boot() {
  installGlobalHandlers(window, log);
  log.info('boot', 'Alder ' + VERSION + ' (' + ENV + ') ' + navigator.userAgent);
  if (polyfilled.length) log.info('boot', 'polyfills: ' + polyfilled.join(', '));

  const appEl = document.getElementById('app');
  const overlayEl = document.getElementById('overlay');
  const toastHost = document.getElementById('toast');

  const registered = registerKeys(window.tizen);
  log.info('keys', registered.length ? 'registered ' + registered.length + ' TV keys' : 'no TV key registration (desktop browser?)');

  const engine = createFocusEngine({ root: document.body });
  const toast = createToaster(toastHost);
  const params = {};
  if (IS_DEV) new URLSearchParams(window.location.search).forEach((v, k) => { params[k] = v; });

  const context = { engine, toast, images: appImages(), overlayHost: overlayEl, log };
  context.player = demoPlayerServices(log); // TEMP for Phase 4 to replace: the real services (profile, settings, library, session)
  const router = createRouter({
    root: appEl,
    screens: Object.assign({}, demoScreens, playerScreens, diagnosticsScreens),
    context,
    onExit: () => {
      // Back at the bottom of the stack leaves the app.
      try {
        window.tizen.application.getCurrentApplication().exit();
      } catch (e) {
        log.info('app', 'exit requested (not on a TV)');
      }
    },
    // A screen that gets covered keeps its place: remember the focused card and give it back on return.
    beforeHide: (entry) => { entry.lastFocus = engine.current(); },
    afterShow: (entry) => {
      if (!(entry.lastFocus && entry.lastFocus.isConnected && engine.focus(entry.lastFocus))) engine.focusFirst();
    },
    log,
  });
  context.router = router;

  // The remote: arrows move focus, OK clicks, hold OK sends 'alder:hold'; screens and dialogs see every key first.
  attachKeys({
    target: window,
    onAction: (evt) => {
      if (router.onKey(evt)) return;
      if (evt.type === 'press') {
        if (evt.action === 'left' || evt.action === 'right' || evt.action === 'up' || evt.action === 'down') engine.move(evt.action);
        else if (evt.action === 'ok') engine.press();
      } else if (evt.type === 'hold' && evt.action === 'ok') engine.hold();
    },
  });

  // The TV hides the app (Home key, another source): AVPlay is suspended by the player in Phase 3; here, log it.
  document.addEventListener('visibilitychange', () => log.info('app', document.hidden ? 'hidden' : 'visible'));

  router.push('home', { clock: params.clock });
  if (IS_DEV) {
    window.__alder = { router, engine, log, context };
    // The mock's application.exit() has no TV to close: say what would have happened.
    window.addEventListener('tizen-exit', () => toast('Back at Home leaves the app'));
  }
  log.info('boot', 'ready');
  return { router, engine, context };
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
}
