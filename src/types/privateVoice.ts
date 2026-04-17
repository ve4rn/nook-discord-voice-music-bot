export type BotLanguage = "fr" | "en" | "es" | "de";

export type PrivateVoiceSettings = {
  guildId: string;
  createChannelId: string;
  categoryId: string;
  enabled: boolean;
  language: BotLanguage;
  maxAllowedUsers: number;
  panelMentionTtlMs: number;
  emptyChannelSweepMs: number;
};

export type PrivateVoiceChannelState = {
  id: string;
  guildId: string;
  channelId: string;
  ownerId: string;
  isPrivate: boolean;
  allowedIds: string[];
  createdAt: Date;
  updatedAt: Date;
};
