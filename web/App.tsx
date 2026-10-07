import { Link, Navigate, Route, Routes } from "react-router-dom";
import { I18nProvider, useI18n } from "./i18n";
import AdminPage from "./pages/Admin";
import AdminDenied from "./pages/AdminDenied";
import AdminLogin from "./pages/AdminLogin";
import HomePage from "./pages/Home";
import ProfilePage from "./pages/Profile";
import VacCloudPage from "./pages/VacCloud";

function Shell() {
  const { lang, setLang, t } = useI18n();
  return (
    <>
      <header className="site-header">
        <div className="header-inner">
          <div>
            <Link to="/" className="brand">
              Steam Ban Tracker
            </Link>
            <p className="subtitle">{t("home.subtitle")}</p>
          </div>
          <div className="header-actions">
            <label className="lang">
              <span>{t("lang.label")}</span>
              <select
                value={lang}
                onChange={(e) => setLang(e.target.value as "fr" | "en")}
              >
                <option value="fr">Français</option>
                <option value="en">English</option>
              </select>
            </label>
            <nav className="header-nav">
              <Link to="/cloud" className="btn">
                {t("nav.cloud")}
              </Link>
              <Link to="/admin" className="btn ghost">
                {t("nav.admin")}
              </Link>
            </nav>
          </div>
        </div>
      </header>
      <main className="container container-wide">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/cloud" element={<VacCloudPage />} />
          <Route path="/profile/:steamid64" element={<ProfilePage />} />
          <Route path="/admin" element={<AdminPage />} />
          <Route path="/admin/login-ui" element={<AdminLogin />} />
          <Route path="/admin/denied" element={<AdminDenied />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </>
  );
}

export default function App() {
  return (
    <I18nProvider>
      <Shell />
    </I18nProvider>
  );
}
