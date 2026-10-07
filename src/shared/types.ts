export type BanFilters = {
  search?: string | null;
  minVacCount?: number | null;
  maxVacCount?: number | null;
  dateFrom?: string | null;
  dateTo?: string | null;
};

export type ProfileBan = {
  communityBanned: boolean;
  vacBanned: boolean;
  numberOfVACBans: number;
  daysSinceLastBan: number | null;
  lastBanDate: string | null;
  numberOfGameBans: number;
  economyBan: string;
  gameBanDaysSinceLast?: number | null;
  gameLastBanDate?: string | null;
};

export type ScrapedProfile = {
  steamId64: string;
  steamId: string;
  personaName: string;
  profileUrl: string | null;
  friendsPageUrl: string | null;
  avatar: string | null;
  createdAt: string | null;
  ban: ProfileBan | null;
};

export type BotStatus = "idle" | "running" | "paused" | "stopping";

export type BotState = {
  status: BotStatus;
  startTime: string | null;
  endTime: string | null;
  error: string | null;
  stats: {
    profilesCount: number;
    currentDepth: number;
    batchCount: number;
    lastSaveCount: number;
    pendingSaves: number;
    rateLimitPauses: number;
    errors: string[];
  };
  log: { t: string; msg: string }[];
};

export type StatsSummary = {
  totalProfiles: number;
  totalFriendships: number;
  vacBannedCount: number;
  gameBannedCount: number;
  communityBannedCount: number;
};
