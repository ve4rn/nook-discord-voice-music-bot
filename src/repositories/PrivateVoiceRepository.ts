import type { PrivateVoiceChannel, PrivateVoiceGuildConfig } from "@prisma/client";
import { prisma } from "../config/Prisma.js";

export type PrivateVoiceGuildConfigRecord = PrivateVoiceGuildConfig;
export type PrivateVoiceChannelRecord = PrivateVoiceChannel;
export type PrivateVoiceGuildConfigUpdate = Partial<Pick<
  PrivateVoiceGuildConfig,
  "createChannelId" | "categoryId" | "enabled" | "lang" | "maxAllowedUsers" | "panelMentionTtlMs" | "emptyChannelSweepMs"
>>;

type GuildConfigDefaults = Pick<
  PrivateVoiceGuildConfig,
  "createChannelId" | "categoryId" | "enabled" | "lang" | "maxAllowedUsers" | "panelMentionTtlMs" | "emptyChannelSweepMs"
>;

type PrivateChannelCreate = Pick<
  PrivateVoiceChannel,
  "guildId" | "channelId" | "ownerId" | "isPrivate" | "allowedIds"
>;

type PrivateChannelUpdate = Partial<Pick<PrivateVoiceChannel, "ownerId" | "isPrivate" | "allowedIds">>;

export class PrivateVoiceRepository {
  async upsertGuildConfig(guildId: string, defaults: GuildConfigDefaults) {
    return prisma.privateVoiceGuildConfig.upsert({
      where: { guildId },
      update: {},
      create: {
        guildId,
        ...defaults,
      },
    });
  }

  async findGuildConfig(guildId: string) {
    return prisma.privateVoiceGuildConfig.findUnique({ where: { guildId } });
  }

  async createGuildConfig(guildId: string, defaults: GuildConfigDefaults) {
    return prisma.privateVoiceGuildConfig.create({
      data: {
        guildId,
        ...defaults,
      },
    });
  }

  async updateGuildConfig(guildId: string, data: PrivateVoiceGuildConfigUpdate) {
    return prisma.privateVoiceGuildConfig.update({
      where: { guildId },
      data,
    });
  }

  async listGuildConfigs() {
    return prisma.privateVoiceGuildConfig.findMany();
  }

  async listPrivateChannels() {
    return prisma.privateVoiceChannel.findMany();
  }

  async findPrivateChannel(guildId: string, channelId: string) {
    return prisma.privateVoiceChannel.findFirst({ where: { guildId, channelId } });
  }

  async findPrivateChannelById(channelId: string) {
    return prisma.privateVoiceChannel.findUnique({ where: { channelId } });
  }

  async createPrivateChannel(data: PrivateChannelCreate) {
    return prisma.privateVoiceChannel.create({ data });
  }

  async updatePrivateChannel(channelId: string, data: PrivateChannelUpdate) {
    return prisma.privateVoiceChannel.update({
      where: { channelId },
      data,
    });
  }

  async deletePrivateChannelByChannelId(channelId: string) {
    return prisma.privateVoiceChannel.deleteMany({ where: { channelId } });
  }

  async deletePrivateChannelsByIds(channelIds: string[]) {
    if (channelIds.length === 0) return { count: 0 };
    return prisma.privateVoiceChannel.deleteMany({ where: { channelId: { in: channelIds } } });
  }
}
