/*
 * TEMP for Phase 4 to replace: what the Phase 1 demo needs to open the player and Diagnostics before the real screens and
 * the account exist. It stands in for the services Phase 4 builds (profile, settings, library, Stremio session) with
 * in-memory ones, and for the sources page with a fixed list of sources whose URLs carry the AVPlay mock's `mock.*`
 * options (dev builds only: on a TV they are just unplayable links, so "didn't play" is what the demo shows there).
 *
 * Phase 4: delete this file, and fill context.player (see screen.js) from the real services instead.
 */
import { createStore, memoryStorage } from '../lib/store.js';
import { createSettings } from '../core/settings.js';
import { createLibrary } from '../core/library.js';
import { createSourceMemory } from '../core/ranking.js';
import { tu8000Profile } from '../core/device.js';
import { Addon } from '../core/addon.js';
import { appHttp } from '../lib/http.js';

const OPEN_SUBTITLES = { transportUrl: 'https://opensubtitles-v3.strem.io/manifest.json', manifest: { id: 'org.stremio.opensubtitlesv3', name: 'OpenSubtitles v3', resources: ['subtitles'], types: ['movie', 'series'], idPrefixes: ['tt'] } };
const CINEMETA = { transportUrl: 'https://v3-cinemeta.strem.io/manifest.json', manifest: { id: 'com.linvo.cinemeta', name: 'Cinemeta', resources: ['meta'], types: ['movie', 'series'], idPrefixes: ['tt'] } };

/** The services the player takes from context.player, in memory. */
export function demoPlayerServices(log) {
  const store = createStore({ storage: memoryStorage() });
  const http = appHttp();
  const settings = createSettings({ store, activeProfileId: () => 'demo', tvLanguage: () => 'en' });
  const subtitles = new Addon(OPEN_SUBTITLES, { http });
  const cinemeta = new Addon(CINEMETA, { http });
  return {
    settings,
    library: createLibrary(),
    memory: createSourceMemory(store),
    device: tu8000Profile(),
    http,
    authKey: 'demo-session',
    loadMeta: (type, id) => cinemeta.meta(type, id),
    stremio: {
      async addons() { return [subtitles]; },
      savedLibrary: () => null,
      async library() { return []; },
      async saveLibrary(key, items) { log.info('demo', 'would save ' + items.length + ' library item(s) to Stremio'); },
    },
  };
}

function source(title, file, mock) {
  const query = Object.keys(mock).map((k) => 'mock.' + k + '=' + encodeURIComponent(mock[k])).join('&');
  return { name: title, description: '', url: 'https://media.fixture.test/' + file + (query ? '?' + query : ''), headers: {}, size: 3 * 1024 * 1024 * 1024, filename: file, binge: null };
}

/** Severance S1 E4 with a first source that fails at once, so the demo shows the failover before the picture. */
export function demoPlayParams(item) {
  return {
    type: 'series', metaId: 'tt11280740', videoId: 'tt11280740:1:4', name: item ? item.name : 'Severance',
    episode: 'S1 E4  ·  The You You Are', nextVideoId: 'tt11280740:1:5',
    sources: [
      source('Torrentio (2160p)', 'Severance.S01E04.2160p.WEB-DL.DV.HEVC-GROUP.mkv', { prepare: 'fail:PLAYER_ERROR_NOT_SUPPORTED_FILE', duration: 3300 }),
      source('Torrentio (1080p)', 'Severance.S01E04.1080p.WEB-DL.DTS.DDP5.1.H264-GROUP.mkv', { tracks: 'mixed+subs', duration: 3300, start: 'slow:2500' }),
    ],
  };
}
