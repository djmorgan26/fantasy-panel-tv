// The remote-driven menu: watch a game, pick which team the panel shows,
// and switch or hide the panel. Up/Down moves, OK selects, Back closes.
// Everything it does goes through window.FFMenu, which the TV app provides
// (a stand-in records calls when this page runs in a desktop browser).
import { createDemo } from './demo.js';
import { loadConfig, liveSource, unpackSnapshot } from './source.js';
import { watchList, PROVIDERS } from './watch.js';
import { fmt1, fmtDayTime, setClock } from './util.js';

const params = new URLSearchParams(location.search);
const $ = (id) => document.getElementById(id);
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// In a desktop browser (preview, Playwright) there is no TV app. Record what
// would have happened instead, so tests can check it.
const native =
  window.FFMenu ||
  (() => {
    const calls = (window.__menuCalls = []);
    const st = {
      showing: params.get('showing') !== '0',
      mode: params.get('mode') || 'full',
      focus: params.get('focus') || 'all',
      side: params.get('side') || 'right',
      installed: Object.fromEntries(Object.keys(PROVIDERS).map((k) => [k, !(params.get('missing') || '').split(',').includes(k)])),
    };
    return {
      getState: () => JSON.stringify(st),
      getSnapshot: () => null,
      setFocus: (k) => (calls.push(['setFocus', k]), (st.focus = k), true),
      setMode: (m) => (calls.push(['setMode', m]), m === 'hide' ? (st.showing = false) : ((st.showing = true), (st.mode = m)), true),
      watch: (p, q) => (calls.push(['watch', p, q]), true),
      close: () => calls.push(['close']),
    };
  })();

function nativeState() {
  try {
    return JSON.parse(native.getState()) || {};
  } catch {
    return {};
  }
}

const ui = {
  items: [],
  starts: [], // first item of each section, for Left/Right
  index: 0,
  focusId: null,
  moved: false, // until you press a key, the selection sits on the first game
  data: null,
  cfg: null,
  st: nativeState(),
};

// Small status line under the title, same wording as the panel.
function status(nfl) {
  const live = nfl?.list?.filter((g) => g.state === 'in' || g.state === 'half').length || 0;
  if (live) return `<span class="dot live"></span>Live · ${live} game${live > 1 ? 's' : ''}`;
  if (nfl?.nextKickoff) return `<span class="dot"></span>Next kickoff ${esc(fmtDayTime(nfl.nextKickoff))}`;
  return '<span class="dot"></span>No games right now';
}

function gameWhen(g) {
  if (g.state === 'pre') return { text: fmtDayTime(g.start), live: false };
  if (g.state === 'half') return { text: 'Halftime', live: true };
  return { text: `${g.period > 4 ? 'OT' : 'Q' + g.period} ${g.clock}`, live: true };
}

const names = (list, n = 3) => (list.length > n ? `${list.slice(0, n).join(', ')} +${list.length - n}` : list.join(', '));

function gameRow(r) {
  const g = r.game;
  const w = gameWhen(g);
  const teams =
    g.state === 'pre'
      ? `${esc(g.away)} <span class="score">@</span> ${esc(g.home)}`
      : `${esc(g.away)} <span class="score">${g.awayScore}</span> &nbsp;${esc(g.home)} <span class="score">${g.homeScore}</span>`;
  const parts = [];
  if (r.mine.length) parts.push(`You: <b>${esc(names(r.mine))}</b>`);
  if (r.theirs.length) parts.push(`Them: ${esc(names(r.theirs, 2))}`);
  const net = (g.networks || [])[0];
  const sub = parts.length ? parts.join(' · ') : esc(net ? `On ${net}` : 'No players of yours');
  const installed = ui.st.installed?.[r.provider] !== false;
  return {
    id: `g:${g.id}`,
    html: `<div class="main"><div class="t1">${teams}<span class="when${w.live ? ' live' : ''}">${esc(w.text)}</span></div><div class="t2">${sub}</div></div><span class="pill${installed ? '' : ' missing'}">${esc(r.providerName)}</span>`,
    run: () => {
      if (!installed) return note(`${r.providerName} isn’t installed on this TV`);
      note(`Opening ${r.providerName}`);
      const ok = native.watch(r.provider, r.query);
      if (ok === false) note(`Couldn’t open ${r.providerName}`);
    },
  };
}

function leagueRow(m) {
  const pre = !m.slots.some((s) => [s.me, s.opp].some((p) => p && (p.state === 'in' || p.state === 'post')));
  const a = pre ? m.me.proj : m.me.score;
  const b = pre ? m.opp.proj : m.opp.score;
  const tone = a > b ? 'up' : a < b ? 'down' : '';
  const score = `<span class="num ${tone}">${fmt1(a)}</span> - ${fmt1(b)}${pre ? ' proj' : ''}`;
  return {
    id: `f:${m.key}`,
    on: () => ui.st.focus === m.key,
    html: `<span class="check">✓</span><div class="main"><div class="t1">${esc(m.league)}<span class="when">${esc(m.platform)}</span></div><div class="t2"><b>${esc(m.me.name)}</b> ${score} ${esc(m.opp.name)}</div></div>`,
    run: () => pin(m.key, m.league),
  };
}

function pin(key, label) {
  native.setFocus(key);
  ui.st.focus = key;
  note(key === 'all' ? 'Panel rotates through all leagues' : `Panel pinned to ${label}`);
  render();
}

function modeRow(id, title, sub, mode) {
  return {
    id,
    on: () => (mode === 'hide' ? false : ui.st.showing && ui.st.mode === mode),
    html: `<span class="check">✓</span><div class="main"><div class="t1">${title}</div><div class="t2">${sub}</div></div>`,
    run: () => {
      native.setMode(mode);
      if (mode === 'hide') {
        ui.st.showing = false;
        native.close();
        return;
      }
      ui.st.showing = true;
      ui.st.mode = mode;
      render();
    },
  };
}

function build() {
  const sections = [];
  let more = null;
  const d = ui.data;
  if (d) {
    const rows = watchList(d.nfl, d.matchups, ui.cfg?.watch);
    const mine = rows.filter((r) => r.mine.length || r.theirs.length);
    const rest = rows.filter((r) => !r.mine.length && !r.theirs.length);
    sections.push({ title: 'Watch your games', rows: mine.map(gameRow), empty: rest.length ? 'None of your players are still to play.' : 'No games left this week.' });
    more = rest.length ? { title: 'More games', rows: rest.map(gameRow) } : null;
    if (d.matchups.length) {
      sections.push({
        title: 'Show on the panel',
        rows: [
          {
            id: 'f:all',
            on: () => !ui.st.focus || ui.st.focus === 'all' || !d.matchups.some((m) => m.key === ui.st.focus),
            html: `<span class="check">✓</span><div class="main"><div class="t1">All leagues</div><div class="t2">Rotates between your ${d.matchups.length} matchups</div></div>`,
            run: () => pin('all'),
          },
          ...d.matchups.map(leagueRow),
        ],
      });
    }
  }
  sections.push({
    title: 'Panel',
    rows: [
      modeRow('m:full', 'Side panel', 'Full lineups and live games', 'full'),
      modeRow('m:mini', 'Score card', 'Just the scores, in the corner', 'mini'),
      modeRow('m:hide', 'Hide panel', 'Close everything', 'hide'),
    ],
  });
  if (more) sections.push(more);
  return sections;
}

function render() {
  const sections = build();
  const list = $('list');
  ui.items = [];
  ui.starts = [];
  let html = '';
  for (const s of sections) {
    if (s.rows.length) ui.starts.push(ui.items.length);
    html += `<h2>${esc(s.title)}</h2>`;
    if (!s.rows.length && s.empty) html += `<div class="empty">${esc(s.empty)}</div>`;
    for (const r of s.rows) {
      const i = ui.items.length;
      ui.items.push(r);
      html += `<div class="item${r.on?.() ? ' on' : ''}" role="menuitem" data-i="${i}" data-id="${esc(r.id)}">${r.html}</div>`;
    }
  }
  list.innerHTML = html;
  // Keep the selection on the same thing across refreshes.
  const keep = ui.moved ? ui.items.findIndex((r) => r.id === ui.focusId) : 0;
  move(keep >= 0 ? keep : Math.min(ui.index, ui.items.length - 1), false);
  const d = ui.data;
  $('title').textContent = d?.nfl?.week ? `Week ${d.nfl.week}` : 'Fantasy Football';
  $('status').innerHTML = d ? status(d.nfl) : '<span class="dot"></span>Loading your leagues';
}

function move(i, animate = true) {
  if (!ui.items.length) return;
  ui.index = Math.max(0, Math.min(ui.items.length - 1, i));
  ui.focusId = ui.items[ui.index].id;
  const els = $('list').querySelectorAll('.item');
  els.forEach((el, k) => el.classList.toggle('focus', k === ui.index));
  // Scroll so the selection stays comfortably in view.
  const el = els[ui.index];
  const box = $('scroll').clientHeight;
  const list = $('list');
  if (!animate) list.style.transition = 'none';
  const current = -Number(list.dataset.y || 0);
  const top = el.offsetTop;
  const bottom = top + el.offsetHeight;
  let y = current;
  const heading = el.previousElementSibling?.tagName === 'H2' ? el.previousElementSibling.offsetHeight : 0;
  if (top - heading - 16 < y) y = Math.max(0, top - heading - 16);
  else if (bottom + 40 > y + box) y = bottom + 40 - box;
  list.dataset.y = String(-y);
  list.style.transform = `translateY(${-y}px)`;
  if (!animate) requestAnimationFrame(() => (list.style.transition = ''));
}

let noteTimer;
function note(text) {
  const n = $('note');
  n.textContent = text;
  n.classList.add('show');
  clearTimeout(noteTimer);
  noteTimer = setTimeout(() => n.classList.remove('show'), 2200);
}

addEventListener('keydown', (e) => {
  ui.moved = true;
  switch (e.key) {
    case 'ArrowDown':
      move(ui.index + 1);
      break;
    case 'ArrowUp':
      move(ui.index - 1);
      break;
    case 'ArrowRight':
    case 'PageDown': {
      // Jump to the next section.
      const next = ui.starts.find((i) => i > ui.index);
      move(next ?? ui.items.length - 1);
      break;
    }
    case 'ArrowLeft':
    case 'PageUp': {
      const prev = [...ui.starts].reverse().find((i) => i < ui.index);
      move(prev ?? 0);
      break;
    }
    case 'Enter':
    case ' ':
      ui.items[ui.index]?.run();
      break;
    case 'Escape':
    case 'Backspace':
      native.close();
      break;
    default:
      return;
  }
  e.preventDefault();
});

// Mouse and touch work too, which helps in the desktop preview.
$('list').addEventListener('click', (e) => {
  const el = e.target.closest('.item');
  if (!el) return;
  ui.moved = true;
  move(Number(el.dataset.i));
  ui.items[ui.index]?.run();
});

async function main() {
  if (ui.st.side === 'left') document.body.classList.add('right'); // menu opposite the panel
  if (params.get('solid')) document.body.classList.add('solid');
  const demo = params.has('demo');
  ui.cfg = demo ? null : await loadConfig(params);
  setClock(params.get('locale') || ui.cfg?.panel?.locale, params.get('tz') || ui.cfg?.panel?.timeZone);
  if (ui.cfg?.panel?.side === 'left') document.body.classList.add('right');

  // Open instantly with whatever the panel last loaded, then refresh.
  const snap = unpackSnapshot(native.getSnapshot?.());
  if (snap) ui.data = { nfl: snap.nfl, matchups: snap.matchups };
  render();

  if (!demo && !ui.cfg) {
    $('status').innerHTML = '<span class="dot"></span>Send your settings with make tv-config';
    return;
  }
  const source = demo
    ? createDemo({ startMinute: Number(params.get('minute') || 34), speed: Number(params.get('speed') || 4) })
    : liveSource(ui.cfg);
  const refresh = async () => {
    try {
      const { nfl, matchups } = await source.load();
      ui.data = { nfl, matchups };
      ui.st = { ...nativeState(), focus: ui.st.focus };
      render();
    } catch (e) {
      console.warn('menu refresh failed', e);
      if (!ui.data) $('status').innerHTML = '<span class="dot"></span>Can’t reach your leagues';
    }
  };
  await refresh();
  console.info(`menu ready: ${ui.items.length} items`);
  setInterval(refresh, 30000);
}

main();
