/**
 * Steam Ban Tracker - frontend
 */

const API = '';
const PAGE_SIZE = 50;

let pageBanned = 0;
let pageProfiles = 0;
let totalBanned = 0;
let totalProfiles = 0;

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

function renderPagination(containerId, page, total, pageSize, onPrev, onNext) {
  const el = document.getElementById(containerId);
  if (!el) return;
  if (total === 0) {
    el.innerHTML = '';
    return;
  }
  const start = page * pageSize + 1;
  const end = Math.min((page + 1) * pageSize, total);
  const totalPages = Math.ceil(total / pageSize);
  el.innerHTML = `
    <span class="pagination-info">${start}–${end} sur ${total}</span>
    <div class="pagination-btns">
      <button type="button" data-action="prev" ${page === 0 ? 'disabled' : ''}>Précédent</button>
      <button type="button" data-action="next" ${page >= totalPages - 1 ? 'disabled' : ''}>Suivant</button>
    </div>
  `;
  el.querySelector('[data-action="prev"]')?.addEventListener('click', onPrev);
  el.querySelector('[data-action="next"]')?.addEventListener('click', onNext);
}

async function loadAllBanned() {
  const offset = pageBanned * PAGE_SIZE;
  const data = await fetchJson(`/api/banned?limit=${PAGE_SIZE}&offset=${offset}`);
  const rows = data.rows ?? [];
  totalBanned = data.total ?? 0;

  const tbody = document.getElementById('all-banned-table');
  if (rows.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty-msg">Aucun bannissement détecté</td></tr>';
  } else {
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

  renderPagination('pagination-banned', pageBanned, totalBanned, PAGE_SIZE,
    () => { pageBanned--; loadAllBanned(); },
    () => { pageBanned++; loadAllBanned(); }
  );
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

let chartBansTime = null;

async function loadChartYears() {
  const sel = document.getElementById('chart-year');
  if (!sel) return;
  const byBan = document.getElementById('chart-view')?.value === 'ban';
  const url = byBan ? '/api/stats-years?by=ban' : '/api/stats-years';
  let years = [];
  try {
    years = await fetchJson(url);
    if (!Array.isArray(years)) years = [];
  } catch (_) {}
  const current = sel.value;
  sel.innerHTML = '<option value="">Toutes</option>' + years.map((y) => `<option value="${y}">${y}</option>`).join('');
  if (current && years.includes(parseInt(current, 10))) sel.value = current;
}

async function loadChart() {
  const yearParam = (document.getElementById('chart-year')?.value || '').trim();
  const byBan = document.getElementById('chart-view')?.value === 'ban';
  let url = '/api/stats-over-time';
  if (byBan) url += '?by=ban';
  if (yearParam) url += (byBan ? '&' : '?') + 'year=' + encodeURIComponent(yearParam);

  const desc = document.getElementById('chart-desc');
  if (desc) desc.textContent = byBan
    ? 'Nombre de bans VAC par jour (date estimée du ban — Steam donne « jours depuis dernier ban »)'
    : 'Bans détectés par jour (date du scraping)';

  let rows = [];
  try {
    rows = await fetchJson(url);
    if (!Array.isArray(rows)) rows = [];
  } catch (e) {
    rows = [];
    const emptyMsgEl = document.getElementById('chart-empty-msg');
    if (emptyMsgEl) {
      emptyMsgEl.textContent = 'Erreur de chargement. Lancez le serveur : npm run server';
      emptyMsgEl.style.display = 'block';
    }
    document.getElementById('chart-bans-time').style.display = 'none';
    return;
  }

  const canvas = document.getElementById('chart-bans-time');
  const emptyMsg = document.getElementById('chart-empty-msg');
  if (!canvas) return;
  if (typeof Chart === 'undefined') {
    if (emptyMsg) { emptyMsg.textContent = 'Chart.js non chargé.'; emptyMsg.style.display = 'block'; }
    canvas.style.display = 'none';
    return;
  }

  if (chartBansTime) {
    chartBansTime.destroy();
    chartBansTime = null;
  }

  if (rows.length === 0) {
    if (emptyMsg) {
      emptyMsg.textContent = 'Aucune donnée temporelle (scraper au moins une fois).';
      emptyMsg.style.display = 'block';
    }
    canvas.style.display = 'none';
    return;
  }
  if (emptyMsg) emptyMsg.style.display = 'none';
  canvas.style.display = 'block';

  const labels = rows.map((r) => r.day);
  const vac = rows.map((r) => Number(r.vac) || 0);
  const game = rows.map((r) => Number(r.game) || 0);
  const community = rows.map((r) => Number(r.community) || 0);

  const datasets = [
    { label: 'VAC', data: vac, backgroundColor: 'rgba(248, 81, 73, 0.8)', borderColor: '#f85149', borderWidth: 1 }
  ];
  if (!byBan) {
    datasets.push(
      { label: 'Game', data: game, backgroundColor: 'rgba(210, 153, 34, 0.8)', borderColor: '#d29922', borderWidth: 1 },
      { label: 'Community', data: community, backgroundColor: 'rgba(139, 148, 158, 0.8)', borderColor: '#8b949e', borderWidth: 1 }
    );
  }

  const maxTicks = 25;
  const step = Math.max(1, Math.floor(labels.length / maxTicks));

  const ctx = canvas.getContext('2d');
  chartBansTime = new Chart(ctx, {
    type: 'bar',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      aspectRatio: 2.2,
      scales: {
        x: {
          title: { display: true, text: 'Date' },
          ticks: {
            maxTicksLimit: maxTicks,
            maxRotation: 45,
            minRotation: 0,
            callback(_, i) { return (i % step === 0 || i === labels.length - 1) ? this.getLabelForValue(i) : ''; }
          }
        },
        y: { beginAtZero: true, title: { display: true, text: 'Nombre de bans' } }
      },
      plugins: {
        legend: { position: 'top' },
        tooltip: { mode: 'index', intersect: false }
      },
      barPercentage: 0.85,
      categoryPercentage: 0.9
    }
  });
}

async function loadProfiles() {
  const offset = pageProfiles * PAGE_SIZE;
  const data = await fetchJson(`/api/profiles?limit=${PAGE_SIZE}&offset=${offset}`);
  const rows = data.rows ?? [];
  totalProfiles = data.total ?? 0;

  const tbody = document.getElementById('profiles-table');
  if (rows.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty-msg">Aucun profil</td></tr>';
  } else {
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

  renderPagination('pagination-profiles', pageProfiles, totalProfiles, PAGE_SIZE,
    () => { pageProfiles--; loadProfiles(); },
    () => { pageProfiles++; loadProfiles(); }
  );
}

async function refresh() {
  const btn = document.getElementById('refresh');
  btn.disabled = true;
  btn.textContent = 'Chargement…';
  try {
    await loadStats();
    await loadChartYears();
    await loadChart();
    await Promise.all([
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

document.getElementById('refresh').addEventListener('click', () => {
  pageBanned = 0;
  pageProfiles = 0;
  refresh();
});
document.getElementById('chart-year')?.addEventListener('change', loadChart);
document.getElementById('chart-view')?.addEventListener('change', () => {
  loadChartYears().then(loadChart);
});
refresh();
