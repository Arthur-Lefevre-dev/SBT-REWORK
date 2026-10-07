import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

const dict = {
  fr: {
    "home.subtitle": "Suivi des bannissements VAC, Game et Community",
    "home.search": "Rechercher un profil…",
    "home.stats.profiles": "Profils",
    "home.stats.vac": "VAC",
    "home.stats.game": "Game ban",
    "home.stats.community": "Community",
    "home.tab.banned": "Bannis",
    "home.tab.vac": "VAC",
    "home.tab.game": "Game",
    "home.tab.community": "Community",
    "home.tab.profiles": "Tous",
    "home.tab.chart": "Tendances",
    "home.loading": "Chargement…",
    "home.empty": "Aucune donnée",
    "home.chart.byScrape": "Par date de scrape",
    "home.chart.byBan": "Par date de ban",
    "home.chart.allYears": "Toutes les années",
    "nav.admin": "Admin",
    "lang.label": "Langue",
    "profile.back": "Retour",
    "profile.loading": "Chargement du profil…",
    "profile.bans": "Bans",
    "profile.noVac": "Pas de VAC",
    "profile.friendsBanned": "Amis bannis",
    "profile.noneInDb": "Aucun en base",
    "admin.title": "Panneau admin",
    "admin.login": "Connexion Steam",
    "admin.denied": "Accès refusé",
    "admin.denied.hint": "Ce compte Steam n’est pas autorisé.",
    "admin.settings": "Réglages",
    "admin.bot": "Bot scraper",
    "admin.vac": "Vérif. VAC",
    "admin.saved": "Enregistré",
    "admin.saveError": "Échec de l’enregistrement",
    "admin.loading": "Chargement…",
  },
  en: {
    "home.subtitle": "Track VAC, Game and Community bans",
    "home.search": "Search a profile…",
    "home.stats.profiles": "Profiles",
    "home.stats.vac": "VAC",
    "home.stats.game": "Game ban",
    "home.stats.community": "Community",
    "home.tab.banned": "Banned",
    "home.tab.vac": "VAC",
    "home.tab.game": "Game",
    "home.tab.community": "Community",
    "home.tab.profiles": "All",
    "home.tab.chart": "Trends",
    "home.loading": "Loading…",
    "home.empty": "No data",
    "home.chart.byScrape": "By scrape date",
    "home.chart.byBan": "By ban date",
    "home.chart.allYears": "All years",
    "nav.admin": "Admin",
    "lang.label": "Language",
    "profile.back": "Back",
    "profile.loading": "Loading profile…",
    "profile.bans": "Bans",
    "profile.noVac": "No VAC",
    "profile.friendsBanned": "Banned friends",
    "profile.noneInDb": "None in DB",
    "admin.title": "Admin panel",
    "admin.login": "Steam login",
    "admin.denied": "Access denied",
    "admin.denied.hint": "This Steam account is not allowed.",
    "admin.settings": "Settings",
    "admin.bot": "Scraper bot",
    "admin.vac": "VAC verify",
    "admin.saved": "Saved",
    "admin.saveError": "Save failed",
    "admin.loading": "Loading…",
  },
} as const;

type Lang = keyof typeof dict;
type Key = keyof (typeof dict)["fr"];

const I18nCtx = createContext<{
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (k: Key) => string;
} | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState<Lang>(
    () => (localStorage.getItem("sbt.lang") as Lang) || "fr",
  );
  const t = useCallback((k: Key) => dict[lang][k] ?? k, [lang]);
  const value = useMemo(
    () => ({
      lang,
      setLang: (l: Lang) => {
        localStorage.setItem("sbt.lang", l);
        setLang(l);
      },
      t,
    }),
    [lang, t],
  );
  return <I18nCtx.Provider value={value}>{children}</I18nCtx.Provider>;
}

export function useI18n() {
  const ctx = useContext(I18nCtx);
  if (!ctx) throw new Error("I18nProvider missing");
  return ctx;
}
