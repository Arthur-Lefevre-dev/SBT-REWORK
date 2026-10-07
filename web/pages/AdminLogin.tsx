import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { fetchJson } from "../http";
import { useI18n } from "../i18n";

export default function AdminLogin() {
  const { t } = useI18n();
  const [siteKey, setSiteKey] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchJson<{ turnstileSiteKey: string }>("/api/admin/login-config").then(
      (c) => setSiteKey(c.turnstileSiteKey),
    );
  }, []);

  async function login() {
    try {
      setError(null);
      if (siteKey) {
        const { redirectUrl } = await fetchJson<{ redirectUrl: string }>(
          "/admin/login",
          { method: "POST", body: JSON.stringify({}) },
        );
        window.location.href = redirectUrl;
      } else {
        window.location.href = "/admin/login";
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="card" style={{ maxWidth: 420, margin: "2rem auto" }}>
      <h2>{t("admin.login")}</h2>
      <p className="muted">{t("admin.login.hint")}</p>
      {error && <p className="error">{error}</p>}
      <div className="row">
        <button className="btn" onClick={login}>
          {t("admin.login")}
        </button>
        <Link className="btn ghost" to="/">
          {t("nav.home")}
        </Link>
      </div>
    </div>
  );
}
