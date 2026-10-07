import { Link } from "react-router-dom";
import { useI18n } from "../i18n";

export default function AdminDenied() {
  const { t } = useI18n();
  return (
    <div className="card" style={{ maxWidth: 420, margin: "2rem auto" }}>
      <h2>{t("admin.denied")}</h2>
      <p className="muted">{t("admin.denied.hint")}</p>
      <Link className="btn" to="/">
        {t("nav.home")}
      </Link>
    </div>
  );
}
