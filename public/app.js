/**
 * Steam Ban Tracker - frontend
 */

const API = '';

async function fetchJson(path) {
  const res = await fetch(API + path);
  if (!res.ok) throw new Error(res.statusText);
  return res.json();
}

function escapeHtml(s) {
  if (s == null) return '';
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

function profileLink(steamid64) {
  return `https://steamcommunity.com/profiles/${steamid64}`;
}

function linkCell(steamid64) {
  return `<a href="${profileLink(steamid64)}" target="_blank">Profil Steam</a>`;
}

async function loadStats() {
  const stats = await fetchJson('/api/stats');
  document.getElementById('total-profiles').textContent = stats.totalProfiles;
  document.getElementById('vac-banned').textContent = stats.vacBannedCount;
  document.getElementById('game-banned').textContent = stats.gameBannedCount;
  document.getElementById('community-banned').textContent = stats.communityBannedCount;
}

function banTypeBadges(r) {
  const badges = [];
  if (r.vac_banned) badges.push('<span class="badge-ban badge-vac">VAC</span>');
  if (r.game_ban_count > 0) badges.push(`<span class="badge-ban badge-game">Game (${r.game_ban_count})</span>`);
  if (r.community_banned) badges.push('<span class="badge-ban badge-community">Community</span>');
  return badges.join(' ') || '—';
}

function avatarCell(avatar) {
  return avatar
    ? `<img src="${escapeHtml(avatar)}" alt="" class="avatar">`
    : '—';
}

async function loadAllBanned() {
  const rows = await fetchJson('/api/banned');
  const tbody = document.getElementById('all-banned-table');
  if (rows.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty-msg">Aucun bannissement détecté</td></tr>';
    return;
  }
  tbody.innerHTML = rows.map(r => {
    const details = [];
    if (r.vac_banned) details.push(`${r.vac_count} VAC, dernier: il y a ${r.days_since_last_ban ?? '?'} j`);
    if (r.game_ban_count > 0 && !r.vac_banned) details.push(`${r.game_ban_count} game ban(s)`);
    return `
    <tr>
      <td>${avatarCell(r.avatar)}</td>
      <td>${escapeHtml(r.persona_name)}</td>
      <td class="mono">${escapeHtml(r.steamid64)}</td>
      <td class="mono">${escapeHtml(r.steamid)}</td>
      <td>${banTypeBadges(r)}</td>
      <td>${details.join(' | ') || '—'}</td>
      <td>${linkCell(r.steamid64)}</td>
    </tr>
  `}).join('');
}

async function loadVacBanned() {
  const rows = await fetchJson('/api/vac-banned');
  const tbody = document.getElementById('vac-banned-table');
  if (rows.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty-msg">Aucun profil VAC banni</td></tr>';
    return;
  }
  tbody.innerHTML = rows.map(r => `
    <tr>
      <td>${avatarCell(r.avatar)}</td>
      <td>${escapeHtml(r.persona_name)}</td>
      <td class="mono">${escapeHtml(r.steamid)}</td>
      <td>${r.vac_count}</td>
      <td>${r.days_since_last_ban ?? '—'}</td>
      <td>${r.last_ban_date ? r.last_ban_date.slice(0, 10) : '—'}</td>
      <td>${linkCell(r.steamid64)}</td>
    </tr>
  `).join('');
}

async function loadGameBanned() {
  const rows = await fetchJson('/api/game-banned');
  const tbody = document.getElementById('game-banned-table');
  if (rows.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty-msg">Aucun profil Game banni</td></tr>';
    return;
  }
  tbody.innerHTML = rows.map(r => `
    <tr>
      <td>${avatarCell(r.avatar)}</td>
      <td>${escapeHtml(r.persona_name)}</td>
      <td class="mono">${escapeHtml(r.steamid)}</td>
      <td>${r.game_ban_count}</td>
      <td>${linkCell(r.steamid64)}</td>
    </tr>
  `).join('');
}

async function loadCommunityBanned() {
  const rows = await fetchJson('/api/community-banned');
  const tbody = document.getElementById('community-banned-table');
  if (rows.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" class="empty-msg">Aucun profil Community banni</td></tr>';
    return;
  }
  tbody.innerHTML = rows.map(r => `
    <tr>
      <td>${avatarCell(r.avatar)}</td>
      <td>${escapeHtml(r.persona_name)}</td>
      <td class="mono">${escapeHtml(r.steamid)}</td>
      <td>${linkCell(r.steamid64)}</td>
    </tr>
  `).join('');
}

async function loadProfiles() {
  const rows = await fetchJson('/api/profiles?limit=50');
  const tbody = document.getElementById('profiles-table');
  if (rows.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty-msg">Aucun profil</td></tr>';
    return;
  }
  tbody.innerHTML = rows.map(r => {
    const banBadge = banTypeBadges(r);
    const scraped = r.scraped_at ? new Date(r.scraped_at).toLocaleString('fr-FR') : '—';
    return `
    <tr>
      <td>${avatarCell(r.avatar)}</td>
      <td>${escapeHtml(r.persona_name)}</td>
      <td class="mono">${escapeHtml(r.steamid64)}</td>
      <td>${banBadge}</td>
      <td>${scraped}</td>
      <td>${linkCell(r.steamid64)}</td>
    </tr>
  `}).join('');
}

async function refresh() {
  const btn = document.getElementById('refresh');
  btn.disabled = true;
  btn.textContent = 'Chargement…';
  try {
    await Promise.all([
      loadStats(),
      loadAllBanned(),
      loadVacBanned(),
      loadGameBanned(),
      loadCommunityBanned(),
      loadProfiles()
    ]);
  } catch (err) {
    console.error(err);
    alert('Erreur de chargement. Vérifiez que le serveur tourne (npm run server) et que steam-data.db existe.');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Actualiser';
  }
}

document.getElementById('refresh').addEventListener('click', refresh);
refresh();
