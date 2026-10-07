/** Normalize CS map name to public logo path under /img/map_logo/. */
export function mapLogo(mapName?: string | null): string | null {
  if (!mapName) return null;
  let key = mapName.toLowerCase().replace(/\s+/g, "_");
  if (!key.startsWith("de_") && !key.startsWith("cs_")) {
    key = `de_${key.replace(/^de_/, "")}`;
  }
  return `/img/map_logo/${key}.svg`;
}

export function faceitLevelIcon(level?: number): string | null {
  if (!level || level < 1 || level > 10) return null;
  return `/img/faceit/${level}.png`;
}
