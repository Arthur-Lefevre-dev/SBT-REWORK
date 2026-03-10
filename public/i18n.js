// Simple front-end i18n helper for FR/EN.
// Exposes window.I18N with: init(), setLang(lang), getLang(), t(key), applyTranslations().

(function () {
  const STORAGE_KEY = 'sbt_lang';

  /** @type {Record<string, Record<string, string>>} */
  const MESSAGES = {
    fr: {
      'lang.label': 'Langue',
      'lang.fr': 'Français',
      'lang.en': 'English',

      'home.subtitle': 'Suivi des bannissements VAC, Game et Community sur Steam',
      'home.search.placeholder': 'Rechercher (pseudo, SteamID, SteamID64, URL profil Steam)...',
      'home.search.button': 'Chercher',
      'home.refresh': 'Actualiser',
      'home.chart.title': 'Bans dans le temps',
      'home.chart.view.label': 'Vue :',
      'home.chart.view.ban': 'Bans par date',
      'home.chart.view.scrape': 'Par date de scraping',
      'home.chart.year.label': 'Année :',
      'home.chart.year.all': 'Toutes',
      'home.chart.desc.ban': 'Nombre de bans VAC par jour (date estimée du ban)',
      'home.chart.desc.scrape': 'Nombre de bans VAC par jour (date de scraping)',
      'home.chart.resetZoom': 'Réinitialiser zoom',
      'home.chart.hint': '💡 Molette pour zoomer, clic-glisser pour déplacer',
      'home.chart.empty': 'Aucune donnée temporelle (scraper au moins une fois)',
      'home.stats.totalProfiles': 'Profils analysés',
      'home.stats.vac': 'VAC ban',
      'home.stats.game': 'Game ban',
      'home.stats.community': 'Community ban',
      'home.table.allBanned': 'Tous les bannis',
      'home.table.vac': 'VAC ban',
      'home.table.game': 'Game ban',
      'home.table.community': 'Community ban',
      'home.table.recentProfiles': 'Profils récents',
      'home.table.col.avatar': 'Avatar',
      'home.table.col.name': 'Pseudo',
      'home.table.col.steamid64': 'SteamID64',
      'home.table.col.steamid': 'SteamID',
      'home.table.col.type': 'Type',
      'home.table.col.details': 'Détails',
      'home.table.col.links': 'Liens',
      'home.table.col.vacCount': 'Bans VAC',
      'home.table.col.daysSinceBan': 'Jours depuis dernier ban',
      'home.table.col.estimatedDate': 'Date estimée',
      'home.table.col.gameCount': 'Nb bans',
      'home.table.col.ban': 'Ban',
      'home.table.col.scrapedAt': 'Analysé',
      'home.table.empty.banned': 'Aucun bannissement détecté',
      'home.table.empty.vac': 'Aucun VAC ban détecté',
      'home.table.empty.game': 'Aucun Game ban détecté',
      'home.table.empty.community': 'Aucun Community ban détecté',
      'home.table.empty.profiles': 'Aucun profil dans la base pour le moment',
      'home.pagination.info': '{start}–{end} sur {total}',
      'home.pagination.prev': 'Précédent',
      'home.pagination.next': 'Suivant',
      'home.refresh.error': 'Erreur de chargement. Vérifiez que le serveur tourne (npm run server) et que steam-data.db existe.',
      'home.footer': 'made by Drago',

      'admin.subtitle': 'Panel admin',
      'admin.ws.label': 'Temps réel',
      'admin.logout': 'Déconnexion',
      'admin.settings.title': 'Paramètres (sauvegardés en base)',
      'admin.settings.steamApiKey': 'Clé API Steam',
      'admin.settings.steamApiKey.placeholder.empty': 'Clé API Steam',
      'admin.settings.steamApiKey.placeholder.masked': '••••••••',
      'admin.settings.startProfile': 'Profil de départ (SteamID64)',
      'admin.settings.maxDepth': 'Profondeur max (0 = illimité)',
      'admin.settings.maxProfiles': 'Profils max (0 = illimité)',
      'admin.settings.save': 'Enregistrer les paramètres',
      'admin.bot.title': 'Contrôle du bot',
      'admin.bot.start': 'Démarrer',
      'admin.bot.pause': 'Pause',
      'admin.bot.resume': 'Reprendre',
      'admin.bot.stop': 'Arrêter',
      'admin.bot.status': 'Statut',
      'admin.bot.status.profiles': 'Profils scrapés',
      'admin.bot.status.depth': 'Profondeur actuelle',
      'admin.bot.status.batches': 'Batches',
      'admin.bot.status.start': 'Début',
      'admin.bot.status.end': 'Fin',
      'admin.bot.status.ratelimit': 'Pauses rate limit',
      'admin.bot.chart.title': 'Activité du bot (graphique)',
      'admin.bot.chart.empty': 'Aucune donnée pour le moment. Démarrez le bot pour voir le graphique.',
      'admin.bot.console.title': 'Console du bot',
      'admin.bot.console.placeholder': 'Aucune activité pour le moment. Démarrez le bot pour voir les logs.',
      'admin.dbStats.title': 'Stats globales (base de données)',
      'admin.dbStats.loading': 'Chargement…',
      'admin.settings.loadError': 'Impossible de charger les paramètres',
      'admin.settings.saved': 'Paramètres enregistrés.',

      'admin.login.subtitle': 'Panel admin — connectez-vous avec Steam',
      'admin.login.button': 'Se connecter avec Steam',
      'admin.login.error.auth': 'Échec de l’authentification Steam. Réessayez.',
      'admin.login.error.captcha': 'Veuillez valider le captcha.',
      'admin.login.error.generic': 'Erreur',
      'admin.login.error.network': 'Erreur réseau',

      'admin.denied.subtitle': 'Panel admin',
      'admin.denied.title': 'Accès refusé',
      'admin.denied.message':
        'Votre compte Steam n’est pas autorisé à accéder au panel admin. Seuls les comptes figurant dans la liste des administrateurs peuvent s’y connecter.',
      'admin.denied.back': 'Retour à l’accueil',

      'profile.subtitle': 'Profil',
      'profile.loading': 'Chargement du profil…',
      'profile.error.invalidUrl': 'URL de profil invalide.',
      'profile.error.notFound': 'Profil non trouvé',
      'profile.panel.title': 'Profil',
      'profile.stats.friends': 'Amis (connus)',
      'profile.stats.friendsBanned': 'Amis bannis',
      'profile.stats.vac': 'VAC',
      'profile.stats.game': 'Game bans',
      'profile.stats.community': 'Community bans',
      'profile.stats.leetifyWinrate': 'Winrate Leetify',
      'profile.stats.leetifyMatches': 'Matchs Leetify',
      'profile.stats.premier': 'Premier',
      'profile.stats.wingman': 'Wingman',
      'profile.stats.eloFaceit': 'ELO Faceit',
      'profile.lastUpdate': 'Dernière mise à jour : {date}',
      'profile.leetify.matchesTitle': '10 derniers matchs',
      'profile.leetify.platform': 'Plateforme',
      'profile.leetify.map': 'Map',
      'profile.leetify.result': 'Résultat',
      'profile.leetify.score': 'Score',
      'profile.leetify.date': 'Date',
      'profile.leetify.dataBy': 'Data provided by',
      'profile.friendsBanned.title': 'Amis bannis',
      'profile.friendsBanned.sortBy': 'Trier par',
      'profile.friendsBanned.sortDateDesc': 'Date (récent)',
      'profile.friendsBanned.sortDateAsc': 'Date (ancien)',
      'profile.friendsBanned.sortType': 'Type de ban',
      'profile.friendsBanned.sortNameAsc': 'Nom (A–Z)',
      'profile.friendsBanned.sortNameDesc': 'Nom (Z–A)',
      'profile.friendsBanned.range': 'Affichage {start}–{end} sur {total}',
      'profile.friendsBanned.prev': 'Précédent',
      'profile.friendsBanned.next': 'Suivant',
      'profile.gameBanDaysAgo': '(il y a {n} j)',
      'profile.link.steam': 'Profil Steam',
      'profile.link.faceit': 'Faceit',
      'profile.link.leetify': 'Leetify',
      'profile.footer': 'made by Drago',
    },
    en: {
      'lang.label': 'Language',
      'lang.fr': 'Français',
      'lang.en': 'English',

      'home.subtitle': 'Track VAC, Game and Community bans on Steam',
      'home.search.placeholder': 'Search (nickname, SteamID, SteamID64, Steam profile URL)...',
      'home.search.button': 'Search',
      'home.refresh': 'Refresh',
      'home.chart.title': 'Bans over time',
      'home.chart.view.label': 'View:',
      'home.chart.view.ban': 'Bans by ban date',
      'home.chart.view.scrape': 'By scrape date',
      'home.chart.year.label': 'Year:',
      'home.chart.year.all': 'All',
      'home.chart.desc.ban': 'Number of VAC bans per day (estimated ban date)',
      'home.chart.desc.scrape': 'Number of VAC bans per day (scrape date)',
      'home.chart.resetZoom': 'Reset zoom',
      'home.chart.hint': '💡 Scroll to zoom, click-drag to pan',
      'home.chart.empty': 'No time-series data yet (run the scraper at least once)',
      'home.stats.totalProfiles': 'Profiles analysed',
      'home.stats.vac': 'VAC bans',
      'home.stats.game': 'Game bans',
      'home.stats.community': 'Community bans',
      'home.table.allBanned': 'All banned',
      'home.table.vac': 'VAC bans',
      'home.table.game': 'Game bans',
      'home.table.community': 'Community bans',
      'home.table.recentProfiles': 'Recent profiles',
      'home.table.col.avatar': 'Avatar',
      'home.table.col.name': 'Name',
      'home.table.col.steamid64': 'SteamID64',
      'home.table.col.steamid': 'SteamID',
      'home.table.col.type': 'Type',
      'home.table.col.details': 'Details',
      'home.table.col.links': 'Links',
      'home.table.col.vacCount': 'VAC bans',
      'home.table.col.daysSinceBan': 'Days since last ban',
      'home.table.col.estimatedDate': 'Estimated date',
      'home.table.col.gameCount': 'Game bans',
      'home.table.col.ban': 'Ban',
      'home.table.col.scrapedAt': 'Scraped at',
      'home.table.empty.banned': 'No bans found',
      'home.table.empty.vac': 'No VAC bans found',
      'home.table.empty.game': 'No Game bans found',
      'home.table.empty.community': 'No Community bans found',
      'home.table.empty.profiles': 'No profiles in the database yet',
      'home.pagination.info': '{start}–{end} of {total}',
      'home.pagination.prev': 'Previous',
      'home.pagination.next': 'Next',
      'home.refresh.error': 'Load error. Check that the server is running (npm run server) and that steam-data.db exists.',
      'home.footer': 'made by Drago',

      'admin.subtitle': 'Admin panel',
      'admin.ws.label': 'Realtime',
      'admin.logout': 'Logout',
      'admin.settings.title': 'Settings (stored in DB)',
      'admin.settings.steamApiKey': 'Steam API key',
      'admin.settings.steamApiKey.placeholder.empty': 'Steam API key',
      'admin.settings.steamApiKey.placeholder.masked': '••••••••',
      'admin.settings.startProfile': 'Starting profile (SteamID64)',
      'admin.settings.maxDepth': 'Max depth (0 = unlimited)',
      'admin.settings.maxProfiles': 'Max profiles (0 = unlimited)',
      'admin.settings.save': 'Save settings',
      'admin.bot.title': 'Bot control',
      'admin.bot.start': 'Start',
      'admin.bot.pause': 'Pause',
      'admin.bot.resume': 'Resume',
      'admin.bot.stop': 'Stop',
      'admin.bot.status': 'Status',
      'admin.bot.status.profiles': 'Profiles scraped',
      'admin.bot.status.depth': 'Current depth',
      'admin.bot.status.batches': 'Batches',
      'admin.bot.status.start': 'Start',
      'admin.bot.status.end': 'End',
      'admin.bot.status.ratelimit': 'Rate-limit pauses',
      'admin.bot.chart.title': 'Bot activity (chart)',
      'admin.bot.chart.empty': 'No data yet. Start the bot to see the chart.',
      'admin.bot.console.title': 'Bot console',
      'admin.bot.console.placeholder': 'No activity yet. Start the bot to see logs.',
      'admin.dbStats.title': 'Global stats (database)',
      'admin.dbStats.loading': 'Loading…',
      'admin.settings.loadError': 'Failed to load settings',
      'admin.settings.saved': 'Settings saved.',

      'admin.login.subtitle': 'Admin panel — sign in with Steam',
      'admin.login.button': 'Sign in with Steam',
      'admin.login.error.auth': 'Steam authentication failed. Please try again.',
      'admin.login.error.captcha': 'Please complete the captcha.',
      'admin.login.error.generic': 'Error',
      'admin.login.error.network': 'Network error',

      'admin.denied.subtitle': 'Admin panel',
      'admin.denied.title': 'Access denied',
      'admin.denied.message':
        'Your Steam account is not allowed to access the admin panel. Only accounts listed as administrators can sign in.',
      'admin.denied.back': 'Back to home',

      'profile.subtitle': 'Profile',
      'profile.loading': 'Loading profile…',
      'profile.error.invalidUrl': 'Invalid profile URL.',
      'profile.error.notFound': 'Profile not found',
      'profile.panel.title': 'Profile',
      'profile.stats.friends': 'Friends (known)',
      'profile.stats.friendsBanned': 'Banned friends',
      'profile.stats.vac': 'VAC',
      'profile.stats.game': 'Game bans',
      'profile.stats.community': 'Community bans',
      'profile.stats.leetifyWinrate': 'Leetify winrate',
      'profile.stats.leetifyMatches': 'Leetify matches',
      'profile.stats.premier': 'Premier',
      'profile.stats.wingman': 'Wingman',
      'profile.stats.eloFaceit': 'Faceit ELO',
      'profile.lastUpdate': 'Last update: {date}',
      'profile.leetify.matchesTitle': 'Last 10 matches',
      'profile.leetify.platform': 'Platform',
      'profile.leetify.map': 'Map',
      'profile.leetify.result': 'Result',
      'profile.leetify.score': 'Score',
      'profile.leetify.date': 'Date',
      'profile.leetify.dataBy': 'Data provided by',
      'profile.friendsBanned.title': 'Banned friends',
      'profile.friendsBanned.sortBy': 'Sort by',
      'profile.friendsBanned.sortDateDesc': 'Date (newest)',
      'profile.friendsBanned.sortDateAsc': 'Date (oldest)',
      'profile.friendsBanned.sortType': 'Ban type',
      'profile.friendsBanned.sortNameAsc': 'Name (A–Z)',
      'profile.friendsBanned.sortNameDesc': 'Name (Z–A)',
      'profile.friendsBanned.range': 'Showing {start}–{end} of {total}',
      'profile.friendsBanned.prev': 'Previous',
      'profile.friendsBanned.next': 'Next',
      'profile.gameBanDaysAgo': '({n} days ago)',
      'profile.link.steam': 'Steam profile',
      'profile.link.faceit': 'Faceit',
      'profile.link.leetify': 'Leetify',
      'profile.footer': 'made by Drago',
    },
  };

  function detectInitialLang() {
    const stored = window.localStorage?.getItem(STORAGE_KEY);
    if (stored && MESSAGES[stored]) return stored;
    const nav = (navigator.language || navigator.userLanguage || 'en').toLowerCase();
    if (nav.startsWith('fr')) return 'fr';
    return 'en';
  }

  let currentLang = detectInitialLang();

  function t(key) {
    const langDict = MESSAGES[currentLang] || MESSAGES.fr;
    if (langDict && key in langDict) return langDict[key];
    const fallback = MESSAGES.fr;
    if (fallback && key in fallback) return fallback[key];
    return key;
  }

  function replacePlaceholders(text, params) {
    if (!params) return text;
    return Object.keys(params).reduce(
      (acc, k) => acc.replace(new RegExp(`\\{${k}\\}`, 'g'), String(params[k])),
      text,
    );
  }

  function applyTranslations(root) {
    const doc = root || document;
    doc.querySelectorAll('[data-i18n]').forEach((el) => {
      const key = el.getAttribute('data-i18n');
      if (!key) return;
      el.textContent = t(key);
    });
    doc.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
      const key = el.getAttribute('data-i18n-placeholder');
      if (!key) return;
      el.setAttribute('placeholder', t(key));
    });
    doc.querySelectorAll('[data-i18n-title]').forEach((el) => {
      const key = el.getAttribute('data-i18n-title');
      if (!key) return;
      el.setAttribute('title', t(key));
    });
    doc.querySelectorAll('[data-i18n-aria-label]').forEach((el) => {
      const key = el.getAttribute('data-i18n-aria-label');
      if (!key) return;
      el.setAttribute('aria-label', t(key));
    });
  }

  function setLang(lang) {
    if (!MESSAGES[lang]) return;
    currentLang = lang;
    try {
      window.localStorage?.setItem(STORAGE_KEY, lang);
    } catch (_) {}
    if (document.documentElement) document.documentElement.lang = lang;
    applyTranslations(document);
    document.querySelectorAll('[data-lang-switcher]').forEach((el) => {
      if (el.value !== lang) el.value = lang;
    });
    try {
      window.dispatchEvent(new CustomEvent('sbt:lang-changed', { detail: { lang } }));
    } catch (_) {}
  }

  function getLang() {
    return currentLang;
  }

  function initSelectors() {
    document.querySelectorAll('[data-lang-switcher]').forEach((el) => {
      if (!el.value) el.value = currentLang;
      el.addEventListener('change', (e) => {
        const value = e.target.value || e.target?.options?.[e.target.selectedIndex]?.value;
        if (value && MESSAGES[value]) setLang(value);
      });
    });
  }

  function init() {
    if (document.documentElement) document.documentElement.lang = currentLang;
    applyTranslations(document);
    initSelectors();
  }

  window.I18N = {
    init,
    setLang,
    getLang,
    t,
    applyTranslations,
  };
})();

