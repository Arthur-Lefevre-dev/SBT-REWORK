/**
 * Statistics module for Steam friendship graph
 */

/**
 * Compute statistics from a FriendshipGraph
 * @param {FriendshipGraph} graph
 * @returns {Object}
 */
export function computeStats(graph) {
  const profiles = graph.getAllProfiles();
  const nodes = Object.keys(profiles);
  const edgeCount = graph.getEdgeCount();

  const vacBanned = [];
  const gameBanned = [];
  const communityBanned = [];

  for (const [id, p] of Object.entries(profiles)) {
    if (p.ban?.vacBanned) vacBanned.push({ id, ...p });
    if (p.ban?.numberOfGameBans > 0) gameBanned.push({ id, ...p });
    if (p.ban?.communityBanned) communityBanned.push({ id, ...p });
  }

  // Friend count per user (sorted by most friends)
  const friendCounts = nodes.map((id) => ({
    steamId64: id,
    steamId: profiles[id]?.steamId,
    personaName: profiles[id]?.personaName,
    friendCount: graph.getFriends(id).length
  })).sort((a, b) => b.friendCount - a.friendCount);

  return {
    summary: {
      totalProfiles: nodes.length,
      totalFriendships: edgeCount,
      vacBannedCount: vacBanned.length,
      gameBannedCount: gameBanned.length,
      communityBannedCount: communityBanned.length
    },
    vacBanned,
    gameBanned,
    communityBanned,
    topFriends: friendCounts.slice(0, 20),
    banDetails: vacBanned.map((p) => ({
      steamId64: p.steamId64,
      steamId: p.steamId,
      personaName: p.personaName,
      daysSinceLastBan: p.ban?.daysSinceLastBan,
      lastBanDate: p.ban?.lastBanDate,
      numberOfVACBans: p.ban?.numberOfVACBans
    }))
  };
}

/**
 * Get friendship relationships (who is friend with whom)
 * @param {FriendshipGraph} graph
 * @returns {Array<{a: string, b: string}>}
 */
export function getFriendshipPairs(graph) {
  const pairs = [];
  const seen = new Set();

  for (const [id, friends] of Object.entries(graph.toJSON().adjacency)) {
    for (const fid of friends) {
      const key = [id, fid].sort().join('|');
      if (!seen.has(key)) {
        seen.add(key);
        pairs.push({ a: id, b: fid });
      }
    }
  }
  return pairs;
}

/**
 * Pretty print stats to console (ban-focused)
 */
export function printStats(stats) {
  console.log('\n=== BANNISSEMENTS DÉTECTÉS ===\n');
  console.log('Profils analysés:', stats.summary.totalProfiles);
  console.log('VAC bannis:', stats.summary.vacBannedCount);
  console.log('Game bannis:', stats.summary.gameBannedCount);
  console.log('Community bannis:', stats.summary.communityBannedCount);

  if (stats.banDetails.length > 0) {
    console.log('\n--- VAC bannis ---');
    stats.banDetails.forEach((b) => {
      const dateInfo = b.lastBanDate ? ` (~${b.lastBanDate.slice(0, 10)})` : '';
      console.log(`  ${b.personaName} | SteamID: ${b.steamId} | Dernier ban: il y a ${b.daysSinceLastBan ?? '?'} jours${dateInfo} | ${b.numberOfVACBans} ban(s) VAC`);
    });
  }
}
