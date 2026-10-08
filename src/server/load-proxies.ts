import { getSetting } from "../db/queries.js";
import { configureRuntimeProxies } from "../scraper/proxy.js";

/** Load admin-configured PROXY list from DB into the runtime pool. */
export async function loadProxiesFromSettings() {
  const text = await getSetting("proxy_urls");
  configureRuntimeProxies(text?.trim() ? text : null);
}
