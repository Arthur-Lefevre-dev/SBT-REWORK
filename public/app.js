/**
 * Steam Ban Tracker - frontend
 */

const API = "";
const PAGE_SIZE = 10;

let pageBanned = 0;
let pageProfiles = 0;
let pageVac = 0;
let pageGame = 0;
let pageCommunity = 0;
let totalBanned = 0;
let totalProfiles = 0;
let totalVac = 0;
let totalGame = 0;
let totalCommunity = 0;
let searchQuery = '';

async function fetchJson(path) {
  const res = await fetch(API + path);
  if (!res.ok) throw new Error(res.statusText);
  return res.json();
}

function escapeHtml(s) {
  if (s == null) return "";
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}

function profileLink(steamid64) {
  return `https://steamcommunity.com/profiles/${steamid64}`;
}

/** Link to our site's profile page */
function profilePageUrl(steamid64) {
  return `/profile/${encodeURIComponent(steamid64)}`;
}

function linkCell(steamid64) {
  const steam = profileLink(steamid64);
  const internal = profilePageUrl(steamid64);
  return `<a href="${steam}" target="_blank" rel="noopener">Steam</a> <a href="${internal}">Profil</a>`;
}

/** Profile name as link to our site's profile page */
function nameCell(personaName, steamid64) {
  const name = escapeHtml(personaName || "—");
  const url = profilePageUrl(steamid64);
  return `<a href="${url}" class="link-profile">${name}</a>`;
}

/** Avatar, optionally linked to our profile page */
function avatarCell(avatar, steamid64) {
  const img = avatar
    ? `<img src="${escapeHtml(avatar)}" alt="" class="avatar">`
    : "—";
  if (!img || img === "—") return img;
  const url = steamid64 ? profilePageUrl(steamid64) : null;
  return url ? `<a href="${url}">${img}</a>` : img;
}

async function loadStats() {
  const stats = await fetchJson("/api/stats");
  document.getElementById("total-profiles").textContent = stats.totalProfiles;
  document.getElementById("vac-banned").textContent = stats.vacBannedCount;
  document.getElementById("game-banned").textContent = stats.gameBannedCount;
  document.getElementById("community-banned").textContent =
    stats.communityBannedCount;
}

function banTypeBadges(r) {
  const badges = [];
  if (r.vac_banned) badges.push('<span class="badge-ban badge-vac">VAC</span>');
  if (r.game_ban_count > 0)
    badges.push(
      `<span class="badge-ban badge-game">Game (${r.game_ban_count})</span>`,
    );
  if (r.community_banned)
    badges.push('<span class="badge-ban badge-community">Community</span>');
  return badges.join(" ") || "—";
}


function renderPagination(containerId, page, total, pageSize, onPrev, onNext) {
  const el = document.getElementById(containerId);
  if (!el) return;
  const t = (window.I18N && window.I18N.t) ? window.I18N.t.bind(window.I18N) : (k) => k;
  if (total === 0) {
    el.innerHTML = "";
    return;
  }
  const start = page * pageSize + 1;
  const end = Math.min((page + 1) * pageSize, total);
  const totalPages = Math.ceil(total / pageSize);
  const infoText = (t('home.pagination.info') || '{start}–{end} sur {total}')
    .replace('{start}', start).replace('{end}', end).replace('{total}', total);
  el.innerHTML = `
    <span class="pagination-info">${infoText}</span>
    <div class="pagination-btns">
      <button type="button" data-action="prev" ${page === 0 ? "disabled" : ""}>${t('home.pagination.prev') || 'Précédent'}</button>
      <button type="button" data-action="next" ${page >= totalPages - 1 ? "disabled" : ""}>${t('home.pagination.next') || 'Suivant'}</button>
    </div>
  `;
  el.querySelector('[data-action="prev"]')?.addEventListener("click", onPrev);
  el.querySelector('[data-action="next"]')?.addEventListener("click", onNext);
}

async function loadAllBanned() {
  const offset = pageBanned * PAGE_SIZE;
  const searchParam = searchQuery ? `&search=${encodeURIComponent(searchQuery)}` : '';
  const data = await fetchJson(
    `/api/banned?limit=${PAGE_SIZE}&offset=${offset}${searchParam}`,
  );
  const rows = data.rows ?? [];
  totalBanned = data.total ?? 0;

  const tbody = document.getElementById("all-banned-table");
  if (rows.length === 0) {
    tbody.innerHTML =
      '<tr><td colspan="7" class="empty-msg">' + ((window.I18N && window.I18N.t && window.I18N.t('home.table.empty.banned')) || 'Aucun bannissement détecté') + '</td></tr>';
  } else {
    tbody.innerHTML = rows
      .map((r) => {
        const details = [];
        if (r.vac_banned)
          details.push(
            `${r.vac_count} VAC, dernier: il y a ${r.days_since_last_ban ?? "?"} j`,
          );
        if (r.game_ban_count > 0 && !r.vac_banned) {
          let s = `${r.game_ban_count} game ban(s)`;
          if (r.game_ban_days_since_last != null)
            s += `, dernier: il y a ${r.game_ban_days_since_last} j`;
          details.push(s);
        }
        return `
      <tr>
        <td>${avatarCell(r.avatar, r.steamid64)}</td>
        <td>${nameCell(r.persona_name, r.steamid64)}</td>
        <td class="mono">${escapeHtml(r.steamid64)}</td>
        <td class="mono">${escapeHtml(r.steamid)}</td>
        <td>${banTypeBadges(r)}</td>
        <td>${details.join(" | ") || "—"}</td>
        <td>${linkCell(r.steamid64)}</td>
      </tr>
    `;
      })
      .join("");
  }

  renderPagination(
    "pagination-banned",
    pageBanned,
    totalBanned,
    PAGE_SIZE,
    () => {
      pageBanned--;
      loadAllBanned();
    },
    () => {
      pageBanned++;
      loadAllBanned();
    },
  );
}

async function loadVacBanned() {
  const offset = pageVac * PAGE_SIZE;
  const data = await fetchJson(`/api/vac-banned?limit=${PAGE_SIZE}&offset=${offset}`);
  const rows = data.rows ?? [];
  totalVac = data.total ?? 0;
  const tbody = document.getElementById("vac-banned-table");
  if (rows.length === 0) {
    tbody.innerHTML =
      '<tr><td colspan="7" class="empty-msg">' + ((window.I18N && window.I18N.t && window.I18N.t('home.table.empty.vac')) || 'Aucun VAC ban détecté') + '</td></tr>';
  } else {
    tbody.innerHTML = rows
      .map(
        (r) => `
    <tr>
      <td>${avatarCell(r.avatar, r.steamid64)}</td>
      <td>${nameCell(r.persona_name, r.steamid64)}</td>
      <td class="mono">${escapeHtml(r.steamid)}</td>
      <td>${r.vac_count}</td>
      <td>${r.days_since_last_ban ?? "—"}</td>
      <td>${r.last_ban_date ? r.last_ban_date.slice(0, 10) : "—"}</td>
      <td>${linkCell(r.steamid64)}</td>
    </tr>
  `,
      )
      .join("");
  }
  renderPagination(
    "pagination-vac",
    pageVac,
    totalVac,
    PAGE_SIZE,
    () => { pageVac--; loadVacBanned(); },
    () => { pageVac++; loadVacBanned(); },
  );
}

async function loadGameBanned() {
  const offset = pageGame * PAGE_SIZE;
  const data = await fetchJson(`/api/game-banned?limit=${PAGE_SIZE}&offset=${offset}`);
  const rows = data.rows ?? [];
  totalGame = data.total ?? 0;
  const tbody = document.getElementById("game-banned-table");
  if (rows.length === 0) {
    tbody.innerHTML =
      '<tr><td colspan="6" class="empty-msg">' + ((window.I18N && window.I18N.t && window.I18N.t('home.table.empty.game')) || 'Aucun Game ban détecté') + '</td></tr>';
  } else {
    tbody.innerHTML = rows
      .map(
        (r) => `
    <tr>
      <td>${avatarCell(r.avatar, r.steamid64)}</td>
      <td>${nameCell(r.persona_name, r.steamid64)}</td>
      <td class="mono">${escapeHtml(r.steamid)}</td>
      <td>${r.game_ban_count}</td>
      <td>${r.game_ban_days_since_last != null ? r.game_ban_days_since_last + ' j' : '—'}</td>
      <td>${linkCell(r.steamid64)}</td>
    </tr>
  `,
      )
      .join("");
  }
  renderPagination(
    "pagination-game",
    pageGame,
    totalGame,
    PAGE_SIZE,
    () => { pageGame--; loadGameBanned(); },
    () => { pageGame++; loadGameBanned(); },
  );
}

async function loadCommunityBanned() {
  const offset = pageCommunity * PAGE_SIZE;
  const data = await fetchJson(`/api/community-banned?limit=${PAGE_SIZE}&offset=${offset}`);
  const rows = data.rows ?? [];
  totalCommunity = data.total ?? 0;
  const tbody = document.getElementById("community-banned-table");
  if (rows.length === 0) {
    tbody.innerHTML =
      '<tr><td colspan="4" class="empty-msg">' + ((window.I18N && window.I18N.t && window.I18N.t('home.table.empty.community')) || 'Aucun Community ban détecté') + '</td></tr>';
  } else {
    tbody.innerHTML = rows
      .map(
        (r) => `
    <tr>
      <td>${avatarCell(r.avatar, r.steamid64)}</td>
      <td>${nameCell(r.persona_name, r.steamid64)}</td>
      <td class="mono">${escapeHtml(r.steamid)}</td>
      <td>${linkCell(r.steamid64)}</td>
    </tr>
  `,
      )
      .join("");
  }
  renderPagination(
    "pagination-community",
    pageCommunity,
    totalCommunity,
    PAGE_SIZE,
    () => { pageCommunity--; loadCommunityBanned(); },
    () => { pageCommunity++; loadCommunityBanned(); },
  );
}

let chartBansTime = null;

async function loadChartYears() {
  const sel = document.getElementById("chart-year");
  if (!sel) return;
  const byBan = document.getElementById("chart-view")?.value === "ban";
  const url = byBan ? "/api/stats-years?by=ban" : "/api/stats-years";
  let years = [];
  try {
    years = await fetchJson(url);
    if (!Array.isArray(years)) years = [];
  } catch (_) {}
  const current = sel.value;
  sel.innerHTML =
    '<option value="">Toutes</option>' +
    years.map((y) => `<option value="${y}">${y}</option>`).join("");
  if (current && years.includes(parseInt(current, 10))) sel.value = current;
}

async function loadChart() {
  const yearParam = (document.getElementById("chart-year")?.value || "").trim();
  const byBan = document.getElementById("chart-view")?.value === "ban";
  let url = "/api/stats-over-time";
  if (byBan) url += "?by=ban";
  if (yearParam)
    url += (byBan ? "&" : "?") + "year=" + encodeURIComponent(yearParam);

  let rows = [];
  try {
    rows = await fetchJson(url);
    if (!Array.isArray(rows)) rows = [];
  } catch (e) {
    rows = [];
    const emptyMsgEl = document.getElementById("chart-empty-msg");
    if (emptyMsgEl) {
      emptyMsgEl.textContent =
        "Erreur de chargement. Lancez le serveur : npm run server";
      emptyMsgEl.style.display = "block";
    }
    document.getElementById("chart-bans-time").style.display = "none";
    return;
  }

  const desc = document.getElementById("chart-desc");
  if (desc) {
    const THRESHOLD_DAYS = 100;
    const isAggregated = rows.length > THRESHOLD_DAYS && !yearParam;
    const aggregationNote = isAggregated ? " (agrégé par semaine pour lisibilité)" : "";
    desc.textContent = byBan
      ? `Nombre de bans VAC et Game${isAggregated ? ' par semaine' : ' par jour'}${aggregationNote} (date estimée du ban)`
      : `Bans détectés${isAggregated ? ' par semaine' : ' par jour'}${aggregationNote} (date du scraping)`;
  }

  const canvas = document.getElementById("chart-bans-time");
  const emptyMsg = document.getElementById("chart-empty-msg");
  if (!canvas) return;
  if (typeof Chart === "undefined") {
    if (emptyMsg) {
      emptyMsg.textContent = "Chart.js non chargé.";
      emptyMsg.style.display = "block";
    }
    canvas.style.display = "none";
    return;
  }

  if (chartBansTime) {
    chartBansTime.destroy();
    chartBansTime = null;
  }

  if (rows.length === 0) {
    if (emptyMsg) {
      emptyMsg.textContent =
        (window.I18N && window.I18N.t && window.I18N.t('home.chart.empty')) || "Aucune donnée temporelle (scraper au moins une fois).";
      emptyMsg.style.display = "block";
    }
    canvas.style.display = "none";
    return;
  }
  if (emptyMsg) emptyMsg.style.display = "none";
  canvas.style.display = "block";

  // Aggregate by week if too many days (> 100) for better visibility
  const THRESHOLD_DAYS = 100;
  let labels, vac, game, community;
  
  if (rows.length > THRESHOLD_DAYS && !yearParam) {
    // Aggregate by week (simple week number from start of year)
    const byWeek = {};
    for (const r of rows) {
      const date = new Date(r.day + 'T12:00:00Z');
      const year = date.getUTCFullYear();
      const startOfYear = new Date(Date.UTC(year, 0, 1));
      const daysDiff = Math.floor((date - startOfYear) / (24 * 60 * 60 * 1000));
      const weekNum = Math.floor(daysDiff / 7);
      const weekKey = `${year}-W${String(weekNum + 1).padStart(2, '0')}`;
      
      if (!byWeek[weekKey]) {
        byWeek[weekKey] = { vac: 0, game: 0, community: 0, startDay: r.day };
      }
      byWeek[weekKey].vac += Number(r.vac) || 0;
      byWeek[weekKey].game += Number(r.game) || 0;
      byWeek[weekKey].community += Number(r.community) || 0;
    }
    
    const sortedWeeks = Object.keys(byWeek).sort();
    labels = sortedWeeks.map(w => {
      const d = byWeek[w].startDay;
      if (d) {
        const date = new Date(d + 'T12:00:00Z');
        const weekStart = new Date(date);
        weekStart.setUTCDate(date.getUTCDate() - date.getUTCDay());
        return weekStart.toISOString().slice(0, 10);
      }
      return w;
    });
    vac = sortedWeeks.map(w => byWeek[w].vac);
    game = sortedWeeks.map(w => byWeek[w].game);
    community = sortedWeeks.map(w => byWeek[w].community);
  } else {
    labels = rows.map((r) => r.day);
    vac = rows.map((r) => Number(r.vac) || 0);
    game = rows.map((r) => Number(r.game) || 0);
    community = rows.map((r) => Number(r.community) || 0);
  }

  // Calculate max bar thickness based on number of data points
  const dataPoints = labels.length;
  const maxBarThickness = dataPoints > 200 ? 30 : dataPoints > 100 ? 40 : dataPoints > 50 ? 50 : undefined;
  
  const datasets = [
    {
      label: "VAC",
      data: vac,
      backgroundColor: "rgba(248, 81, 73, 0.95)",
      borderColor: "#f85149",
      borderWidth: 2.5,
      borderRadius: 4,
      maxBarThickness: maxBarThickness,
      minBarLength: 3,
    },
    {
      label: "Game",
      data: game,
      backgroundColor: "rgba(210, 153, 34, 0.95)",
      borderColor: "#d29922",
      borderWidth: 2.5,
      borderRadius: 4,
      maxBarThickness: maxBarThickness,
      minBarLength: 3,
    },
  ];

  const maxTicks = Math.min(40, Math.max(8, Math.floor(dataPoints / 2)));
  const step = Math.max(1, Math.floor(dataPoints / maxTicks));

  function formatAxisDate(isoDate) {
    if (!isoDate || isoDate.length < 10) return isoDate;
    const d = new Date(isoDate.slice(0, 10) + "T12:00:00Z");
    if (isNaN(d.getTime())) return isoDate;
    return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "2-digit" });
  }

  function formatTooltipDate(isoDate) {
    if (!isoDate || isoDate.length < 10) return isoDate;
    const d = new Date(isoDate.slice(0, 10) + "T12:00:00Z");
    if (isNaN(d.getTime())) return isoDate;
    return d.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "long", year: "numeric" });
  }

  const ctx = canvas.getContext("2d");
  
  // Zoom plugin is auto-registered when loaded via CDN
  const resetZoomBtn = document.getElementById('chart-reset-zoom');
  const updateResetButton = () => {
    if (resetZoomBtn && chartBansTime) {
      try {
        const isZoomed = chartBansTime.isZoomed?.() || false;
        resetZoomBtn.style.display = isZoomed ? 'block' : 'none';
      } catch (_) {
        resetZoomBtn.style.display = 'none';
      }
    }
  };

  chartBansTime = new Chart(ctx, {
    type: "bar",
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      layout: {
        padding: { top: 10, bottom: 10, left: 5, right: 5 }
      },
      scales: {
        x: {
          title: { 
            display: true, 
            text: "Date",
            color: 'var(--text-muted)',
            font: { size: 12, weight: '600' }
          },
          ticks: {
            maxTicksLimit: maxTicks,
            maxRotation: 0,
            minRotation: 0,
            autoSkip: true,
            color: 'var(--text-muted)',
            font: { size: 10 },
            callback: function (value) {
              var raw = typeof value === "number" && value >= 0 && value < labels.length ? labels[value] : value;
              if (raw == null) return "";
              return typeof raw === "string" && raw.length >= 10 ? formatAxisDate(raw) : String(raw);
            },
          },
          grid: {
            color: 'var(--border)',
            drawBorder: false
          }
        },
        y: {
          beginAtZero: true,
          title: { 
            display: true, 
            text: "Nombre de bans",
            color: 'var(--text-muted)',
            font: { size: 12, weight: '600' }
          },
          ticks: {
            color: 'var(--text-muted)',
            font: { size: 10 },
            precision: 0
          },
          grid: {
            color: 'var(--border)',
            drawBorder: false
          }
        },
      },
      plugins: {
        legend: { 
          position: "top",
          labels: {
            color: 'var(--text)',
            font: { size: 11 },
            padding: 12,
            usePointStyle: true,
            pointStyle: 'rect'
          }
        },
        tooltip: {
          enabled: true,
          mode: "index",
          intersect: false,
          backgroundColor: 'rgba(22, 27, 34, 0.95)',
          titleColor: '#ffffff',
          bodyColor: '#e6edf3',
          borderColor: 'var(--border)',
          borderWidth: 1,
          padding: 10,
          displayColors: true,
          titleFont: { size: 13, weight: 'bold' },
          bodyFont: { size: 12 },
          callbacks: {
            title: function (tooltipItems) {
              var i = (tooltipItems[0] && tooltipItems[0].dataIndex) != null ? tooltipItems[0].dataIndex : -1;
              var raw = i >= 0 && labels[i] != null ? labels[i] : "";
              return typeof raw === "string" && raw.length >= 10 ? formatTooltipDate(raw) : (raw || "Date");
            },
            beforeBody: function (tooltipItems) {
              var i = (tooltipItems[0] && tooltipItems[0].dataIndex) != null ? tooltipItems[0].dataIndex : -1;
              var raw = i >= 0 && labels[i] != null ? labels[i] : "";
              var dateStr = typeof raw === "string" && raw.length >= 10 ? formatTooltipDate(raw) : (raw || "");
              return dateStr ? ["Date : " + dateStr] : [];
            },
            label: function (context) {
              return context.dataset.label + " : " + context.parsed.y;
            },
          },
        },
        zoom: {
          pan: {
            enabled: true,
            mode: 'x',
            modifierKey: null,
            threshold: 10
          },
          zoom: {
            wheel: {
              enabled: true,
              speed: 0.1
            },
            pinch: {
              enabled: true
            },
            drag: {
              enabled: false
            },
            mode: 'x',
            onZoomComplete: updateResetButton,
            onZoom: updateResetButton
          },
          limits: {
            x: { min: 'original', max: 'original' }
          }
        }
      },
      barPercentage: dataPoints > THRESHOLD_DAYS ? 1.0 : 0.95,
      categoryPercentage: dataPoints > THRESHOLD_DAYS ? 1.0 : 0.98,
      animation: {
        duration: 300
      },
      interaction: {
        intersect: false,
        mode: 'index'
      },
      onHover: (event, activeElements) => {
        canvas.style.cursor = activeElements.length > 0 ? 'pointer' : 'default';
      }
    },
  });

  if (resetZoomBtn) {
    resetZoomBtn.onclick = () => {
      if (chartBansTime) {
        try {
          if (chartBansTime.resetZoom) {
            chartBansTime.resetZoom();
          }
        } catch (_) {}
        updateResetButton();
      }
    };
  }
  
  // Update reset button visibility periodically and on zoom events
  setTimeout(updateResetButton, 100);
  if (chartBansTime && chartBansTime.canvas) {
    chartBansTime.canvas.addEventListener('wheel', updateResetButton);
  }
}

async function loadProfiles() {
  const offset = pageProfiles * PAGE_SIZE;
  const searchParam = searchQuery ? `&search=${encodeURIComponent(searchQuery)}` : '';
  const data = await fetchJson(
    `/api/profiles?limit=${PAGE_SIZE}&offset=${offset}${searchParam}`,
  );
  const rows = data.rows ?? [];
  totalProfiles = data.total ?? 0;

  const tbody = document.getElementById("profiles-table");
  if (rows.length === 0) {
    tbody.innerHTML =
      '<tr><td colspan="6" class="empty-msg">' + ((window.I18N && window.I18N.t && window.I18N.t('home.table.empty.profiles')) || 'Aucun profil dans la base pour le moment') + '</td></tr>';
  } else {
    tbody.innerHTML = rows
      .map((r) => {
        const banBadge = banTypeBadges(r);
        const scraped = r.scraped_at
          ? new Date(r.scraped_at).toLocaleString("fr-FR")
          : "—";
        return `
      <tr>
        <td>${avatarCell(r.avatar, r.steamid64)}</td>
        <td>${nameCell(r.persona_name, r.steamid64)}</td>
        <td class="mono">${escapeHtml(r.steamid64)}</td>
        <td>${banBadge}</td>
        <td>${scraped}</td>
        <td>${linkCell(r.steamid64)}</td>
      </tr>
    `;
      })
      .join("");
  }

  renderPagination(
    "pagination-profiles",
    pageProfiles,
    totalProfiles,
    PAGE_SIZE,
    () => {
      pageProfiles--;
      loadProfiles();
    },
    () => {
      pageProfiles++;
      loadProfiles();
    },
  );
}

async function refresh() {
  const btn = document.getElementById("refresh");
  btn.disabled = true;
  btn.textContent = "Chargement…";
  try {
    await loadStats();
    await loadChartYears();
    await loadChart();
    await Promise.all([
      loadAllBanned(),
      loadVacBanned(),
      loadGameBanned(),
      loadCommunityBanned(),
      loadProfiles(),
    ]);
  } catch (err) {
    console.error(err);
    const msg = (window.I18N && window.I18N.t && window.I18N.t('home.refresh.error'))
      || "Erreur de chargement. Vérifiez que le serveur tourne (npm run server) et que steam-data.db existe.";
    alert(msg);
  } finally {
    btn.disabled = false;
    btn.textContent = (window.I18N && window.I18N.t && window.I18N.t('home.refresh')) || "Actualiser";
  }
}

document.getElementById("refresh").addEventListener("click", () => {
  pageBanned = 0;
  pageProfiles = 0;
  pageVac = 0;
  pageGame = 0;
  pageCommunity = 0;
  refresh();
});

// Search functionality
const searchInput = document.getElementById('search-input');
const searchClear = document.getElementById('search-clear');
const searchSuggestionsEl = document.getElementById('search-suggestions');

/**
 * Parse Steam profile URL or raw SteamID64; returns { type: 'steam64', value } or { type: 'vanity', value } or null
 */
function parseSteamProfileUrl(str) {
  const s = (str && String(str).trim()) || '';
  if (!s) return null;
  // Raw 17-digit SteamID64 (e.g. pasted number only)
  if (/^\d{17}$/.test(s)) return { type: 'steam64', value: s };
  // steamcommunity.com/profiles/76561198000000000 (with optional protocol, www, trailing slash or query)
  const profilesMatch = s.match(/steamcommunity\.com\/profiles\/(\d{17})/i);
  if (profilesMatch) return { type: 'steam64', value: profilesMatch[1] };
  // steamcommunity.com/id/username (letters, numbers, underscore, hyphen)
  const idMatch = s.match(/steamcommunity\.com\/id\/([a-zA-Z0-9_-]+)/i);
  if (idMatch) return { type: 'vanity', value: idMatch[1] };
  return null;
}

function handleSearch() {
  const raw = searchInput ? searchInput.value.trim() : '';
  const parsed = parseSteamProfileUrl(raw);
  if (parsed) {
    if (parsed.type === 'steam64') {
      window.location.href = '/profile/' + encodeURIComponent(parsed.value);
      return;
    }
    if (parsed.type === 'vanity') {
      fetchJson('/api/resolve-vanity?vanity=' + encodeURIComponent(parsed.value))
        .then((data) => {
          if (data && data.steamid64) {
            window.location.href = '/profile/' + encodeURIComponent(data.steamid64);
          } else {
            handleSearchAsQuery(raw);
          }
        })
        .catch(() => handleSearchAsQuery(raw));
      return;
    }
  }
  handleSearchAsQuery(raw);
}

function handleSearchAsQuery(raw) {
  searchQuery = raw;
  if (searchClear) searchClear.style.display = searchQuery ? 'block' : 'none';
  pageBanned = 0;
  pageProfiles = 0;
  loadAllBanned();
  loadProfiles();
  const url = new URL(window.location.href);
  if (searchQuery) url.searchParams.set('search', searchQuery);
  else url.searchParams.delete('search');
  const newUrl = url.pathname + (url.searchParams.toString() ? '?' + url.searchParams.toString() : '');
  if (window.location.pathname + window.location.search !== newUrl) {
    window.history.replaceState(null, '', newUrl);
  }
}

function hideSuggestions() {
  if (searchSuggestionsEl) {
    searchSuggestionsEl.style.display = 'none';
    searchSuggestionsEl.innerHTML = '';
  }
}

async function fetchSuggestions(q) {
  if (!q || q.length < 2) return [];
  try {
    return await fetchJson('/api/search?q=' + encodeURIComponent(q) + '&limit=12');
  } catch (_) {
    return [];
  }
}

function renderSuggestions(profiles) {
  if (!searchSuggestionsEl) return;
  if (!Array.isArray(profiles) || profiles.length === 0) {
    searchSuggestionsEl.innerHTML = '';
    searchSuggestionsEl.style.display = 'none';
    return;
  }
  searchSuggestionsEl.innerHTML = profiles
    .map(function (p) {
      const name = escapeHtml(p.persona_name || '—');
      const id = escapeHtml(p.steamid64 || '');
      const avatar = p.avatar ? '<img src="' + escapeHtml(p.avatar) + '" alt="">' : '';
      const url = '/profile/' + encodeURIComponent(p.steamid64);
      return '<a href="' + url + '" class="search-suggestion-item" data-steamid64="' + id + '">' + avatar + '<span class="suggestion-name">' + name + '</span><span class="suggestion-id">' + escapeHtml(p.steamid || p.steamid64 || '') + '</span></a>';
    })
    .join('');
  searchSuggestionsEl.style.display = 'block';
}

if (searchInput) {
  const urlParams = new URLSearchParams(window.location.search);
  const q = urlParams.get('search');
  if (q != null && q !== '') {
    searchInput.value = q;
    searchQuery = q;
    if (searchClear) searchClear.style.display = 'block';
  }
  let searchTimeout;
  let suggestionsTimeout;
  searchInput.addEventListener('input', function () {
    const query = searchInput.value.trim();
    clearTimeout(searchTimeout);
    clearTimeout(suggestionsTimeout);
    searchTimeout = setTimeout(function () {
      handleSearchAsQuery(query);
    }, 300);
    if (query.length >= 2 && !parseSteamProfileUrl(query)) {
      suggestionsTimeout = setTimeout(async function () {
        const profiles = await fetchSuggestions(query);
        if (searchInput.value.trim() === query) renderSuggestions(profiles);
      }, 200);
    } else {
      hideSuggestions();
    }
  });
  searchInput.addEventListener('focus', function () {
    const query = searchInput.value.trim();
    if (query.length >= 2) fetchSuggestions(query).then(renderSuggestions);
  });
  searchInput.addEventListener('blur', function () {
    setTimeout(hideSuggestions, 150);
  });
  searchInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      clearTimeout(searchTimeout);
      clearTimeout(suggestionsTimeout);
      handleSearch();
      hideSuggestions();
    }
    if (e.key === 'Escape') hideSuggestions();
  });
  const searchSubmit = document.getElementById('search-submit');
  if (searchSubmit) {
    searchSubmit.addEventListener('click', function () {
      clearTimeout(searchTimeout);
      clearTimeout(suggestionsTimeout);
      handleSearch();
      hideSuggestions();
    });
  }
}

if (searchSuggestionsEl) {
  searchSuggestionsEl.addEventListener('mousedown', function (e) {
    const a = e.target.closest('a.search-suggestion-item');
    if (a && a.href) {
      e.preventDefault();
      window.location.href = a.getAttribute('href');
    }
  });
}

if (searchClear) {
  searchClear.addEventListener('click', function () {
    if (searchInput) searchInput.value = '';
    searchQuery = '';
    searchClear.style.display = 'none';
    pageBanned = 0;
    pageProfiles = 0;
    hideSuggestions();
    loadAllBanned();
    loadProfiles();
    window.history.replaceState(null, '', window.location.pathname);
  });
}

document.getElementById("chart-year")?.addEventListener("change", loadChart);
document.getElementById("chart-view")?.addEventListener("change", () => {
  loadChartYears().then(loadChart);
});
if (window.I18N && window.I18N.init) {
  window.I18N.init();
}
window.addEventListener('sbt:lang-changed', function () {
  refresh();
});
refresh();
