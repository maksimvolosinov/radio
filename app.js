'use strict';

// Stations come from the free, community-run Radio Browser directory.
const API_HOSTS = [
  'https://de1.api.radio-browser.info',
  'https://de2.api.radio-browser.info',
  'https://fi1.api.radio-browser.info',
  'https://nl1.api.radio-browser.info',
  'https://at1.api.radio-browser.info',
];
const API_TIMEOUT_MS = 8000;
const PAGE_SIZE = 100;
const FALLBACK_LOGO = 'icons/icon-192.png';

const $ = (id) => document.getElementById(id);
const audio = $('audio');
const listEl = $('list');
const statusEl = $('status');
const searchEl = $('search');
const countryEl = $('country');

const store = {
  get(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ }
  },
};

let favorites = store.get('favorites', []);
let current = null;
let queue = [];
let tab = 'top';
let requestId = 0;
let apiHost = null;

// A dead server would otherwise leave fetch hanging for minutes.
async function fetchJson(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), API_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

// Ask every server at once and stick with whichever answers first.
function findHost() {
  return Promise.any(API_HOSTS.map((h) => fetchJson(h + '/json/stats').then(() => h)));
}

async function api(path) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      apiHost = apiHost || (await findHost());
      return await fetchJson(apiHost + path);
    } catch (e) {
      apiHost = null;
      if (attempt === 1) throw e;
    }
  }
}

// iOS Safari blocks http:// audio on an https:// page, so keep only https streams.
function playable(stations) {
  const seen = new Set();
  return stations.filter((s) => {
    const url = s.url_resolved || s.url;
    if (!url || !url.startsWith('https://') || seen.has(s.stationuuid)) return false;
    seen.add(s.stationuuid);
    return true;
  });
}

function params(extra) {
  return new URLSearchParams({
    hidebroken: 'true',
    order: 'clickcount',
    reverse: 'true',
    limit: String(PAGE_SIZE),
    ...extra,
  }).toString();
}

async function load() {
  const id = ++requestId;
  const query = searchEl.value.trim();
  listEl.innerHTML = '';

  if (tab === 'favorites') {
    const shown = favorites.filter((s) => !query || s.name.toLowerCase().includes(query.toLowerCase()));
    statusEl.textContent = shown.length ? '' : 'No favorites yet. Tap ☆ on a station to add it.';
    render(shown);
    return;
  }

  statusEl.textContent = 'Loading…';
  const extra = {};
  if (query) extra.name = query;
  if (tab === 'country' && countryEl.value) extra.countrycode = countryEl.value;

  try {
    const stations = playable(await api('/json/stations/search?' + params(extra)));
    if (id !== requestId) return;
    statusEl.textContent = stations.length ? '' : 'No stations found.';
    render(stations);
  } catch (e) {
    if (id !== requestId) return;
    statusEl.textContent = 'Could not load stations (' + errorText(e) + '). Tap a tab to retry.';
  }
}

function errorText(e) {
  if (e instanceof AggregateError) return 'no station server reachable';
  if (e && e.name === 'AbortError') return 'timed out';
  return (e && e.message) || 'unknown error';
}

function slim(s) {
  return {
    stationuuid: s.stationuuid,
    name: s.name.trim(),
    url_resolved: s.url_resolved || s.url,
    favicon: s.favicon,
    country: s.country,
    tags: s.tags,
    codec: s.codec,
    bitrate: s.bitrate,
  };
}

function info(s) {
  const parts = [];
  if (s.country) parts.push(s.country);
  if (s.tags) parts.push(s.tags.split(',').slice(0, 2).join(', '));
  if (s.bitrate) parts.push(s.bitrate + ' kbps');
  return parts.join(' · ');
}

function logo(img, s) {
  img.src = s.favicon && s.favicon.startsWith('https://') ? s.favicon : FALLBACK_LOGO;
  img.onerror = () => { img.onerror = null; img.src = FALLBACK_LOGO; };
}

function isFavorite(s) {
  return favorites.some((f) => f.stationuuid === s.stationuuid);
}

function toggleFavorite(s) {
  favorites = isFavorite(s)
    ? favorites.filter((f) => f.stationuuid !== s.stationuuid)
    : [...favorites, slim(s)];
  store.set('favorites', favorites);
}

function render(stations) {
  const frag = document.createDocumentFragment();
  for (const s of stations) {
    const li = document.createElement('li');
    li.className = 'station';
    li.dataset.id = s.stationuuid;
    if (current && current.stationuuid === s.stationuuid) li.classList.add('playing');

    const img = document.createElement('img');
    img.loading = 'lazy';
    img.alt = '';
    logo(img, s);

    const text = document.createElement('div');
    text.className = 'station-text';
    const name = document.createElement('div');
    name.className = 'station-name';
    name.textContent = s.name.trim();
    const meta = document.createElement('div');
    meta.className = 'station-info';
    meta.textContent = info(s);
    text.append(name, meta);

    const fav = document.createElement('button');
    fav.className = 'icon-btn';
    fav.setAttribute('aria-label', 'Favorite');
    const paintFav = () => {
      fav.textContent = isFavorite(s) ? '★' : '☆';
      fav.classList.toggle('on', isFavorite(s));
    };
    paintFav();
    fav.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleFavorite(s);
      paintFav();
      updatePlayer();
      if (tab === 'favorites') load();
    });

    li.append(img, text, fav);
    li.addEventListener('click', () => play(s, stations));
    frag.append(li);
  }
  listEl.append(frag);
}

function play(s, list) {
  if (current && current.stationuuid === s.stationuuid) {
    togglePlay();
    return;
  }
  if (list) queue = list.map(slim);
  current = slim(s);
  store.set('last', current);
  audio.src = current.url_resolved;
  audio.load();
  audio.play().catch(playFailed);
  document.querySelectorAll('.station').forEach((li) => {
    li.classList.toggle('playing', li.dataset.id === current.stationuuid);
  });
  updatePlayer();
  updateMediaSession();
  // Tell the directory a station was played; this keeps its popularity ranking useful.
  api('/json/url/' + current.stationuuid).catch(() => {});
}

function playFailed(e) {
  // NotAllowedError means iOS wants a tap first; anything else is the stream itself.
  $('np-info').textContent = e && e.name === 'NotAllowedError'
    ? 'Tap ▶ to start playback.'
    : 'This station would not play. Try another one.';
  updatePlayerButton();
}

function togglePlay() {
  if (!current) return;
  if (audio.paused) {
    // Reload the stream so a resumed live station starts at "now", not where it was paused.
    audio.src = current.url_resolved;
    audio.load();
    audio.play().catch(playFailed);
  } else {
    audio.pause();
  }
}

// Skip buttons (lock screen, CarPlay, steering wheel) step through favorites,
// or through the list the station was picked from when there are no favorites.
function skip(step) {
  const list = favorites.length ? favorites : queue;
  if (!list.length) return;
  const i = current ? list.findIndex((s) => s.stationuuid === current.stationuuid) : -1;
  const next = list[(i + step + list.length) % list.length];
  current = null;
  play(next);
}

function updatePlayer() {
  if (!current) return;
  $('player').hidden = false;
  logo($('np-logo'), current);
  $('np-name').textContent = current.name;
  $('np-info').textContent = info(current);
  updatePlayerButton();
  $('np-fav').textContent = isFavorite(current) ? '★' : '☆';
  $('np-fav').classList.toggle('on', isFavorite(current));
}

function updatePlayerButton() {
  $('np-toggle').textContent = audio.paused ? '▶' : '❚❚';
  if ('mediaSession' in navigator) navigator.mediaSession.playbackState = audio.paused ? 'paused' : 'playing';
}

function updateMediaSession() {
  if (!('mediaSession' in navigator) || !current) return;
  const art = current.favicon && current.favicon.startsWith('https://') ? current.favicon : FALLBACK_LOGO;
  navigator.mediaSession.metadata = new MediaMetadata({
    title: current.name,
    artist: info(current),
    artwork: [{ src: new URL(art, location.href).href, sizes: '512x512' }],
  });
}

if ('mediaSession' in navigator) {
  navigator.mediaSession.setActionHandler('play', togglePlay);
  navigator.mediaSession.setActionHandler('pause', () => audio.pause());
  navigator.mediaSession.setActionHandler('stop', () => audio.pause());
  navigator.mediaSession.setActionHandler('nexttrack', () => skip(1));
  navigator.mediaSession.setActionHandler('previoustrack', () => skip(-1));
}

audio.addEventListener('playing', updatePlayer);
audio.addEventListener('pause', updatePlayerButton);
audio.addEventListener('waiting', () => { $('np-info').textContent = 'Buffering…'; });
audio.addEventListener('error', () => {
  if (audio.getAttribute('src')) $('np-info').textContent = 'This station is offline right now. Try another one.';
  updatePlayerButton();
});

$('np-toggle').addEventListener('click', togglePlay);
$('np-fav').addEventListener('click', () => {
  if (!current) return;
  toggleFavorite(current);
  updatePlayer();
  load();
});

document.querySelectorAll('.tabs button').forEach((btn) => {
  btn.addEventListener('click', () => {
    tab = btn.dataset.tab;
    store.set('tab', tab);
    document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('active', b === btn));
    countryEl.hidden = tab !== 'country';
    load();
  });
});

let searchTimer;
searchEl.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(load, 400);
});
searchEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') searchEl.blur(); });

countryEl.addEventListener('change', () => {
  store.set('country', countryEl.value);
  load();
});

async function loadCountries() {
  try {
    const countries = await api('/json/countries?order=name&hidebroken=true');
    const saved = store.get('country', '');
    const guess = (navigator.language.split('-')[1] || '').toUpperCase();
    countryEl.innerHTML = '';
    for (const c of countries) {
      if (!c.iso_3166_1 || c.stationcount < 1) continue;
      const opt = document.createElement('option');
      opt.value = c.iso_3166_1;
      opt.textContent = `${c.name} (${c.stationcount})`;
      countryEl.append(opt);
    }
    countryEl.value = saved || guess || 'US';
    if (!countryEl.value && countryEl.options.length) countryEl.selectedIndex = 0;
  } catch { /* the country tab will just search without a filter */ }
}

(async function init() {
  const last = store.get('last', null);
  if (last) {
    current = last;
    audio.src = last.url_resolved;
    updatePlayer();
    updateMediaSession();
  }
  await loadCountries();
  const savedTab = store.get('tab', 'top');
  const btn = document.querySelector(`.tabs button[data-tab="${savedTab}"]`);
  if (btn) btn.click(); else load();

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
