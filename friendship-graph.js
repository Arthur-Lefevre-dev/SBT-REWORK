/**
 * Friendship graph - tracks who is friends with whom
 * Uses adjacency list: steamId64 -> Set of friend steamId64
 */

export class FriendshipGraph {
  constructor() {
    // steamId64 -> Set of friend steamId64
    this.adjacency = new Map();
    // steamId64 -> profile data
    this.profiles = new Map();
  }

  addProfile(steamId64, profileData) {
    this.profiles.set(String(steamId64), profileData);
  }

  addFriendship(steamId64A, steamId64B) {
    const a = String(steamId64A);
    const b = String(steamId64B);
    if (!this.adjacency.has(a)) this.adjacency.set(a, new Set());
    if (!this.adjacency.has(b)) this.adjacency.set(b, new Set());
    this.adjacency.get(a).add(b);
    this.adjacency.get(b).add(a);
  }

  setFriends(steamId64, friendIds) {
    const id = String(steamId64);
    if (!this.adjacency.has(id)) this.adjacency.set(id, new Set());
    const set = this.adjacency.get(id);
    set.clear();
    for (const fid of friendIds) set.add(String(fid));
  }

  getFriends(steamId64) {
    return Array.from(this.adjacency.get(String(steamId64)) ?? []);
  }

  getProfile(steamId64) {
    return this.profiles.get(String(steamId64));
  }

  getAllProfiles() {
    return Object.fromEntries(this.profiles);
  }

  getAllNodes() {
    return Array.from(new Set([
      ...this.adjacency.keys(),
      ...this.profiles.keys()
    ]));
  }

  getEdgeCount() {
    let count = 0;
    for (const friends of this.adjacency.values()) count += friends.size;
    return count / 2; // Each edge counted twice
  }

  toJSON() {
    return {
      profiles: this.getAllProfiles(),
      adjacency: Object.fromEntries(
        [...this.adjacency.entries()].map(([k, v]) => [k, Array.from(v)])
      )
    };
  }

  static fromJSON(obj) {
    const g = new FriendshipGraph();
    for (const [id, p] of Object.entries(obj.profiles ?? {})) g.profiles.set(id, p);
    for (const [id, friends] of Object.entries(obj.adjacency ?? {})) {
      g.adjacency.set(id, new Set(friends));
    }
    return g;
  }
}
