'use strict';

// Stations come from the free, community-run Radio Browser directory.
const API_HOSTS = [
  'https://de1.api.radio-browser.info',
  'https://de2.api.radio-browser.info',
  'https://fi1.api.radio-browser.info',
  'https://nl1.api.radio-browser.info',
];
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
let tab = 'top';
let requestId = 0;

async function api(path) {
  let lastError;
  for (const host of API_HOSTS) {
    try {
      const res = await fetch(host + path);
      if (res.ok) return await res.json();
      lastError = new Error('HTTP ' + res.status);
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError;
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
  } catch {
    if (id !== requestId) return;
    statusEl.textContent = 'Could not load stations. Check your connection.';
  }
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
    li.addEventListener('click', () => play(s));
    frag.append(li);
  }
  listEl.append(frag);
}

function play(s) {
  if (current && current.stationuuid === s.stationuuid) {
    togglePlay();
    return;
  }
  current = slim(s);
  store.set('last', current);
  audio.src = current.url_resolved;
  audio.play().catch(() => { $('np-info').textContent = 'Playback failed. Try another station.'; });
  document.querySelectorAll('.station').forEach((li) => {
    li.classList.toggle('playing', li.dataset.id === current.stationuuid);
  });
  updatePlayer();
  updateMediaSession();
  // Tell the directory a station was played; this keeps its popularity ranking useful.
  api('/json/url/' + current.stationuuid).catch(() => {});
}

function togglePlay() {
  if (!current) return;
  if (audio.paused) {
    // Reload the stream so a resumed live station starts at "now", not where it was paused.
    audio.src = current.url_resolved;
    audio.play().catch(() => {});
  } else {
    audio.pause();
  }
}

function updatePlayer() {
  if (!current) return;
  $('player').hidden = false;
  logo($('np-logo'), current);
  $('np-name').textContent = current.name;
  $('np-info').textContent = info(current);
  $('np-toggle').textContent = audio.paused ? '▶' : '❚❚';
  $('np-fav').textContent = isFavorite(current) ? '★' : '☆';
  $('np-fav').classList.toggle('on', isFavorite(current));
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
}

audio.addEventListener('playing', updatePlayer);
audio.addEventListener('pause', updatePlayer);
audio.addEventListener('waiting', () => { $('np-info').textContent = 'Buffering…'; });
audio.addEventListener('error', () => {
  if (audio.getAttribute('src')) $('np-info').textContent = 'Stream unavailable. Try another station.';
  updatePlayer();
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
