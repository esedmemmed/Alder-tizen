/*
 * A thin wrapper over Samsung's webapis.avplay (AVPlay): the same calls in the order Samsung documents, but with promises
 * for the two asynchronous ones (prepareAsync, seekTo), every call that can throw guarded, and the listener callbacks
 * delivered through one handlers object. Everything the engine knows about the platform is here; engine.js never touches
 * webapis, so it is tested against dev/mock-tizen.js through this very wrapper.
 *
 * Samsung's order (AVPlay API reference and the "Using AVPlay" guide):
 *   <object type="application/avplayer"> in the page  ->  open(url)  ->  setListener  ->  setDisplayRect(0,0,1920,1080)
 *   ->  setStreamingProperty (IDLE only)  ->  prepareAsync  ->  [track decision: setSelectTrack]  ->  play
 * suspend() / restore() when the app is hidden and shown again; close() when the player is left.
 *
 * Doubts, to confirm on the TU8000 (also in docs/DECISIONS.md):
 *   - which callback marks "the picture is on": the guide says onbufferingstart fires while preparing and
 *     onbufferingcomplete when buffering is done, which can be before play(). The engine therefore only counts events that
 *     arrive after it called play().
 *   - onerror and onerrormsg may both fire for one failure: only onerror is acted on, onerrormsg's text is kept for the log.
 *   - the exact strings the error callbacks pass (AVPlayError: PLAYER_ERROR_CONNECTION_FAILED, ...), and the HTTP status
 *     (PLAYER_MSG_HTTP_ERROR_CODE through onevent, its data format is not documented).
 */

/** Screen size AVPlay's coordinates are always expressed in, whatever the page's CSS size (Samsung: "always 1920x1080"). */
export const SCREEN = Object.freeze({ width: 1920, height: 1080 });

/** The text of whatever an AVPlay call threw or passed to an error callback, preferring an AVPlayError name. */
export function errorCode(e) {
  if (e === null || e === undefined) return 'UNKNOWN';
  if (typeof e === 'string') return e;
  const message = e.message ? String(e.message) : '';
  const named = /PLAYER_ERROR_[A-Z_]+/.exec(message);
  if (named) return named[0];
  if (e.name && e.name !== 'Error') return e.name + (message ? ': ' + message : '');
  return message || String(e);
}

const lower = (s) => String(s).toLowerCase();

/** Headers AVPlay can take (User-Agent, Cookie) and the ones it cannot, case-insensitively. */
export function splitHeaders(headers) {
  const supported = {};
  const unsupported = [];
  Object.keys(headers || {}).forEach((name) => {
    if (lower(name) === 'user-agent') supported.USER_AGENT = String(headers[name]);
    else if (lower(name) === 'cookie') supported.COOKIE = String(headers[name]);
    else unsupported.push(name);
  });
  return { supported, unsupported };
}

/**
 * Puts the <object type="application/avplayer"> element AVPlay draws into (Samsung's guide: without it nothing shows) in
 * [host]. The video itself is on a plane behind the web page, so the page has to be transparent where it should show.
 */
export function attachVideoObject(host, doc = document) {
  const el = doc.createElement('object');
  el.setAttribute('type', 'application/avplayer');
  el.setAttribute('class', 'av-object');
  el.setAttribute('aria-hidden', 'true');
  host.appendChild(el);
  return el;
}

/**
 * createAvplay({ webapis, log })
 *   webapis  window.webapis (its .avplay is used)
 *   log      the app logger: log.info('avplay', message)
 */
export function createAvplay({ webapis = typeof window !== 'undefined' ? window.webapis : undefined, log = null } = {}) {
  let session = 0; // each open() starts a new one: callbacks of an earlier one are dropped
  let lastErrorText = '';

  const say = (message) => { if (log) log.info('avplay', message); };
  const av = () => {
    const a = webapis && webapis.avplay;
    if (!a) throw new Error('AVPlay is not available (webapis.avplay is missing)');
    return a;
  };
  const safe = (label, fn, fallback) => {
    try { return fn(); } catch (e) { say(label + ' failed: ' + errorCode(e)); return fallback; }
  };

  const api = {
    get available() { return !!(webapis && webapis.avplay); },

    state() { return safe('getState', () => av().getState(), 'NONE'); },

    /**
     * Starts a new session on [url]: close anything open, open, listen, size the picture to the screen, set the headers
     * AVPlay supports. [handlers] (all optional): onBufferingStart, onBufferingProgress(percent), onBufferingComplete,
     * onTime(ms), onCompleted, onError(code), onEvent(id, data), onSubtitle({ durationMs, text, type }).
     * Returns { unsupportedHeaders }. Throws when AVPlay refuses (the engine treats that as the source failing).
     */
    open(url, { headers = null } = {}, handlers = {}) {
      api.close();
      const a = av();
      const mine = ++session;
      lastErrorText = '';
      const live = (fn) => (...args) => { if (mine === session && fn) fn(...args); };
      a.open(url);
      a.setListener({
        onbufferingstart: live(() => handlers.onBufferingStart && handlers.onBufferingStart()),
        onbufferingprogress: live((percent) => handlers.onBufferingProgress && handlers.onBufferingProgress(Number(percent))),
        onbufferingcomplete: live(() => handlers.onBufferingComplete && handlers.onBufferingComplete()),
        oncurrentplaytime: live((ms) => handlers.onTime && handlers.onTime(Number(ms))),
        onstreamcompleted: live(() => handlers.onCompleted && handlers.onCompleted()),
        onerror: live((code) => handlers.onError && handlers.onError(errorCode(code), lastErrorText)),
        onerrormsg: live((code, text) => { lastErrorText = String(text === undefined ? code : text); }),
        onevent: live((id, data) => handlers.onEvent && handlers.onEvent(String(id), data)),
        onsubtitlechange: live((duration, text, type) => handlers.onSubtitle && handlers.onSubtitle({ durationMs: Number(duration) || 0, text: String(text === undefined ? '' : text), type })),
        ondrmevent: () => {},
        onresourceconflicted: live(() => say('onresourceconflicted')),
      });
      // The whole screen, in AVPlay's own 1920x1080 coordinates. The guide says to scale by 1920 / document width only to
      // place the video over a DOM element; this one fills the screen, so the numbers never change (DECISIONS.md).
      safe('setDisplayRect', () => a.setDisplayRect(0, 0, SCREEN.width, SCREEN.height));
      safe('setDisplayMethod', () => a.setDisplayMethod('PLAYER_DISPLAY_MODE_LETTER_BOX')); // like ExoPlayer: fit, never crop
      // Alder passes the stream's request headers to ExoPlayer. AVPlay can only be told the User-Agent and the Cookie.
      const { supported, unsupported } = splitHeaders(headers);
      Object.keys(supported).forEach((name) => safe('setStreamingProperty ' + name, () => a.setStreamingProperty(name, supported[name])));
      if (unsupported.length) say('request headers AVPlay cannot send, stream may not play: ' + unsupported.join(', '));
      return { unsupportedHeaders: unsupported };
    },

    /** prepareAsync as a promise: resolves in READY, rejects with the error callback's argument. */
    prepare() {
      return new Promise((resolve, reject) => { av().prepareAsync(() => resolve(), (e) => reject(e)); });
    },

    play() { return safe('play', () => { av().play(); return true; }, false); },
    pause() { return api.state() === 'PLAYING' ? safe('pause', () => { av().pause(); return true; }, false) : false; },
    stop() { return safe('stop', () => { av().stop(); return true; }, false); },

    /** Leaves the player: drops callbacks first so nothing arrives for a closed session. */
    close() {
      session++;
      if (!api.available) return;
      if (api.state() === 'NONE') return;
      safe('close', () => av().close());
    },

    /** seekTo as a promise. Resolves when AVPlay says the seek is done, rejects when it says it failed or threw. */
    seekTo(ms) {
      return new Promise((resolve, reject) => {
        try { av().seekTo(Math.max(0, Math.round(ms)), () => resolve(), (e) => reject(e)); } catch (e) { reject(e); }
      });
    },

    /** Current time in ms, or null while the state does not allow asking. */
    time() { return safe('getCurrentTime', () => { const t = av().getCurrentTime(); return Number.isFinite(t) ? t : null; }, null); },
    duration() { return safe('getDuration', () => { const d = av().getDuration(); return Number.isFinite(d) ? d : 0; }, 0); },

    /** IS_LIVE: live streams have no length, no progress to save and cannot be scrubbed. */
    isLive() { return safe('IS_LIVE', () => { const v = String(av().getStreamingProperty('IS_LIVE')).toLowerCase(); return v === '1' || v === 'true'; }, false); },

    /** getTotalTrackInfo(): [{ index, type, extra_info }], [] when it fails (on Tizen 5.5 it can answer "notSet" for DASH). */
    totalTracks() {
      return safe('getTotalTrackInfo', () => { const t = av().getTotalTrackInfo(); return Array.isArray(t) ? t : []; }, []);
    },

    /** The streams AVPlay has selected now: [{ index, type, extra_info }]. */
    currentStreams() {
      return safe('getCurrentStreamInfo', () => { const t = av().getCurrentStreamInfo(); return Array.isArray(t) ? t : []; }, []);
    },

    /** Index of the audio (or text) track AVPlay selected by itself, or null. */
    currentIndex(type) {
      const found = api.currentStreams().find((s) => s && String(s.type).toUpperCase() === type);
      return found && Number.isFinite(Number(found.index)) ? Number(found.index) : null;
    },

    selectTrack(type, index) {
      say('setSelectTrack(' + type + ', ' + index + ')');
      return safe('setSelectTrack', () => { av().setSelectTrack(type, index); return true; }, false);
    },

    /** Subtitles from the file: false = AVPlay stays silent about them (no onsubtitlechange). Alder's "text track disabled". */
    subtitlesOn(on) {
      return safe('setSilentSubtitle', () => { av().setSilentSubtitle(!on); return true; }, false);
    },

    suspend() { return safe('suspend', () => { av().suspend(); return true; }, false); },
    restore() { return safe('restore', () => { av().restore(); return true; }, false); },
  };
  return api;
}
