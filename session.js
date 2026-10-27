// ── State ──────────────────────────────────────────────────────
let players           = [];
let numCourts         = 0;
let sitOutCnt         = [];
let partnerCnt        = [];
let opponentCnt       = [];
let rounds            = [];
let requestedCourts   = 0;
let lastRoundCourtMap = {};
let fixedMode         = false;
let pairs             = [];   // [idA, idB] per fixed pair; only used when fixedMode

// ── Persistence ───────────────────────────────────────────────

const STORAGE_KEY = 'organiser:' + location.pathname;
let restoring = false;

function saveState() {
  if (restoring) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      inSession: document.getElementById('session-view').style.display === 'block',
      players, numCourts, requestedCourts, sitOutCnt, partnerCnt, opponentCnt, rounds, fixedMode, pairs,
      setup: {
        courts:  document.getElementById('court-count').value,
        fixed:   isFixedSetup(),
        players: getSetupRows()   // unfiltered so fixed-pair alignment survives a reload
      }
    }));
  } catch (e) { /* storage full or blocked (private mode) — app still works without it */ }
}

function restoreState() {
  let s;
  try { s = JSON.parse(localStorage.getItem(STORAGE_KEY)); } catch (e) { return; }
  if (!s) return;

  restoring = true;
  try {
    document.getElementById('court-count').value = s.setup.courts;
    document.getElementById('fixed-mode').checked = !!s.setup.fixed;
    onFixedModeChange();
    s.setup.players.forEach(p => addPlayerRow(p.name, p.gender));

    if (s.inSession) {
      ({ players, numCourts, requestedCourts, sitOutCnt, partnerCnt, opponentCnt, rounds } = s);
      fixedMode = !!s.fixedMode;
      pairs     = s.pairs || [];
      renderSessionStats();
      reRenderAllRounds();
      document.getElementById('setup-view').style.display   = 'none';
      document.getElementById('session-view').style.display = 'block';
      updateRoundActions();
    }
  } catch (e) {
    localStorage.removeItem(STORAGE_KEY);
    location.reload();
  } finally {
    restoring = false;
  }
}

// ── Utilities ─────────────────────────────────────────────────

function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;')
                  .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Setup UI ──────────────────────────────────────────────────

function addPlayerRow(name = '', gender = 'M') {
  const list = document.getElementById('player-list');
  const div  = document.createElement('div');
  div.className = 'player-row';
  div.innerHTML = `
    <input type="text" placeholder="Name" value="${esc(name)}" oninput="onPlayerChange()">
    <button class="gender-btn ${gender === 'M' ? 'male' : 'female'}"
            onclick="toggleGender(this)">${gender}</button>
    <button class="remove-btn" onclick="this.closest('.player-row').remove(); onPlayerChange()">✕</button>`;
  list.appendChild(div);
  onPlayerChange();
}

function toggleGender(btn) {
  if (btn.textContent.trim() === 'M') { btn.textContent = 'W'; btn.className = 'gender-btn female'; }
  else                                 { btn.textContent = 'M'; btn.className = 'gender-btn male';   }
  saveState();
}

function getSetupRows() {
  return Array.from(document.querySelectorAll('#player-list .player-row'))
    .map(r => ({
      name:   r.querySelector('input[type="text"]').value.trim(),
      gender: r.querySelector('.gender-btn').textContent.trim()
    }));
}

function getFilledPlayers() {
  return getSetupRows().filter(p => p.name !== '');
}

function isFixedSetup() {
  return document.getElementById('fixed-mode').checked;
}

// Consecutive setup rows form a pair; a pair with one blank name is flagged incomplete.
function getFixedSetup() {
  const rows = getSetupRows();
  const ps = [], pr = [];
  let incomplete = false;
  for (let i = 0; i < rows.length; i += 2) {
    const a = rows[i], b = rows[i + 1];
    if (!a.name && (!b || !b.name)) continue;
    if (!a.name || !b || !b.name) { incomplete = true; continue; }
    pr.push([ps.length, ps.length + 1]);
    ps.push(a, b);
  }
  return { players: ps, pairs: pr, incomplete };
}

function onFixedModeChange() {
  const fixed = isFixedSetup();
  document.getElementById('player-list').classList.toggle('fixed', fixed);
  document.getElementById('add-player-btn').textContent = fixed ? '+ Add pair' : '+ Add player';
  if (fixed && document.querySelectorAll('#player-list .player-row').length % 2) addPlayerRow();
  onPlayerChange();
}

function addPlayerEntry() {
  addPlayerRow();
  if (isFixedSetup()) addPlayerRow();
}

function onPlayerChange() {
  document.getElementById('player-count').textContent = `(${getFilledPlayers().length})`;
  refreshHints();
}

function refreshHints() {
  saveState();
  const courts = parseInt(document.getElementById('court-count').value) || 0;
  const n      = getFilledPlayers().length;
  const hintEl = document.getElementById('court-hint');
  const warnEl = document.getElementById('court-warn');

  if (courts < 1) {
    hintEl.textContent = '';
    warnEl.innerHTML = '<div class="alert-err">Enter at least 1 court.</div>';
    return;
  }

  if (isFixedSetup()) {
    const { pairs: pr, incomplete } = getFixedSetup();
    const np = pr.length;
    const fw = [];
    if (incomplete) fw.push('Every pair needs two names \u2014 consecutive rows form a pair.');
    if (np < 2) {
      hintEl.textContent = `${courts} court${courts > 1 ? 's' : ''}`;
    } else {
      const actual = Math.min(courts, Math.floor(np / 2));
      const sitOut = np - actual * 2;
      hintEl.textContent = sitOut === 0
        ? `${actual} court${actual > 1 ? 's' : ''} \u2014 every pair plays every round`
        : `${actual} court${actual > 1 ? 's' : ''} \u2014 ${sitOut} pair${sitOut > 1 ? 's' : ''} sit${sitOut === 1 ? 's' : ''} out per round`;
      if (actual < courts)
        fw.push(`Only ${np} pairs available \u2014 ${actual} of ${courts} courts can be used. Add more pairs or reduce the court count.`);
    }
    warnEl.innerHTML = fw.map(w => `<div class="alert-warn">${w}</div>`).join('');
    return;
  }

  const warnings = [];

  if (n < 4) {
    hintEl.textContent = `${courts} court${courts > 1 ? 's' : ''}`;
    warnEl.innerHTML = '';
    return;
  }

  const actual  = Math.min(courts, Math.floor(n / 4));
  const sitOuts = n - actual * 4;

  hintEl.textContent = sitOuts === 0
    ? `${actual} court${actual > 1 ? 's' : ''} — everyone plays every round`
    : `${actual} court${actual > 1 ? 's' : ''} — ${sitOuts} player${sitOuts > 1 ? 's' : ''} sit${sitOuts === 1 ? 's' : ''} out per round`;

  if (actual < courts)
    warnings.push(`Only ${n} players available — ${actual} of ${courts} courts can be used. Add more players or reduce the court count.`);

  const rangeWarn = window.SESSION_CONFIG.playerRangeWarning(n);
  if (rangeWarn) warnings.push(rangeWarn);

  warnEl.innerHTML = warnings.map(w => `<div class="alert-warn">${w}</div>`).join('');
}

function startSession() {
  const courtVal = parseInt(document.getElementById('court-count').value);
  const fixed    = isFixedSetup();
  const fs       = fixed ? getFixedSetup() : null;
  const ps       = fixed ? fs.players : getFilledPlayers();
  const errEl    = document.getElementById('start-err');

  if (!courtVal || courtVal < 1) { errEl.textContent = 'Enter a valid number of courts.'; errEl.style.display = 'block'; return; }
  if (ps.length < 4)             { errEl.textContent = 'Add at least 4 players.';          errEl.style.display = 'block'; return; }
  if (fixed && fs.incomplete) { errEl.textContent = 'Every pair needs two names.'; errEl.style.display = 'block'; return; }
  errEl.style.display = 'none';

  players           = ps.map(p => ({ ...p, active: true }));
  fixedMode         = fixed;
  pairs             = fixed ? fs.pairs : [];
  requestedCourts   = courtVal;
  numCourts         = getEffectiveCourts();
  const n           = ps.length;

  sitOutCnt         = new Array(n).fill(0);
  partnerCnt        = Array.from({length: n}, () => new Array(n).fill(0));
  opponentCnt       = Array.from({length: n}, () => new Array(n).fill(0));
  rounds            = [];
  lastRoundCourtMap = {};

  renderSessionStats();
  renderLeaderboard();

  document.getElementById('rounds-container').innerHTML        = '';
  document.getElementById('manual-builder').style.display      = 'none';
  document.getElementById('edit-players-panel').style.display  = 'none';
  document.getElementById('setup-view').style.display          = 'none';
  document.getElementById('session-view').style.display        = 'block';
  updateRoundActions();
  saveState();
}

function renderSessionStats() {
  const activeIds = getActiveIds();
  const courts    = getEffectiveCourts();
  const n         = activeIds.length;

  if (fixedMode) {
    const np    = getActivePairs().length;
    const souts = np - courts * 2;
    document.getElementById('session-stats').innerHTML = `
      <div class="stat"><strong>${n}</strong>Players</div>
      <div class="stat"><strong>${np}</strong>Fixed pairs</div>
      <div class="stat"><strong>${courts}</strong>Courts</div>
      <div class="stat"><strong>${souts > 0 ? souts : 'None'}</strong>Pairs sit out / round</div>`;
    return;
  }

  const men       = activeIds.filter(i => players[i].gender === 'M').length;
  const souts     = n - courts * 4;

  document.getElementById('session-stats').innerHTML = `
    <div class="stat"><strong>${n}</strong>Players</div>
    <div class="stat"><strong>${men}M / ${n - men}W</strong>Split</div>
    <div class="stat"><strong>${courts}</strong>Courts</div>
    <div class="stat"><strong>${souts > 0 ? souts : 'None'}</strong>Sit out / round</div>`;
}

function resetSession() {
  if (!confirm('Reset the session? All rounds and player history will be lost.')) return;
  document.getElementById('session-view').style.display        = 'none';
  document.getElementById('setup-view').style.display          = 'block';
  document.getElementById('rounds-container').innerHTML        = '';
  document.getElementById('manual-builder').style.display      = 'none';
  document.getElementById('edit-players-panel').style.display  = 'none';
  players = []; rounds = []; sitOutCnt = []; partnerCnt = []; opponentCnt = [];
  fixedMode = false; pairs = [];
  lastRoundCourtMap = {};
  renderLeaderboard();
  saveState();
}

// ── Round action buttons ──────────────────────────────────────

function updateRoundActions() {
  const el = document.getElementById('round-actions');
  if (rounds.length === 0) {
    el.innerHTML = `
      <div class="round1-choice">
        <button class="btn-primary" onclick="generateNextRound()">Auto-generate Round 1</button>
        <button class="btn-secondary" onclick="showManualBuilder()">✏️ Build Round 1 manually</button>
      </div>`;
  } else {
    el.innerHTML = `
      <button class="btn-primary" onclick="generateNextRound()">Generate Round ${rounds.length + 1}</button>`;
  }
}

// ── Active players ────────────────────────────────────────────

function getActiveIds() {
  return players.map((_, i) => i).filter(i => players[i].active !== false);
}

function getActivePairs() {
  return pairs.filter(([a, b]) => players[a].active !== false && players[b].active !== false);
}

function getEffectiveCourts() {
  return fixedMode
    ? Math.min(requestedCourts, Math.floor(getActivePairs().length / 2))
    : Math.min(requestedCourts, Math.floor(getActiveIds().length / 4));
}

function buildLastRoundCourtMap() {
  lastRoundCourtMap = {};
  if (rounds.length === 0) return;
  const last = rounds[rounds.length - 1];
  last.courts.forEach(([pA, pB], ci) => {
    [...pA, ...pB].forEach(id => { lastRoundCourtMap[id] = ci; });
  });
}

// ── Manual Round Builder ──────────────────────────────────────

function showManualBuilder() {
  document.getElementById('round-actions').style.display      = 'none';
  document.getElementById('edit-players-panel').style.display = 'none';
  document.getElementById('manual-builder').style.display     = 'block';
  document.getElementById('manual-err').style.display         = 'none';
  buildManualCourts();
}

function cancelManualBuilder() {
  document.getElementById('manual-builder').style.display = 'none';
  document.getElementById('round-actions').style.display  = 'block';
}

function buildManualCourts() {
  const container = document.getElementById('manual-courts');
  let html = '';
  for (let c = 0; c < numCourts; c++) {
    html += `
      <div class="manual-court">
        <div class="court-label">Court ${c + 1}</div>
        <div class="manual-match">
          ${manualTeamHtml(c, 0)}
          <span class="vs">vs</span>
          ${manualTeamHtml(c, 1)}
        </div>
      </div>`;
  }
  container.innerHTML = html;
  container.querySelectorAll('select').forEach(sel => {
    sel.addEventListener('change', refreshManualSitOut);
  });
  refreshManualSitOut();
}

function manualTeamHtml(court, team) {
  if (fixedMode) return `<div class="manual-team">${pairSelect(court, team)}</div>`;
  return `<div class="manual-team">
            ${playerSelect(court, team * 2)} <span class="amp">&amp;</span> ${playerSelect(court, team * 2 + 1)}
          </div>`;
}

function pairLabel(k) {
  const [a, b] = pairs[k];
  return `${players[a].name} & ${players[b].name}`;
}

function pairSelect(court, slot) {
  let opts = '<option value="">\u2014 Select pair \u2014</option>';
  pairs.forEach((_, k) => { opts += `<option value="${k}">${esc(pairLabel(k))}</option>`; });
  return `<select data-court="${court}" data-slot="${slot}">${opts}</select>`;
}

function playerSelect(court, slot) {
  let opts = '<option value="">— Select —</option>';
  players.forEach((p, i) => {
    opts += `<option value="${i}">${esc(p.name)} (${p.gender})</option>`;
  });
  return `<select data-court="${court}" data-slot="${slot}">${opts}</select>`;
}

function getManualSelections() {
  return Array.from(document.querySelectorAll('#manual-courts select'))
    .map(s => s.value === '' ? -1 : parseInt(s.value));
}

function refreshManualSitOut() {
  const assigned = new Set(getManualSelections().filter(v => v >= 0));
  const labels   = fixedMode ? pairs.map((_, k) => pairLabel(k)) : players.map(p => p.name);
  const sitOuts  = labels.map((name, idx) => ({ name, idx }))
                         .filter(p => !assigned.has(p.idx));
  const el     = document.getElementById('manual-sit-out');
  const needed = labels.length - numCourts * (fixedMode ? 2 : 4);

  if (sitOuts.length === 0) {
    el.innerHTML = `<div class="manual-sit-out-info"><strong>All ${fixedMode ? 'pairs' : 'players'} assigned</strong></div>`;
  } else {
    const names     = sitOuts.map(p => esc(p.name)).join(', ');
    const countNote = needed > 0
      ? ` (${needed} need${needed === 1 ? 's' : ''} to sit out)`
      : '';
    el.innerHTML = `<div class="manual-sit-out-info"><strong>Unassigned${countNote}:</strong> ${names}</div>`;
  }
}

function confirmManualRound() {
  const errEl      = document.getElementById('manual-err');
  const selections = getManualSelections();

  if (selections.some(v => v < 0)) {
    errEl.textContent = `Please select a ${fixedMode ? 'pair' : 'player'} for every slot.`;
    errEl.style.display = 'block';
    return;
  }

  const seen = new Set();
  for (const v of selections) {
    if (seen.has(v)) {
      errEl.textContent = `"${fixedMode ? pairLabel(v) : players[v].name}" is assigned more than once. Each ${fixedMode ? 'pair' : 'player'} can only appear in one slot.`;
      errEl.style.display = 'block';
      return;
    }
    seen.add(v);
  }
  errEl.style.display = 'none';

  const ids = fixedMode ? selections.flatMap(k => pairs[k]) : selections;

  const courtsArr = [];
  for (let c = 0; c < numCourts; c++) {
    const base = c * 4;
    courtsArr.push([[ids[base], ids[base + 1]], [ids[base + 2], ids[base + 3]]]);
  }

  const assigned = new Set(ids);
  const sitIds   = players.map((_, i) => i).filter(i => !assigned.has(i));

  applyRoundCounts(sitIds, courtsArr);

  const round = { number: 1, courts: courtsArr, sitOuts: sitIds, scores: courtsArr.map(() => [null, null]) };
  rounds.push(round);
  renderRound(round);
  document.getElementById('manual-builder').style.display = 'none';
  document.getElementById('round-actions').style.display  = 'block';
  updateRoundActions();
  saveState();
}

// ── Edit Players ──────────────────────────────────────────────

function showEditPlayers() {
  document.getElementById('manual-builder').style.display     = 'none';
  document.getElementById('round-actions').style.display      = 'block';
  buildEditPlayerList();
  document.getElementById('edit-players-panel').style.display = 'block';
}

function hideEditPlayers() {
  document.getElementById('edit-players-panel').style.display = 'none';
}

function buildEditPlayerList() {
  const list = document.getElementById('edit-player-list');
  list.innerHTML = '';
  const pairKeyOf = {};
  pairs.forEach(([a, b], k) => { pairKeyOf[a] = pairKeyOf[b] = 'p' + k; });
  players.forEach((p, i) => {
    const inactive = p.active === false;
    const div = document.createElement('div');
    div.className   = 'player-row' + (inactive ? ' left-player' : '');
    div.dataset.idx = i;
    if (fixedMode) div.dataset.pairKey = pairKeyOf[i];    div.innerHTML = `
      <input type="text" value="${esc(p.name)}" placeholder="Name">
      <button class="gender-btn ${p.gender === 'M' ? 'male' : 'female'}"
              onclick="toggleEditGender(this)">${p.gender}</button>
      <button class="active-toggle ${inactive ? 'inactive' : ''}"
              onclick="toggleActiveStatus(this)">${inactive ? 'Left' : 'Active'}</button>`;
    list.appendChild(div);
  });

  // add player button
  const addBtn = document.createElement('button');
  addBtn.className = 'add-btn edit-add-btn';
  list.parentElement.querySelectorAll('.edit-add-btn').forEach(b => b.remove());
  addBtn.style.marginTop = '10px';
  addBtn.textContent = fixedMode ? '+ Add pair' : '+ Add player';
  addBtn.onclick = addEditPlayerRow;
  list.after(addBtn);
}

let newPairSeq = 0;

function makeNewEditRow(pairKey) {
  const div = document.createElement('div');
  div.className = 'player-row';
  div.dataset.new = 'true';   // no idx — signals a new player
  if (pairKey) div.dataset.pairKey = pairKey;
  div.innerHTML = `
    <input type="text" placeholder="Name">
    <button class="gender-btn male" onclick="toggleEditGender(this)">M</button>
    <button class="active-toggle" onclick="toggleActiveStatus(this)">Active</button>`;
  return div;
}

function addEditPlayerRow() {
  const list = document.getElementById('edit-player-list');
  if (fixedMode) {
    const key = 'n' + (newPairSeq++);
    list.appendChild(makeNewEditRow(key));
    list.appendChild(makeNewEditRow(key));
  } else {
    list.appendChild(makeNewEditRow());
  }
}

function toggleEditGender(btn) {
  if (btn.textContent.trim() === 'M') { btn.textContent = 'W'; btn.className = 'gender-btn female'; }
  else                                 { btn.textContent = 'M'; btn.className = 'gender-btn male';   }
}

// In fixed mode both partners leave/return together.
function toggleActiveStatus(btn) {
  const row         = btn.closest('.player-row');
  const nowInactive = !btn.classList.contains('inactive');
  const key         = row.dataset.pairKey;
  const rows        = fixedMode && key
    ? document.querySelectorAll(`#edit-player-list .player-row[data-pair-key="${key}"]`)
    : [row];
  rows.forEach(r => {
    const b = r.querySelector('.active-toggle');
    b.classList.toggle('inactive', nowInactive);
    b.textContent = nowInactive ? 'Left' : 'Active';
    r.classList.toggle('left-player', nowInactive);
  });
}

function saveEditPlayers() {
  // Update existing players
  document.querySelectorAll('#edit-player-list .player-row[data-idx]').forEach(row => {
    const idx       = parseInt(row.dataset.idx);
    const newName   = row.querySelector('input[type="text"]').value.trim();
    const newGender = row.querySelector('.gender-btn').textContent.trim();
    const isLeft    = row.querySelector('.active-toggle').classList.contains('inactive');
    if (newName) players[idx].name = newName;
    players[idx].gender = newGender;
    players[idx].active = !isLeft;
  });

  // Add new players
  const addPlayer = (name, gender) => {
    players.push({ name, gender, active: true });
    sitOutCnt.push(0);
    partnerCnt.forEach(r => r.push(0));
    partnerCnt.push(new Array(players.length).fill(0));
    opponentCnt.forEach(r => r.push(0));
    opponentCnt.push(new Array(players.length).fill(0));
    return players.length - 1;
  };
  const readRow = row => ({
    name:   row.querySelector('input[type="text"]').value.trim(),
    gender: row.querySelector('.gender-btn').textContent.trim()
  });
  const newRows = Array.from(document.querySelectorAll('#edit-player-list .player-row[data-new]'));

  if (fixedMode) {
    const groups = {};
    newRows.forEach(r => { (groups[r.dataset.pairKey] = groups[r.dataset.pairKey] || []).push(r); });
    Object.values(groups).forEach(([r1, r2]) => {
      const a = readRow(r1), b = readRow(r2);
      if (!a.name || !b.name) return;
      pairs.push([addPlayer(a.name, a.gender), addPlayer(b.name, b.gender)]);
    });
  } else {
    newRows.forEach(row => {
      const { name, gender } = readRow(row);
      if (name) addPlayer(name, gender);
    });
  }

  renderSessionStats();
  reRenderAllRounds();
  hideEditPlayers();
  updateRoundActions();
  saveState();
}

// ── Algorithm ─────────────────────────────────────────────────

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Players who were all 4 together in some past round and are still all active now —
// keeping any of them playing guarantees at least one repeat pairing among them.
function intactClusterMembers(activeIds) {
  const activeSet = new Set(activeIds);
  const members = new Set();
  rounds.forEach(round => {
    round.courts.forEach(([pA, pB]) => {
      const four = [...pA, ...pB];
      if (four.every(id => activeSet.has(id))) four.forEach(id => members.add(id));
    });
  });
  return members;
}

function selectSitOuts(activeIds, numSit) {
  if (numSit <= 0) return [];
  const lastSitOut = rounds.length > 0
    ? new Set(rounds[rounds.length - 1].sitOuts)
    : new Set();
  const clusterMembers = intactClusterMembers(activeIds);
  const order = [...activeIds];
  order.sort((a, b) => {
    const aScore = sitOutCnt[a] + (lastSitOut.has(a) ? 1000 : 0) - (clusterMembers.has(a) ? 0.5 : 0);
    const bScore = sitOutCnt[b] + (lastSitOut.has(b) ? 1000 : 0) - (clusterMembers.has(b) ? 0.5 : 0);
    const d = aScore - bScore;
    return d !== 0 ? d : (Math.random() < 0.5 ? -1 : 1);
  });
  return order.slice(0, numSit);
}

const sq = n => n * n;

// Any prior meeting (as partners or opponents) counts, and outranks the gender penalty (1000);
// partnering the same person again costs extra on top.
function splitRepeatScore(a, b, c, d) {
  const met = (x, y) => partnerCnt[x][y] + opponentCnt[x][y];
  return 1500 * (sq(met(a, b)) + sq(met(c, d)) + sq(met(a, c)) +
                 sq(met(a, d)) + sq(met(b, c)) + sq(met(b, d))) +
         3500 * (sq(partnerCnt[a][b]) + sq(partnerCnt[c][d]));
}

function lastCourtClusterScore(four) {
  const counts = {};
  for (const id of four) {
    const c = lastRoundCourtMap[id];
    if (c !== undefined) counts[c] = (counts[c] || 0) + 1;
  }
  let score = 0;
  for (const n of Object.values(counts)) if (n >= 3) score += 500;
  return score;
}

function splitGenderScore(a, b, c, d) {
  const teamAMixed = players[a].gender !== players[b].gender;
  const teamBMixed = players[c].gender !== players[d].gender;
  if (teamAMixed && teamBMixed) return 0;                                             // mixed pair vs mixed pair
  if (!teamAMixed && !teamBMixed && players[a].gender === players[c].gender) return 0; // all one gender
  return 1000;                                                                        // 3-1 split, or men-team vs women-team
}

function bestFoursomeSplit(four) {
  const [a, b, c, d] = four;
  const options = [[[a, b], [c, d]], [[a, c], [b, d]], [[a, d], [b, c]]];
  let best = null, bestScore = Infinity;
  for (const [pA, pB] of options) {
    const s = splitRepeatScore(pA[0], pA[1], pB[0], pB[1]) + splitGenderScore(pA[0], pA[1], pB[0], pB[1]);
    if (s < bestScore) { bestScore = s; best = [pA, pB]; }
  }
  return { court: best, score: bestScore };
}

function scoreFoursome(four) {
  const { court, score } = bestFoursomeSplit(four);
  return { court, score: score + lastCourtClusterScore(four) };
}

function foursomeScore(four) {
  return scoreFoursome(four).score;
}

// Simulated annealing over player swaps between foursomes; keeps the lowest-scoring grouping seen.
function generateCourts(activeIds, iters = 4000, assign = true) {
  const pool  = shuffle([...activeIds]);
  const fours = [];
  for (let i = 0; i < pool.length; i += 4) fours.push(pool.slice(i, i + 4));
  const nf  = fours.length;
  const sc  = fours.map(foursomeScore);
  let cur   = sc.reduce((a, b) => a + b, 0);
  let best  = fours.map(f => [...f]), bestTotal = cur;

  for (let it = 0; it < iters && nf > 1 && bestTotal > 0; it++) {
    const temp = 1500 * (1 - it / iters) + 1;
    const i  = Math.floor(Math.random() * nf);
    let j    = Math.floor(Math.random() * (nf - 1));
    if (j >= i) j++;
    const pi = Math.floor(Math.random() * 4), pj = Math.floor(Math.random() * 4);

    [fours[i][pi], fours[j][pj]] = [fours[j][pj], fours[i][pi]];
    const ni = foursomeScore(fours[i]), nj = foursomeScore(fours[j]);
    const delta = ni + nj - sc[i] - sc[j];
    if (delta <= 0 || Math.random() < Math.exp(-delta / temp)) {
      sc[i] = ni; sc[j] = nj; cur += delta;
      if (cur < bestTotal) { bestTotal = cur; best = fours.map(f => [...f]); }
    } else {
      [fours[i][pi], fours[j][pj]] = [fours[j][pj], fours[i][pi]];
    }
  }

  const courts = best.map(f => scoreFoursome(f).court);
  return assign ? assignCourts(courts) : courts;
}

function courtsScore(courts) {
  return courts.reduce((s, [[a, b], [c, d]]) =>
    s + splitRepeatScore(a, b, c, d) + splitGenderScore(a, b, c, d), 0);
}

function applyRoundCounts(sitIds, courtsArr) {
  sitIds.forEach(id => sitOutCnt[id]++);
  courtsArr.forEach(([pA, pB]) => {
    const [a1, a2] = pA, [b1, b2] = pB;
    partnerCnt[a1][a2]++; partnerCnt[a2][a1]++;
    partnerCnt[b1][b2]++; partnerCnt[b2][b1]++;
    opponentCnt[a1][b1]++; opponentCnt[b1][a1]++;
    opponentCnt[a1][b2]++; opponentCnt[b2][a1]++;
    opponentCnt[a2][b1]++; opponentCnt[b1][a2]++;
    opponentCnt[a2][b2]++; opponentCnt[b2][a2]++;
  });
}

// Temporarily swaps the global history so the real counts are untouched.
function rolloutRounds(sitIds, courts, future) {
  const saved = { sitOutCnt, partnerCnt, opponentCnt, rounds, lastRoundCourtMap };
  try {
    sitOutCnt   = [...sitOutCnt];
    partnerCnt  = partnerCnt.map(r => [...r]);
    opponentCnt = opponentCnt.map(r => [...r]);
    rounds      = [...rounds];
    applyRoundCounts(sitIds, courts);
    rounds.push({ courts, sitOuts: sitIds });

    let total = 0;
    for (let f = 0; f < future; f++) {
      buildLastRoundCourtMap();
      const ids    = getActiveIds();
      const sit    = selectSitOuts(ids, ids.length - getEffectiveCourts() * 4);
      const sitSet = new Set(sit);
      const c      = generateCourts(ids.filter(i => !sitSet.has(i)), 800, false);
      total += courtsScore(c);
      applyRoundCounts(sit, c);
      rounds.push({ courts: c, sitOuts: sit });
    }
    return total;
  } finally {
    ({ sitOutCnt, partnerCnt, opponentCnt, rounds, lastRoundCourtMap } = saved);
  }
}

// Greedy per-round choices can strand later rounds with forced repeats, so each candidate
// round is also scored by how well random playouts of the next few rounds go.
function planRound(effectiveCourts) {
  const activeIds = getActiveIds();
  const numSit    = activeIds.length - effectiveCourts * 4;
  const future    = 4;
  const rolls     = 3;

  let best = null, bestScore = Infinity;
  for (let t = 0; t < 10; t++) {
    const sitIds = selectSitOuts(activeIds, numSit);
    const sitSet = new Set(sitIds);
    const courts = generateCourts(activeIds.filter(i => !sitSet.has(i)), 5000, false);
    const now    = courtsScore(courts);
    if (now * 2 > bestScore) continue;

    let min = Infinity, sum = 0;
    for (let k = 0; k < rolls; k++) {
      const c = rolloutRounds(sitIds, courts, future);
      min = Math.min(min, c); sum += c;
    }
    const score = now * 2 + min + 0.1 * (sum / rolls);
    if (score < bestScore) { bestScore = score; best = { sitIds, courts }; }
  }
  return { sitIds: best.sitIds, courts: assignCourts(best.courts) };
}

// ── Court rotation ────────────────────────────────────────────

function courtOf(round, id) {
  return round.courts.findIndex(([pA, pB]) => pA.includes(id) || pB.includes(id));
}

function courtStreak(id, court) {
  let s = 0;
  for (let r = rounds.length - 1; r >= 0; r--) {
    if (courtOf(rounds[r], id) !== court) break;
    s++;
  }
  return s;
}

function courtTotal(id, court) {
  return rounds.filter(r => courtOf(r, id) === court).length;
}

// Two in a row is free; the penalty grows quickly after that.
function courtCost(four, court) {
  return four.reduce((sum, id) => {
    const s = courtStreak(id, court);
    return sum + (s >= 2 ? 100 * sq(s - 1) : 0) + 10 * courtTotal(id, court);
  }, 0);
}

// Brute-force over court orderings; fine for the handful of courts a club has.
function assignCourts(courts) {
  const n     = courts.length;
  const fours = courts.map(([pA, pB]) => [...pA, ...pB]);
  let bestPerm = null, bestCost = Infinity;
  (function permute(perm, used) {
    if (perm.length === n) {
      const cost = perm.reduce((s, c, f) => s + courtCost(fours[f], c), 0);
      if (cost < bestCost) { bestCost = cost; bestPerm = [...perm]; }
      return;
    }
    for (let c = 0; c < n; c++) {
      if (used.has(c)) continue;
      used.add(c); perm.push(c);
      permute(perm, used);
      perm.pop(); used.delete(c);
    }
  })([], new Set());
  const out = new Array(n);
  bestPerm.forEach((c, f) => { out[c] = courts[f]; });
  return out;
}

// ── Fixed pairs ────────────────────────────────────────────────

// The planner works on pair indices (0..n-1) with opp[i][j] = times pair i has faced pair j.

// Fewest sit-outs sit first; last round's sit-outs go to the back.
function pickSitPairs(n, numSit, sits, lastSit) {
  if (numSit <= 0) return [];
  const score = u => sits[u] + (lastSit.has(u) ? 1000 : 0);
  return shuffle([...Array(n).keys()]).sort((a, b) => score(a) - score(b)).slice(0, numSit);
}

// Most-constrained-first greedy: the pair with the fewest unplayed opponents left picks first.
function matchUnits(units, opp, tries) {
  let best = null, bestCost = Infinity;
  for (let t = 0; t < tries && bestCost > 0; t++) {
    const left = shuffle([...units]);
    const matches = [];
    let cost = 0;
    while (left.length) {
      let ui = 0, fewest = Infinity;
      left.forEach((u, k) => {
        const fresh = left.filter(v => v !== u && opp[u][v] === 0).length;
        if (fresh < fewest) { fewest = fresh; ui = k; }
      });
      const [u] = left.splice(ui, 1);
      let vi = 0;
      for (let k = 1; k < left.length; k++) if (opp[u][left[k]] < opp[u][left[vi]]) vi = k;
      const [v] = left.splice(vi, 1);
      matches.push([u, v]);
      cost += sq(opp[u][v]);
    }
    if (cost < bestCost) { bestCost = cost; best = matches; }
  }
  return { matches: best, cost: bestCost };
}

function applyPlanRound(opp, sits, matches, sit) {
  matches.forEach(([u, v]) => { opp[u][v]++; opp[v][u]++; });
  sit.forEach(u => { sits[u]++; });
}

// Plays out `future` more rounds greedily and returns the repeat matchups they accumulate.
function rolloutCost(n, courts, opp, sits, lastSit, future) {
  opp  = opp.map(r => [...r]);
  sits = [...sits];
  let total = 0;
  for (let r = 0; r < future; r++) {
    const sit     = pickSitPairs(n, n - courts * 2, sits, lastSit);
    const sitSet  = new Set(sit);
    const playing = [...Array(n).keys()].filter(u => !sitSet.has(u));
    const { matches, cost } = matchUnits(playing, opp, 3);
    total += cost;
    applyPlanRound(opp, sits, matches, sit);
    lastSit = sitSet;
  }
  return total;
}

// Greedy round-by-round matching can strand the last rounds with forced repeats, so each
// candidate round is scored by how well random playouts of the remaining rounds go.
function planFixedRound(activePairs, courts) {
  const n        = activePairs.length;
  const opp0     = activePairs.map(p => activePairs.map(q => opponentCnt[p[0]][q[0]]));
  const sits0    = activePairs.map(p => sitOutCnt[p[0]]);   // partners always sit together
  const lastIds  = rounds.length > 0 ? new Set(rounds[rounds.length - 1].sitOuts) : new Set();
  const lastSit0 = new Set(activePairs.map((p, i) => i).filter(i => lastIds.has(activePairs[i][0])));
  const future   = Math.min(8, Math.max(0, n - rounds.length - 1));   // aim for one round-robin's worth
  const trials   = n <= 12 ? 60 : 15;
  const rolls    = n <= 12 ? 8 : 3;

  let best = null, bestScore = Infinity;
  for (let t = 0; t < trials; t++) {
    const sit     = pickSitPairs(n, n - courts * 2, sits0, lastSit0);
    const sitSet  = new Set(sit);
    const playing = [...Array(n).keys()].filter(u => !sitSet.has(u));
    const { matches, cost } = matchUnits(playing, opp0, 6);
    if (cost * 10 > bestScore) continue;

    let score = cost * 10;
    if (future > 0) {
      const opp  = opp0.map(r => [...r]);
      const sits = [...sits0];
      applyPlanRound(opp, sits, matches, sit);
      let min = Infinity, sum = 0;
      for (let k = 0; k < rolls; k++) {
        const c = rolloutCost(n, courts, opp, sits, sitSet, future);
        min = Math.min(min, c); sum += c;
      }
      score += min + 0.1 * (sum / rolls);
    }
    if (score < bestScore) { bestScore = score; best = { matches, sit }; }
  }

  return {
    courts:   best.matches.map(([u, v]) => [[...activePairs[u]], [...activePairs[v]]]),
    sitPairs: best.sit.map(u => activePairs[u])
  };
}

function generateNextRound() {
  const effectiveCourts = getEffectiveCourts();
  let sitIds, courtsArr;

  buildLastRoundCourtMap();
  if (fixedMode) {
    const plan = planFixedRound(getActivePairs(), effectiveCourts);
    sitIds    = plan.sitPairs.flat();
    courtsArr = assignCourts(plan.courts);
  } else {
    const plan = planRound(effectiveCourts);
    sitIds    = plan.sitIds;
    courtsArr = plan.courts;
  }

  applyRoundCounts(sitIds, courtsArr);

  const round = { number: rounds.length + 1, courts: courtsArr, sitOuts: sitIds, scores: courtsArr.map(() => [null, null]) };
  rounds.push(round);
  renderRound(round);
  updateRoundActions();
  saveState();
}

// ── Render ────────────────────────────────────────────────────

function chip(id) {
  const p = players[id];
  return `<span class="player-chip ${p.gender === 'M' ? 'm' : 'f'}">${esc(p.name)}</span>`;
}

function badge(a, b) {
  if (fixedMode)                              return '<span class="pair-badge badge-same">Fixed pair</span>';
  if (partnerCnt[a][b] > 1)                   return '<span class="pair-badge badge-repeat">⚠ Repeat</span>';
  if (players[a].gender !== players[b].gender) return '<span class="pair-badge badge-mixed">Mixed</span>';
  return '<span class="pair-badge badge-same">Same sex</span>';
}

function matchHasRepeat(pA, pB) {
  const [a1, a2] = pA, [b1, b2] = pB;
  if (fixedMode) return opponentCnt[a1][b1] > 1;
  const ids = [a1, a2, b1, b2];
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      if (partnerCnt[ids[i]][ids[j]] + opponentCnt[ids[i]][ids[j]] > 1) return true;
    }
  }
  return false;
}

function createRoundElement(round) {
  let courtsHtml = '';
  round.courts.forEach(([pA, pB], ci) => {
    const [a1, a2] = pA, [b1, b2] = pB;
    const repeatWarn = matchHasRepeat(pA, pB)
    ? `<div class="match-repeat-warn">⚠ ${fixedMode ? 'These pairs have' : 'Some players in this match have'} played ${fixedMode ? 'each other' : 'together or against each other'} before</div>`
    : '';
    const sc = (round.scores && round.scores[ci]) || [null, null];
    const scoreInput = team => `<input type="number" min="0" inputmode="numeric" class="score-input" value="${sc[team] ?? ''}"
             data-round="${round.number}" data-court="${ci}" data-team="${team}" oninput="onScoreInput(this)">`;
    courtsHtml += `
      <div class="court-block">
        <div class="court-label">Court ${ci + 1}</div>
        <div class="match-line">
          ${chip(a1)} <span class="amp">&amp;</span> ${chip(a2)} ${badge(a1, a2)}
          <span class="vs">vs</span>
          ${chip(b1)} <span class="amp">&amp;</span> ${chip(b2)} ${badge(b1, b2)}
        </div>
        ${repeatWarn}
        <div class="score-row">Score ${scoreInput(0)} <span>&ndash;</span> ${scoreInput(1)}</div>
      </div>`;
  });
  const sitHtml = round.sitOuts.length
    ? `<div class="sit-out-bar"><strong>Sitting out:</strong> ${round.sitOuts.map(id => esc(players[id].name)).join(', ')}</div>`
    : '';
  const div = document.createElement('div');
  div.className = 'round-card';
  div.innerHTML = `
    <div class="round-header">ROUND ${round.number}</div>
    <div class="round-body">${courtsHtml}${sitHtml}</div>`;
  return div;
}

function onScoreInput(input) {
  const round = rounds.find(r => r.number === parseInt(input.dataset.round));
  const ci    = parseInt(input.dataset.court);
  const v     = parseInt(input.value);
  round.scores = round.scores || [];
  const cur   = round.scores[ci] || [null, null];
  cur[parseInt(input.dataset.team)] = Number.isNaN(v) ? null : Math.max(0, v);
  round.scores[ci] = cur;
  renderLeaderboard();
  saveState();
}

function computeStandings() {
  const st = players.map((p, id) => ({ name: p.name, w: 0, d: 0, l: 0, gf: 0, ga: 0, played: false }));
  const tally = (p, gf, ga) => {
    p.played = true;
    p.gf += gf; p.ga += ga;
    if (gf > ga) p.w++; else if (gf < ga) p.l++; else p.d++;
  };
  rounds.forEach(r => r.courts.forEach(([pA, pB], ci) => {
    const s = r.scores && r.scores[ci];
    if (!s || s[0] == null || s[1] == null) return;
    pA.forEach(id => tally(st[id], s[0], s[1]));
    pB.forEach(id => tally(st[id], s[1], s[0]));
  }));
  const pts = p => p.w * 3 + p.d;
  return st.filter(p => p.played).sort((a, b) =>
    pts(b) - pts(a) || (b.gf - b.ga) - (a.gf - a.ga) || b.gf - a.gf || a.name.localeCompare(b.name));
}

function renderLeaderboard() {
  const el = document.getElementById('leaderboard');
  const st = computeStandings();
  if (st.length === 0) { el.innerHTML = ''; return; }
  const rows = st.map((p, i) => {
    const diff = p.gf - p.ga;
    return `<tr><td>${i + 1}</td><td>${esc(p.name)}</td><td>${p.w + p.d + p.l}</td>
      <td>${p.w}</td><td>${p.d}</td><td>${p.l}</td><td>${p.gf}</td><td>${p.ga}</td>
      <td>${diff > 0 ? '+' : ''}${diff}</td><td><strong>${p.w * 3 + p.d}</strong></td></tr>`;
  }).join('');
  el.innerHTML = `
    <div class="card">
      <div class="card-title">Leaderboard</div>
      <div class="lb-scroll">
        <table class="lb-table">
          <thead><tr><th>#</th><th>Player</th><th>P</th><th>W</th><th>D</th><th>L</th><th>GF</th><th>GA</th><th>GD</th><th>Pts</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;
}

function renderRound(round) {
  const c = document.getElementById('rounds-container');
  c.insertBefore(createRoundElement(round), c.firstChild);
}

function reRenderAllRounds() {
  const c = document.getElementById('rounds-container');
  c.innerHTML = '';
  rounds.forEach(r => c.insertBefore(createRoundElement(r), c.firstChild));
  renderLeaderboard();
}

// ── Init ──────────────────────────────────────────────────────
(function () {
  const cfg = window.SESSION_CONFIG;
  restoreState();
  if (getSetupRows().length === 0)
    for (let i = 0; i < cfg.defaultPlayers; i++) addPlayerRow();
  refreshHints();
})();