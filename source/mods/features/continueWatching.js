import { configRead } from '../config.js';
import { onPlayer } from '../utils/Player.js';
import { t } from 'i18next';

/**
 * Adds a "Continue watching" shelf to the YouTube TV home page.
 *
 * YouTube TV only shows it in Library for some accounts. We fetch the
 * FEhistory browse feed, cache its shelf with resume progress, and prepend
 * it to the home response. The cache survives restarts and is refreshed when
 * the app opens, when the page changes, and when the player pauses/ends.
 */

const STORE = 'tt-continue-watching';
const FETCH_TIMEOUT = 15000;
const MIN_REFRESH = 30000;
const DEFAULT_REFRESH_MINUTES = 5;
const DEBUG_CW = true;

let cachedShelf = null;
let fetching = false;
let lastFetch = 0;
let playerHooked = false;
let retryTimer = null;
let reloadedForCache = false;

try {
  cachedShelf = JSON.parse(window.localStorage[STORE] || 'null');
} catch (_) {
  cachedShelf = null;
}

function cwDebug(text) {
  if (!DEBUG_CW) return;
  try {
    let el = document.getElementById('tt-cw-debug');
    if (!el) {
      el = document.createElement('div');
      el.id = 'tt-cw-debug';
      el.style.cssText = 'position:fixed;top:14px;left:14px;z-index:2147483647;background:rgba(0,0,0,.88);color:#7dff7d;font:18px/1.35 monospace;padding:10px 14px;border:2px solid #7dff7d;border-radius:8px;max-width:58%;white-space:pre-wrap;pointer-events:none;';
      (document.body || document.documentElement).appendChild(el);
    }
    el.textContent = 'CW DEBUG\n' + text;
  } catch (_) {
    // Diagnostics must never break the feature.
  }
}

function shelfItemCount(shelf) {
  const list = shelf && shelf.shelfRenderer && shelf.shelfRenderer.content &&
    shelf.shelfRenderer.content.horizontalListRenderer;
  return (list && list.items && list.items.length) || 0;
}

cwDebug('cache=' + (cachedShelf ? shelfItemCount(cachedShelf) + ' items' : 'none'));

function summarizeResponse(response) {
  const acc = { shelf: 0, grid: 0, lockup: 0, tile: 0, resume: 0, sectionList: 0, tvSurface: 0 };

  function walk(node, depth) {
    if (!node || typeof node !== 'object' || depth > 20) return;
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) walk(node[i], depth + 1);
      return;
    }
    if (node.shelfRenderer) acc.shelf++;
    if (node.gridRenderer) acc.grid++;
    if (node.sectionListRenderer) acc.sectionList++;
    if (node.tvSurfaceContentRenderer) acc.tvSurface++;
    if (node.lockupViewModel) {
      acc.lockup++;
      if (resumePercent({ lockupViewModel: node.lockupViewModel }) > 0) acc.resume++;
    }
    if (node.tileRenderer) {
      acc.tile++;
      if (resumePercent({ tileRenderer: node.tileRenderer }) > 0) acc.resume++;
    }
    const keys = Object.keys(node);
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      if (key === 'responseContext' || key === 'frameworkUpdates' || key === 'trackingParams') continue;
      walk(node[key], depth + 1);
    }
  }

  walk(response, 0);
  return acc;
}

function textOf(t) {
  if (!t) return '';
  if (typeof t === 'string') return t;
  if (Array.isArray(t.runs)) return t.runs.map((r) => (r && r.text) || '').join('');
  return t.simpleText || t.content || '';
}

function titleOf(shelf) {
  const s = shelf && shelf.shelfRenderer;
  if (!s) return '';
  return textOf(s.title) ||
    textOf(s.shelfHeaderRenderer && s.shelfHeaderRenderer.title) ||
    textOf(s.headerRenderer && s.headerRenderer.shelfHeaderRenderer && s.headerRenderer.shelfHeaderRenderer.title);
}

function isContinueTitle(title) {
  return /continue watching|resume watching|keep watching|watch it again|weiter ansehen|weiter schauen|seguir viendo|continuar viendo|continuar assistindo|continuer à regarder|продолжить просмотр|verder kijken/i.test(title || '');
}

function resumePercent(item) {
  const tile = item && item.tileRenderer;
  if (tile) {
    const overlays = (tile.header && tile.header.tileHeaderRenderer && tile.header.tileHeaderRenderer.thumbnailOverlays) || [];
    for (let i = 0; i < overlays.length; i++) {
      const rp = overlays[i].thumbnailOverlayResumePlaybackRenderer;
      if (rp && (rp.percentDurationWatched || 0) > 0) return rp.percentDurationWatched;
    }
  }

  const lock = item && item.lockupViewModel;
  if (lock) {
    const image = lock.contentImage || {};
    const thumb = image.thumbnailViewModel ||
      (image.collectionThumbnailViewModel && image.collectionThumbnailViewModel.primaryThumbnail &&
        image.collectionThumbnailViewModel.primaryThumbnail.thumbnailViewModel) || {};
    const overlays = thumb.overlays || [];
    for (let i = 0; i < overlays.length; i++) {
      const overlay = overlays[i];
      const bar = overlay.thumbnailBottomOverlayViewModel && overlay.thumbnailBottomOverlayViewModel.progressBar &&
        overlay.thumbnailBottomOverlayViewModel.progressBar.thumbnailOverlayProgressBarViewModel;
      if (bar && (bar.startPercent || 0) > 0) return bar.startPercent;
      const direct = overlay.thumbnailOverlayProgressBarViewModel;
      if (direct && (direct.startPercent || 0) > 0) return direct.startPercent;
    }
  }

  return 0;
}

function buildShelfFromGrid(grid) {
  const items = Array.isArray(grid && grid.items) ? grid.items : [];
  const resumable = items.filter(function (item) {
    const percent = resumePercent(item);
    return percent > 0 && percent < 99;
  });
  const fallback = items.filter(function (item) {
    return resumePercent(item) > 0;
  });
  const chosen = (resumable.length ? resumable : fallback).slice(0, 20);

  if (!chosen.length) return null;

  return {
    shelfRenderer: {
      shelfHeaderRenderer: {
        title: {
          simpleText: t('continueWatching.title')
        }
      },
      tvhtml5ShelfRendererType: 'TVHTML5_SHELF_RENDERER_TYPE_GRID',
      content: {
        horizontalListRenderer: {
          items: chosen,
          selectedIndex: 0,
          visibleItemCount: 3
        }
      }
    }
  };
}

function findContinueShelf(response) {
  let fallback = null;
  let found = null;

  function walk(node, depth) {
    if (found || !node || typeof node !== 'object' || depth > 40) return;

    if (Array.isArray(node)) {
      for (let i = 0; i < node.length && !found; i++) walk(node[i], depth + 1);
      return;
    }

    if (node.gridRenderer) {
      const gridShelf = buildShelfFromGrid(node.gridRenderer);
      if (gridShelf) {
        found = gridShelf;
        return;
      }
    }

    if (node.shelfRenderer) {
      const content = node.shelfRenderer.content || {};
      const items = (content.horizontalListRenderer && content.horizontalListRenderer.items) || [];
      const hasResume = items.some((item) => resumePercent(item) > 0);

      if (hasResume) {
        if (isContinueTitle(titleOf(node))) {
          found = node;
          return;
        }
        if (!fallback) fallback = node;
      }
    }

    const keys = Object.keys(node);
    for (let i = 0; i < keys.length && !found; i++) {
      const key = keys[i];
      if (key === 'trackingParams' || key === 'responseContext' || key === 'frameworkUpdates') continue;
      walk(node[key], depth + 1);
    }
  }

  walk(response, 0);
  return found || fallback;
}

function services() {
  const mappings = window._yttv && Object.values(window._yttv).find((value) => value && value.mappings);
  if (!mappings) return null;

  const identity = mappings.get('CurrentIdentityService');
  const client = mappings.get('KabukiInnerTubeClient');
  if (!identity || !client) return null;

  return { identity, client };
}

function fetchBrowse(svc, identity) {
  return new Promise(function (resolve, reject) {
    let done = false;
    const timer = setTimeout(function () {
      if (done) return;
      done = true;
      reject(new Error('timeout'));
    }, FETCH_TIMEOUT);

    try {
      svc.client.fetch({
        identity: identity,
        isPrefetch: false,
        path: '/youtubei/v1/browse',
        payload: { browseId: 'FEhistory' },
        clickTracking: { clickTrackingParams: null }
      }).subscribe(
        function (response) {
          if (done) return;
          done = true;
          clearTimeout(timer);
          resolve(response);
        },
        function (error) {
          if (done) return;
          done = true;
          clearTimeout(timer);
          reject(error || new Error('fetch failed'));
        }
      );
    } catch (error) {
      if (!done) {
        done = true;
        clearTimeout(timer);
        reject(error);
      }
    }
  });
}

function scheduleRetry(delay) {
  if (retryTimer) return;
  retryTimer = setTimeout(function () {
    retryTimer = null;
    refreshContinueWatching();
  }, delay || 1500);
}

export function refreshContinueWatching() {
  if (!configRead('enableContinueWatching')) return;
  if (fetching) return;
  if (cachedShelf && Date.now() - lastFetch < MIN_REFRESH) return;

  const svc = services();
  if (!svc) {
    cwDebug('services: not ready, retrying');
    scheduleRetry(1200);
    return;
  }

  cwDebug('services: ready, fetching FEhistory');
  fetching = true;

  svc.identity.get()
    .then(function (identity) {
      return fetchBrowse(svc, identity);
    })
    .then(function (response) {
      const summary = summarizeResponse(response);
      const shelf = findContinueShelf(response);
      const counts = 'shelves=' + summary.shelf + ' grids=' + summary.grid +
        ' lockups=' + summary.lockup + ' tiles=' + summary.tile +
        ' resume=' + summary.resume + ' sectionLists=' + summary.sectionList +
        ' tvSurface=' + summary.tvSurface;

      if (shelf) {
        const hadCache = !!cachedShelf;
        cachedShelf = JSON.parse(JSON.stringify(shelf));
        try {
          window.localStorage[STORE] = JSON.stringify(cachedShelf);
        } catch (_) {
          // Storage full or unavailable: keep the in-memory copy.
        }
        cwDebug('hist: FOUND "' + (titleOf(shelf) || '(untitled)') + '" items=' +
          shelfItemCount(shelf) + '\n' + counts);
        console.info('[ContinueWatching] cached:', titleOf(shelf) || 'resume shelf');

        if (!hadCache && !reloadedForCache) {
          let alreadyReloaded = false;
          try {
            alreadyReloaded = window.sessionStorage.getItem('tt-cw-reloaded') === '1';
          } catch (_) {
            alreadyReloaded = false;
          }
          if (!alreadyReloaded) {
            setTimeout(softReloadHome, 1500);
          }
        }
      } else {
        cwDebug('hist: NO SHELF\n' + counts);
        console.warn('[ContinueWatching] no resume shelf in FEhistory');
        scheduleRetry(5000);
      }
    }, function (error) {
      cwDebug('hist: fetch failed: ' + (error && error.message));
      console.warn('[ContinueWatching] history fetch failed:', error && error.message);
      scheduleRetry(5000);
    })
    .then(function () {
      fetching = false;
      lastFetch = Date.now();
    });
}

export function injectContinueWatching(response) {
  if (!configRead('enableContinueWatching') || !cachedShelf) return;

  const contents = response && response.contents && response.contents.tvBrowseRenderer &&
    response.contents.tvBrowseRenderer.content && response.contents.tvBrowseRenderer.content.tvSurfaceContentRenderer &&
    response.contents.tvBrowseRenderer.content.tvSurfaceContentRenderer.content &&
    response.contents.tvBrowseRenderer.content.tvSurfaceContentRenderer.content.sectionListRenderer &&
    response.contents.tvBrowseRenderer.content.tvSurfaceContentRenderer.content.sectionListRenderer.contents;

  if (!Array.isArray(contents)) return;
  if (contents.some(function (node) { return node && node.shelfRenderer && isContinueTitle(titleOf(node)); })) return;

  const shelf = JSON.parse(JSON.stringify(cachedShelf));
  const renderer = shelf.shelfRenderer;
  if (!renderer) return;

  if (!titleOf(shelf)) {
    renderer.headerRenderer = { shelfHeaderRenderer: { title: { simpleText: 'Continue watching' } } };
  }

  const list = renderer.content && renderer.content.horizontalListRenderer;
  if (list) list.selectedIndex = 0;

  contents.unshift(shelf);
  cwDebug('inject: added row (' + shelfItemCount(shelf) + ' items)');
}

function hookPlayer() {
  if (playerHooked) return;

  onPlayer(function (player) {
    playerHooked = true;
    try {
      player.addEventListener('onStateChange', function () {
        const state = player.getPlayerStateObject ? player.getPlayerStateObject() : {};
        if (state && (state.isPaused || state.isEnded)) {
          setTimeout(refreshContinueWatching, 800);
        }
      });
    } catch (error) {
      console.warn('[ContinueWatching] player hook failed:', error && error.message);
    }
  });
}

function softReloadHome() {
  if (reloadedForCache) return;
  reloadedForCache = true;

  try {
    window.sessionStorage.setItem('tt-cw-reloaded', '1');
  } catch (_) {
    // Session storage is optional for this one-shot refresh.
  }

  for (const key in window._yttv) {
    const instance = window._yttv[key] && window._yttv[key].instance;
    if (instance && typeof instance.resolveCommand === 'function') {
      instance.resolveCommand({
        signalAction: {
          signal: 'SOFT_RELOAD_PAGE'
        }
      });
      return;
    }
  }
}

function start() {
  // Fetch as early as possible so the shelf is ready before the home feed
  // is parsed. The service retry loop handles a not-yet-ready client.
  refreshContinueWatching();
  hookPlayer();

  const minutes = Math.max(1, Number(configRead('continueWatchingRefreshMinutes')) || DEFAULT_REFRESH_MINUTES);
  setInterval(refreshContinueWatching, minutes * 60 * 1000);

  window.addEventListener('hashchange', function () {
    setTimeout(refreshContinueWatching, 1200);
  });

  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) refreshContinueWatching();
  });
}

if (document.readyState === 'complete') start();
else window.addEventListener('load', start);
