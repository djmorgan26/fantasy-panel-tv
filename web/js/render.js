// DOM rendering. Plain template strings plus a tiny number tween, so a TV
// with 2 GB of RAM does not pay for a framework.
import { fmt1 } from './util.js';

const $ = (id) => document.getElementById(id);
export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// Remember the last value shown for every animated number, keyed by data-num.
const shown = new Map();

function tweenNumbers(root) {
  const els = root.querySelectorAll('[data-num]');
  const start = performance.now();
  const jobs = [];
  for (const el of els) {
    const key = el.dataset.num;
    const to = Number(el.dataset.val);
    const from = shown.has(key) ? shown.get(key) : to;
    shown.set(key, to);
    if (Math.abs(to - from) < 0.05) continue;
    if (to > from) el.classList.add('up');
    jobs.push({ el, from, to });
  }
  if (!jobs.length) return;
  const dur = 900;
  const step = (now) => {
    const t = Math.min(1, (now - start) / dur);
    const e = 1 - (1 - t) ** 3;
    for (const j of jobs) j.el.textContent = fmt1(j.from + (j.to - j.from) * e);
    if (t < 1) requestAnimationFrame(step);
    else setTimeout(() => jobs.forEach((j) => j.el.classList.remove('up')), 1600);
  };
  for (const j of jobs) j.el.textContent = fmt1(j.from);
  requestAnimationFrame(step);
}

const num = (key, v, cls = '') =>
  `<span class="${cls}" data-num="${esc(key)}" data-val="${(v || 0).toFixed(2)}">${fmt1(v)}</span>`;

export function renderHeader(nfl, matchups) {
  $('week').textContent = nfl?.week ? `Week ${nfl.week}` : 'Fantasy';
  const live = nfl?.list?.filter((g) => g.state === 'in' || g.state === 'half').length || 0;
  let text;
  if (live) text = `Live · ${live} game${live > 1 ? 's' : ''}`;
  else if (matchups?.length && matchups.every((m) => m.done)) text = 'Final';
  else if (nfl?.nextKickoff) {
    const d = new Date(nfl.nextKickoff);
    text = `Kickoff ${d.toLocaleDateString(undefined, { weekday: 'short' })} ${d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
  } else text = 'No games';
  $('status').innerHTML = `<span class="dot${live ? ' live' : ''}"></span><span>${esc(text)}</span>`;
}

function wpTone(p) {
  return p >= 0.6 ? 'good' : p <= 0.4 ? 'bad' : '';
}

function focusCard(m) {
  const pct = Math.round(m.winProb * 100);
  const meLead = m.me.score >= m.opp.score;
  const meta = m.done
    ? `<span>${m.me.score > m.opp.score ? 'Won' : m.me.score < m.opp.score ? 'Lost' : 'Tied'}</span>`
    : `<span>Proj <b>${fmt1(m.me.proj)}</b> - ${fmt1(m.opp.proj)}</span><span><b>${m.me.left + m.me.playing}</b> left vs ${m.opp.left + m.opp.playing}</span>`;
  return `
      <article class="mu">
        <div class="mu-head"><span class="mu-league">${esc(m.league)}</span><span class="mu-platform">${esc(m.platform)}</span></div>
        <div class="mu-row me${meLead ? ' lead' : ''}">
          <div class="mu-team"><span class="mu-name">${esc(m.me.name)}</span><span class="mu-rec">${esc(m.me.record)}</span></div>
          ${num(`${m.key}:me`, m.me.score, 'mu-score')}
        </div>
        <div class="mu-row opp${!meLead ? ' lead' : ''}">
          <div class="mu-team"><span class="mu-name">${esc(m.opp.name)}</span><span class="mu-rec">${esc(m.opp.record)}</span></div>
          ${num(`${m.key}:opp`, m.opp.score, 'mu-score')}
        </div>
        <div class="wp"><div class="wp-track"><div class="wp-fill ${wpTone(m.winProb)}" style="width:${pct}%"></div></div><span class="wp-pct">${pct}%</span></div>
        <div class="mu-meta">${meta}</div>
      </article>`;
}

function compactRow(m) {
  const pct = Math.round(m.winProb * 100);
  return `
      <div class="mini">
        <div class="mini-l"><div class="mini-league">${esc(m.league)}</div><div class="mini-teams">${esc(m.me.name)} <span>vs</span> ${esc(m.opp.name)}</div></div>
        <div class="mini-score">${num(`${m.key}:me:mini`, m.me.score)}<span class="mini-sep">-</span>${num(`${m.key}:opp:mini`, m.opp.score, 'mini-opp')}</div>
        <div class="mini-wp ${wpTone(m.winProb)}">${pct}%</div>
      </div>`;
}

let focusShown = null;

export function renderMatchups(matchups, focusKey) {
  const focus = matchups.find((m) => m.key === focusKey) || matchups[0];
  const root = $('matchups');
  const swap = focusShown && focusShown !== focus.key;
  root.innerHTML = focusCard(focus);
  if (swap) {
    root.classList.remove('swap');
    void root.offsetWidth;
    root.classList.add('swap');
  }
  focusShown = focus.key;
  tweenNumbers(root);

  const others = matchups.filter((m) => m !== focus);
  const o = $('others');
  o.innerHTML = others.length ? `<div class="sec-title">Your other ${others.length > 1 ? 'leagues' : 'league'}</div>${others.map(compactRow).join('')}` : '';
  tweenNumbers(o);
}

function playerCell(p, side) {
  if (!p) return `<div class="pl ${side}"><span class="empty">Empty</span></div>`;
  let sub = esc(p.label || p.team || '');
  if (p.state === 'in') sub = `<span class="on"><i class="ldot"></i>${sub}</span>`;
  if (p.injury) sub = `<span class="inj">${esc(p.injury)}</span> · ${sub}`;
  if (p.redZone) sub = `<span class="rzp">Red zone</span> ${sub}`;
  return `<div class="pl ${side}"><div class="pl-name">${esc(p.short)}</div><div class="pl-sub">${sub}</div></div>`;
}

function ptsCell(m, p, side) {
  if (!p) return `<div class="pts ${side}"></div>`;
  if (p.state === 'pre' || p.state === 'none')
    return `<div class="pts pre ${side}">${fmt1(p.proj)}</div>`;
  return `<div class="pts ${side}">${num(`${m.key}:${p.key}:${side}`, p.pts)}</div>`;
}

let currentPage = null;

export function renderLineup(m, index, total) {
  const root = $('detail');
  if (!m) {
    root.innerHTML = '';
    return;
  }
  const rows = m.slots
    .map((s) => {
      const live = s.me?.state === 'in' || s.opp?.state === 'in';
      return `<div class="slot${live ? ' live' : ''}">${playerCell(s.me, 'l')}${ptsCell(m, s.me, 'l')}<div class="pos">${esc(s.pos)}</div>${ptsCell(m, s.opp, 'r')}${playerCell(s.opp, 'r')}</div>`;
    })
    .join('');
  const pager = total > 1 ? `<div class="pager">${Array.from({ length: total }, (_, i) => `<i class="${i === index ? 'on' : ''}"></i>`).join('')}</div>` : '';

  const same = currentPage === m.key && root.querySelector('.lineup-page');
  if (same) {
    root.querySelector('.detail-title').textContent = 'Lineup';
    const page = root.querySelector('.lineup-page');
    page.innerHTML = rows;
    const pg = root.querySelector('.pager');
    if (pg) pg.outerHTML = pager;
    tweenNumbers(page);
    return;
  }
  const old = root.querySelector('.lineup-page');
  if (!root.querySelector('.lineup')) {
    root.innerHTML = `<div class="detail-head"><span class="detail-title"></span>${pager}</div><div class="lineup"></div>`;
  } else {
    const pg = root.querySelector('.pager');
    if (pg) pg.outerHTML = pager;
  }
  root.querySelector('.detail-title').textContent = 'Lineup';
  const page = document.createElement('div');
  page.className = 'lineup-page out';
  page.innerHTML = rows;
  root.querySelector('.lineup').appendChild(page);
  tweenNumbers(page);
  requestAnimationFrame(() => requestAnimationFrame(() => page.classList.remove('out')));
  if (old) {
    old.classList.add('out');
    setTimeout(() => old.remove(), 500);
  }
  currentPage = m.key;
}

export function renderSwing(rows) {
  const root = $('swing');
  const top = rows.filter((r) => Math.abs(r.impact) >= 0.5).slice(0, 2);
  if (!top.length) {
    root.innerHTML = '';
    return;
  }
  root.innerHTML =
    `<div class="sec-title">Games that matter</div>` +
    top
      .map((r) => {
        const g = r.game;
        const poss = (t) => (g.possession === t && g.state === 'in' ? '<span class="poss">●</span>' : '');
        const teams =
          g.state === 'pre'
            ? `${esc(g.away)} @ ${esc(g.home)}`
            : `${esc(g.away)}${poss(g.away)} ${g.awayScore} &nbsp;·&nbsp; ${esc(g.home)}${poss(g.home)} ${g.homeScore}`;
        const when =
          g.state === 'pre'
            ? new Date(g.start).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })
            : g.state === 'half'
              ? 'Halftime'
              : `${g.period > 4 ? 'OT' : 'Q' + g.period} ${g.clock}`;
        const mine = r.mine.slice(0, 2).join(', ');
        const theirs = r.theirs.slice(0, 2).join(', ');
        const who = mine && theirs ? `${mine} vs ${theirs}` : mine || `vs ${theirs}`;
        const tone = r.impact > 0 ? 'good' : 'bad';
        const sign = r.impact > 0 ? '+' : '−';
        return `<div class="game"><div><div class="game-teams">${teams}${g.redZone ? '<span class="rz">RED ZONE</span>' : ''}</div><div class="game-sub">${esc(when)} · ${esc(who)}</div></div><div class="game-imp ${tone}">${sign}${fmt1(Math.abs(r.impact))}<small>${r.impact > 0 ? 'your edge' : 'their edge'}</small></div></div>`;
      })
      .join('');
}

export function renderFoot(updatedAt, errors) {
  const t = updatedAt
    ? `Updated ${updatedAt.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`
    : '';
  const warn = errors?.length ? `<span class="warn">${esc(errors[0])}</span>` : '<span></span>';
  $('foot').innerHTML = `${warn}<span>${esc(t)}</span>`;
}

export function renderMessage(title, body) {
  $('matchups').innerHTML = `<div class="message"><h2>${esc(title)}</h2><p>${body}</p></div>`;
  $('detail').innerHTML = '';
  $('others').innerHTML = '';
  $('swing').innerHTML = '';
}

export function showToast(ev) {
  const root = $('toasts');
  const good = ev.side === 'me';
  const el = document.createElement('div');
  el.className = `toast ${good ? 'good' : 'bad'}`;
  el.innerHTML = `<div class="toast-delta">+${fmt1(ev.delta)}</div><div class="toast-body"><div class="toast-name">${esc(ev.player.name)}</div><div class="toast-sub">${esc(good ? 'Your player' : 'Against you')} · ${esc(ev.league)} · ${esc(ev.player.label || '')}</div></div>`;
  root.prepend(el);
  while (root.children.length > 3) root.lastChild.remove();
  setTimeout(() => {
    el.classList.add('leave');
    setTimeout(() => el.remove(), 450);
  }, 7000);
}

