// ── State ──────────────────────────────────────────────────────
let players           = [];
let numCourts         = 0;
let sitOutCnt         = [];
let partnerCnt        = [];
let opponentCnt       = [];
let rounds            = [];
let requestedCourts   = 0;
let lastRoundCourtMap = {};

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
}

function getFilledPlayers() {
  return Array.from(document.querySelectorAll('#player-list .player-row'))
    .map(r => ({
      name:   r.querySelector('input[type="text"]').value.trim(),
      gender: r.querySelector('.gender-btn').textContent.trim()
    }))
    .filter(p => p.name !== '');
}

function onPlayerChange() {
  document.getElementById('player-count').textContent = `(${getFilledPlayers().length})`;
  refreshHints();
}

function refreshHints() {
  const courts = parseInt(document.getElementById('court-count').value) || 0;
  const n      = getFilledPlayers().length;
  const hintEl = document.getElementById('court-hint');
  const warnEl = document.getElementById('court-warn');

  if (courts < 1) {
    hintEl.textContent = '';
    warnEl.innerHTML = '<div class="alert-err">Enter at least 1 court.</div>';
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
  const ps       = getFilledPlayers();
  const errEl    = document.getElementById('start-err');

  if (!courtVal || courtVal < 1) { errEl.textContent = 'Enter a valid number of courts.'; errEl.style.display = 'block'; return; }
  if (ps.length < 4)             { errEl.textContent = 'Add at least 4 players.';          errEl.style.display = 'block'; return; }
  errEl.style.display = 'none';

  players           = ps.map(p => ({ ...p, active: true }));
  requestedCourts   = courtVal;
  numCourts         = Math.min(courtVal, Math.floor(ps.length / 4));
  const n           = ps.length;

  sitOutCnt         = new Array(n).fill(0);
  partnerCnt        = Array.from({length: n}, () => new Array(n).fill(0));
  opponentCnt       = Array.from({length: n}, () => new Array(n).fill(0));
  rounds            = [];
  lastRoundCourtMap = {};

  const men   = ps.filter(p => p.gender === 'M').length;
  const women = ps.filter(p => p.gender === 'W').length;
  const souts = n - numCourts * 4;

  document.getElementById('session-stats').innerHTML = `
    <div class="stat"><strong>${n}</strong>Players</div>
    <div class="stat"><strong>${men}M / ${women}W</strong>Split</div>
    <div class="stat"><strong>${numCourts}</strong>Courts</div>
    <div class="stat"><strong>${souts > 0 ? souts : 'None'}</strong>Sit out / round</div>`;

  document.getElementById('rounds-container').innerHTML        = '';
  document.getElementById('manual-builder').style.display      = 'none';
  document.getElementById('edit-players-panel').style.display  = 'none';
  document.getElementById('setup-view').style.display          = 'none';
  document.getElementById('session-view').style.display        = 'block';
  updateRoundActions();
}

function resetSession() {
  document.getElementById('session-view').style.display        = 'none';
  document.getElementById('setup-view').style.display          = 'block';
  document.getElementById('rounds-container').innerHTML        = '';
  document.getElementById('manual-builder').style.display      = 'none';
  document.getElementById('edit-players-panel').style.display  = 'none';
  players = []; rounds = []; sitOutCnt = []; partnerCnt = []; opponentCnt = [];
  lastRoundCourtMap = {};
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

function getEffectiveCourts() {
  return Math.min(requestedCourts, Math.floor(getActiveIds().length / 4));
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
          <div class="manual-team">
            ${playerSelect(c, 0)} <span class="amp">&amp;</span> ${playerSelect(c, 1)}
          </div>
          <span class="vs">vs</span>
          <div class="manual-team">
            ${playerSelect(c, 2)} <span class="amp">&amp;</span> ${playerSelect(c, 3)}
          </div>
        </div>
      </div>`;
  }
  container.innerHTML = html;
  container.querySelectorAll('select').forEach(sel => {
    sel.addEventListener('change', refreshManualSitOut);
  });
  refreshManualSitOut();
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
  const sitOuts  = players.map((p, i) => ({ name: p.name, idx: i }))
                          .filter(p => !assigned.has(p.idx));
  const el     = document.getElementById('manual-sit-out');
  const needed = players.length - numCourts * 4;

  if (sitOuts.length === 0) {
    el.innerHTML = '<div class="manual-sit-out-info"><strong>All players assigned</strong></div>';
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
    errEl.textContent = 'Please select a player for every slot.';
    errEl.style.display = 'block';
    return;
  }

  const seen = new Set();
  for (const v of selections) {
    if (seen.has(v)) {
      errEl.textContent = `"${players[v].name}" is assigned more than once. Each player can only appear in one slot.`;
      errEl.style.display = 'block';
      return;
    }
    seen.add(v);
  }
  errEl.style.display = 'none';

  const courtsArr = [];
  for (let c = 0; c < numCourts; c++) {
    const base = c * 4;
    courtsArr.push([[selections[base], selections[base + 1]], [selections[base + 2], selections[base + 3]]]);
  }

  const assigned = new Set(selections);
  const sitIds   = players.map((_, i) => i).filter(i => !assigned.has(i));

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

  const round = { number: 1, courts: courtsArr, sitOuts: sitIds };
  rounds.push(round);
  renderRound(round);
  document.getElementById('manual-builder').style.display = 'none';
  document.getElementById('round-actions').style.display  = 'block';
  updateRoundActions();
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
  players.forEach((p, i) => {
    const inactive = p.active === false;
    const div = document.createElement('div');
    div.className   = 'player-row' + (inactive ? ' left-player' : '');
    div.dataset.idx = i;
    div.innerHTML = `
      <input type="text" value="${esc(p.name)}" placeholder="Name">
      <button class="gender-btn ${p.gender === 'M' ? 'male' : 'female'}"
              onclick="toggleEditGender(this)">${p.gender}</button>
      <button class="active-toggle ${inactive ? 'inactive' : ''}"
              onclick="toggleActiveStatus(this)">${inactive ? 'Left' : 'Active'}</button>`;
    list.appendChild(div);
  });

  // add player button
  const addBtn = document.createElement('button');
  addBtn.className = 'add-btn';
  addBtn.style.marginTop = '10px';
  addBtn.textContent = '+ Add player';
  addBtn.onclick = addEditPlayerRow;
  list.after(addBtn);
}

function addEditPlayerRow() {
  const list = document.getElementById('edit-player-list');
  const div = document.createElement('div');
  div.className = 'player-row';
  div.dataset.new = 'true';   // no idx — signals a new player
  div.innerHTML = `
    <input type="text" placeholder="Name">
    <button class="gender-btn male" onclick="toggleEditGender(this)">M</button>
    <button class="active-toggle" onclick="toggleActiveStatus(this)">Active</button>`;
  list.appendChild(div);
}

function toggleEditGender(btn) {
  if (btn.textContent.trim() === 'M') { btn.textContent = 'W'; btn.className = 'gender-btn female'; }
  else                                 { btn.textContent = 'M'; btn.className = 'gender-btn male';   }
}

function toggleActiveStatus(btn) {
  const row         = btn.closest('.player-row');
  const nowInactive = !btn.classList.contains('inactive');
  btn.classList.toggle('inactive', nowInactive);
  btn.textContent = nowInactive ? 'Left' : 'Active';
  row.classList.toggle('left-player', nowInactive);
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
  document.querySelectorAll('#edit-player-list .player-row[data-new]').forEach(row => {
    const name   = row.querySelector('input[type="text"]').value.trim();
    const gender = row.querySelector('.gender-btn').textContent.trim();
    if (!name) return;
    players.push({ name, gender, active: true });
    sitOutCnt.push(0);
    partnerCnt.forEach(r => r.push(0));
    partnerCnt.push(new Array(players.length).fill(0));
    opponentCnt.forEach(r => r.push(0));
    opponentCnt.push(new Array(players.length).fill(0));
  });

  const activeIds       = getActiveIds();
  const effectiveCourts = getEffectiveCourts();
  const n     = activeIds.length;
  const men   = activeIds.filter(i => players[i].gender === 'M').length;
  const women = n - men;
  const souts = n - effectiveCourts * 4;

  document.getElementById('session-stats').innerHTML = `
    <div class="stat"><strong>${n}</strong>Players</div>
    <div class="stat"><strong>${men}M / ${women}W</strong>Split</div>
    <div class="stat"><strong>${effectiveCourts}</strong>Courts</div>
    <div class="stat"><strong>${souts > 0 ? souts : 'None'}</strong>Sit out / round</div>`;

  reRenderAllRounds();
  hideEditPlayers();
  updateRoundActions();
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

function pairHistory(x, y) {
  return partnerCnt[x][y] + opponentCnt[x][y];
}

function splitRepeatScore(a, b, c, d) {
  return 500 * (pairHistory(a, b) + pairHistory(c, d) +
                pairHistory(a, c) + pairHistory(a, d) +
                pairHistory(b, c) + pairHistory(b, d));
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

function improveGrouping(foursomes) {
  let improved = true;
  while (improved) {
    improved = false;
    for (let i = 0; i < foursomes.length; i++) {
      for (let j = i + 1; j < foursomes.length; j++) {
        for (let pi = 0; pi < 4; pi++) {
          for (let pj = 0; pj < 4; pj++) {
            const before = foursomeScore(foursomes[i]) + foursomeScore(foursomes[j]);
            [foursomes[i][pi], foursomes[j][pj]] = [foursomes[j][pj], foursomes[i][pi]];
            const after = foursomeScore(foursomes[i]) + foursomeScore(foursomes[j]);
            if (after < before) {
              improved = true;
            } else {
              [foursomes[i][pi], foursomes[j][pj]] = [foursomes[j][pj], foursomes[i][pi]]; // revert
            }
          }
        }
      }
    }
  }
  return foursomes;
}

// Tries many random groupings of active players into foursomes and keeps
// whichever full round has the lowest combined repeat/gender-split score.
function generateCourts(activeIds) {
  let bestCourts = null, bestTotal = Infinity;
  for (let t = 0; t < 300; t++) {
    const pool = shuffle([...activeIds]);
    let foursomes = [];
    for (let i = 0; i < pool.length; i += 4) foursomes.push(pool.slice(i, i + 4));
    foursomes = improveGrouping(foursomes);

    const courts = [];
    let total = 0;
    foursomes.forEach(four => {
      const { court, score } = scoreFoursome(four);
      courts.push(court);
      total += score;
    });
    if (total < bestTotal) { bestTotal = total; bestCourts = courts; }
  }
  return bestCourts;
}

function generateNextRound() {
  const effectiveCourts = getEffectiveCourts();
  const activeIds       = getActiveIds();
  const numSit          = activeIds.length - effectiveCourts * 4;
  const sitIds          = selectSitOuts(activeIds, numSit);
  const sitSet          = new Set(sitIds);
  const active          = activeIds.filter(i => !sitSet.has(i));

  buildLastRoundCourtMap();
  const courtsArr = generateCourts(active);

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

  const round = { number: rounds.length + 1, courts: courtsArr, sitOuts: sitIds };
  rounds.push(round);
  renderRound(round);
  updateRoundActions();
}

// ── Render ────────────────────────────────────────────────────

function chip(id) {
  const p = players[id];
  return `<span class="player-chip ${p.gender === 'M' ? 'm' : 'f'}">${esc(p.name)}</span>`;
}

function badge(a, b) {
  if (partnerCnt[a][b] > 1)                   return '<span class="pair-badge badge-repeat">⚠ Repeat</span>';
  if (players[a].gender !== players[b].gender) return '<span class="pair-badge badge-mixed">Mixed</span>';
  return '<span class="pair-badge badge-same">Same sex</span>';
}

function matchHasRepeat(pA, pB) {
  const [a1, a2] = pA, [b1, b2] = pB;
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
    ? '<div class="match-repeat-warn">⚠ Some players in this match have played together or against each other before</div>'
    : '';
    courtsHtml += `
      <div class="court-block">
        <div class="court-label">Court ${ci + 1}</div>
        <div class="match-line">
          ${chip(a1)} <span class="amp">&amp;</span> ${chip(a2)} ${badge(a1, a2)}
          <span class="vs">vs</span>
          ${chip(b1)} <span class="amp">&amp;</span> ${chip(b2)} ${badge(b1, b2)}
        </div>
        ${repeatWarn}
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

function renderRound(round) {
  const c = document.getElementById('rounds-container');
  c.insertBefore(createRoundElement(round), c.firstChild);
}

function reRenderAllRounds() {
  const c = document.getElementById('rounds-container');
  c.innerHTML = '';
  rounds.forEach(r => c.insertBefore(createRoundElement(r), c.firstChild));
}

// ── Init ──────────────────────────────────────────────────────
(function () {
  const cfg = window.SESSION_CONFIG;
  for (let i = 0; i < cfg.defaultPlayers; i++) addPlayerRow();
  refreshHints();
})();