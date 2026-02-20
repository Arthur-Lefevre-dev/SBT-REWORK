/**
 * Steam Ban Tracker - frontend
 */

const API = "";
const PAGE_SIZE = 10;

let pageBanned = 0;
let pageProfiles = 0;
let totalBanned = 0;
let totalProfiles = 0;
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
  if (total === 0) {
    el.innerHTML = "";
    return;
  }
  const start = page * pageSize + 1;
  const end = Math.min((page + 1) * pageSize, total);
  const totalPages = Math.ceil(total / pageSize);
  el.innerHTML = `
    <span class="pagination-info">${start}–${end} sur ${total}</span>
    <div class="pagination-btns">
      <button type="button" data-action="prev" ${page === 0 ? "disabled" : ""}>Précédent</button>
      <button type="button" data-action="next" ${page >= totalPages - 1 ? "disabled" : ""}>Suivant</button>
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
      '<tr><td colspan="7" class="empty-msg">Aucun bannissement détecté</td></tr>';
  } else {
    tbody.innerHTML = rows
      .map((r) => {
        const details = [];
        if (r.vac_banned)
          details.push(
            `${r.vac_count} VAC, dernier: il y a ${r.days_since_last_ban ?? "?"} j`,
          );
        if (r.game_ban_count > 0 && !r.vac_banned)
          details.push(`${r.game_ban_count} game ban(s)`);
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
  const rows = await fetchJson("/api/vac-banned");
  const tbody = document.getElementById("vac-banned-table");
  if (rows.length === 0) {
    tbody.innerHTML =
      '<tr><td colspan="7" class="empty-msg">Aucun profil VAC banni</td></tr>';
    return;
  }
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

async function loadGameBanned() {
  const rows = await fetchJson("/api/game-banned");
  const tbody = document.getElementById("game-banned-table");
  if (rows.length === 0) {
    tbody.innerHTML =
      '<tr><td colspan="5" class="empty-msg">Aucun profil Game banni</td></tr>';
    return;
  }
  tbody.innerHTML = rows
    .map(
      (r) => `
    <tr>
      <td>${avatarCell(r.avatar, r.steamid64)}</td>
      <td>${nameCell(r.persona_name, r.steamid64)}</td>
      <td class="mono">${escapeHtml(r.steamid)}</td>
      <td>${r.game_ban_count}</td>
      <td>${linkCell(r.steamid64)}</td>
    </tr>
  `,
    )
    .join("");
}

async function loadCommunityBanned() {
  const rows = await fetchJson("/api/community-banned");
  const tbody = document.getElementById("community-banned-table");
  if (rows.length === 0) {
    tbody.innerHTML =
      '<tr><td colspan="4" class="empty-msg">Aucun profil Community banni</td></tr>';
    return;
  }
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
      ? `Nombre de bans VAC${isAggregated ? ' par semaine' : ' par jour'}${aggregationNote} (date estimée du ban — Steam donne « jours depuis dernier ban »)`
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
        "Aucune donnée temporelle (scraper au moins une fois).";
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
  ];
  if (!byBan) {
    datasets.push(
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
      {
        label: "Community",
        data: community,
        backgroundColor: "rgba(139, 148, 158, 0.95)",
        borderColor: "#8b949e",
        borderWidth: 2.5,
        borderRadius: 4,
        maxBarThickness: maxBarThickness,
        minBarLength: 3,
      },
    );
  }

  const maxTicks = Math.min(40, Math.max(8, Math.floor(dataPoints / 2)));
  const step = Math.max(1, Math.floor(dataPoints / maxTicks));

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
            maxRotation: 45,
            minRotation: 0,
            color: 'var(--text-muted)',
            font: { size: 10 },
            callback(_, i) {
              return i % step === 0 || i === labels.length - 1
                ? this.getLabelForValue(i)
                : "";
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
          mode: "index", 
          intersect: false,
          backgroundColor: 'rgba(22, 27, 34, 0.95)',
          titleColor: 'var(--text)',
          bodyColor: 'var(--text)',
          borderColor: 'var(--border)',
          borderWidth: 1,
          padding: 10,
          displayColors: true,
          callbacks: {
            label: function(context) {
              return context.dataset.label + ': ' + context.parsed.y;
            }
          }
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
      '<tr><td colspan="6" class="empty-msg">Aucun profil</td></tr>';
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
    alert(
      "Erreur de chargement. Vérifiez que le serveur tourne (npm run server) et que steam-data.db existe.",
    );
  } finally {
    btn.disabled = false;
    btn.textContent = "Actualiser";
  }
}

document.getElementById("refresh").addEventListener("click", () => {
  pageBanned = 0;
  pageProfiles = 0;
  refresh();
});

// Search functionality
const searchInput = document.getElementById('search-input');
const searchClear = document.getElementById('search-clear');

function handleSearch() {
  searchQuery = searchInput ? searchInput.value.trim() : '';
  if (searchClear) searchClear.style.display = searchQuery ? 'block' : 'none';
  pageBanned = 0;
  pageProfiles = 0;
  loadAllBanned();
  loadProfiles();
  // Keep URL in sync so refresh and sharing work
  const url = new URL(window.location.href);
  if (searchQuery) url.searchParams.set('search', searchQuery);
  else url.searchParams.delete('search');
  const newUrl = url.pathname + (url.searchParams.toString() ? '?' + url.searchParams.toString() : '');
  if (window.location.pathname + window.location.search !== newUrl) {
    window.history.replaceState(null, '', newUrl);
  }
}

if (searchInput) {
  // Init from URL on load (e.g. ?search=foo)
  const urlParams = new URLSearchParams(window.location.search);
  const q = urlParams.get('search');
  if (q != null && q !== '') {
    searchInput.value = q;
    searchQuery = q;
    if (searchClear) searchClear.style.display = 'block';
  }
  let searchTimeout;
  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(handleSearch, 300);
  });
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      clearTimeout(searchTimeout);
      handleSearch();
    }
  });
}

if (searchClear) {
  searchClear.addEventListener('click', () => {
    if (searchInput) searchInput.value = '';
    searchQuery = '';
    searchClear.style.display = 'none';
    pageBanned = 0;
    pageProfiles = 0;
    loadAllBanned();
    loadProfiles();
    window.history.replaceState(null, '', window.location.pathname);
  });
}

document.getElementById("chart-year")?.addEventListener("change", loadChart);
document.getElementById("chart-view")?.addEventListener("change", () => {
  loadChartYears().then(loadChart);
});
refresh();
