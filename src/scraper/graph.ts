import type { ScrapedProfile } from "../shared/types.js";

export class FriendshipGraph {
  adjacency = new Map<string, Set<string>>();
  profiles = new Map<string, ScrapedProfile>();

  addProfile(steamId64: string, profileData: ScrapedProfile) {
    this.profiles.set(String(steamId64), profileData);
  }

  addFriendship(a: string, b: string) {
    const sa = String(a);
    const sb = String(b);
    if (!this.adjacency.has(sa)) this.adjacency.set(sa, new Set());
    if (!this.adjacency.has(sb)) this.adjacency.set(sb, new Set());
    this.adjacency.get(sa)!.add(sb);
    this.adjacency.get(sb)!.add(sa);
  }

  setFriends(steamId64: string, friendIds: string[]) {
    const id = String(steamId64);
    if (!this.adjacency.has(id)) this.adjacency.set(id, new Set());
    const set = this.adjacency.get(id)!;
    set.clear();
    for (const fid of friendIds) set.add(String(fid));
  }

  toJSON() {
    const profiles: Record<string, ScrapedProfile> = {};
    for (const [k, v] of this.profiles) profiles[k] = v;
    const adjacency: Record<string, string[]> = {};
    for (const [k, v] of this.adjacency) adjacency[k] = [...v];
    return { profiles, adjacency };
  }
}
