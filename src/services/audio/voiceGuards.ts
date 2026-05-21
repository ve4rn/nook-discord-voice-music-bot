import { ButtonInteraction, ChannelType, ChatInputCommandInteraction, GuildMember, MessageFlags, StringSelectMenuInteraction } from "discord.js";
import type App from "../../config/App.js";
import { getMessages, parseLanguage } from "../../config/i18n.js";
import { privateVoiceManager } from "../../config/PrivateVoiceManager.js";
import { checkCanUseVoiceForAudio, formatDiscordPermissionInline, type PermissionLanguage } from "../../config/PermissionChecks.js";
import { defaultAudioCommandCopy, getAudioCommandCopy, type AudioCommandCopy } from "./audioCommandCache.js";
import { buildNeutralNoticePanel } from "./audioPanel.js";
import { buildPermissionIssuePayload } from "./permissionPanels.js";

type MusicInteraction = ChatInputCommandInteraction | ButtonInteraction | StringSelectMenuInteraction;

function getMemberVoiceChannelId(interaction: MusicInteraction) {
  const cachedMember = interaction.guild?.members.cache.get(interaction.user.id);
  if (cachedMember) return cachedMember.voice.channelId;

  const member = interaction.member;
  if (member instanceof GuildMember) return member.voice.channelId;

  return null;
}

async function replyBlocked(interaction: MusicInteraction, content: string) {
  await interaction.reply({
    components: [await buildNeutralNoticePanel(interaction.guildId, content)],
    flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
  }).catch(() => undefined);
}

async function replyPlainText(interaction: MusicInteraction, content: string) {
  await interaction.reply({
    content,
    flags: MessageFlags.Ephemeral,
  }).catch(() => undefined);
}

async function replyVoicePermissionIssue(interaction: MusicInteraction, missing: Parameters<typeof formatDiscordPermissionInline>[0], fallbackContent: string) {
  const payload = await buildPermissionIssuePayload(interaction.guildId, missing, true);
  await interaction.reply({
    ...payload,
    flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
  }).catch(async () => {
    await replyPlainText(interaction, fallbackContent);
  });
}

function parsePermissionLanguage(language: string | null | undefined): PermissionLanguage {
  const parsed = parseLanguage(language);
  if (parsed === "fr" || parsed === "es" || parsed === "de" || parsed === "en") return parsed;
  return "en";
}

async function ensureBotCanUseVoice(interaction: MusicInteraction, voiceChannelId: string) {
  if (!interaction.guildId || !interaction.guild) return true;

  const channel = interaction.guild.channels.cache.get(voiceChannelId)
    ?? await interaction.guild.channels.fetch(voiceChannelId).catch(() => null);
  if (!channel || (channel.type !== ChannelType.GuildVoice && channel.type !== ChannelType.GuildStageVoice)) return true;

  const check = checkCanUseVoiceForAudio(channel);
  if (check.ok) return true;

  const config = await privateVoiceManager.getOrCreateGuildConfig(interaction.guildId).catch(() => null);
  const language = parsePermissionLanguage(config?.lang);
  const permissions = formatDiscordPermissionInline(check.missing);
  const fallbackContent = getMessages(language).common.missingAudioVoicePermissions.replace("{permissions}", permissions);
  await replyVoicePermissionIssue(interaction, check.missing, fallbackContent);
  return false;
}

async function getCopy(interaction: MusicInteraction): Promise<AudioCommandCopy> {
  if (!interaction.guildId) return defaultAudioCommandCopy;
  return await getAudioCommandCopy(interaction.guildId).catch(() => defaultAudioCommandCopy);
}

export async function requireJoinVoice(interaction: MusicInteraction, app: App) {
  const copy = await getCopy(interaction);
  const userVoiceChannelId = getMemberVoiceChannelId(interaction);
  if (!userVoiceChannelId) {
    await replyBlocked(interaction, copy.voice.joinVoice);
    return null;
  }

  const botVoiceChannelId = interaction.guildId ? app.audio?.getPlayerVoiceChannelId(interaction.guildId) : null;
  if (botVoiceChannelId) {
    await replyBlocked(interaction, copy.voice.botAlreadyConnected);
    return null;
  }

  if (!await ensureBotCanUseVoice(interaction, userVoiceChannelId)) return null;
  return userVoiceChannelId;
}

export async function requirePlayableVoice(interaction: MusicInteraction, app: App) {
  const copy = await getCopy(interaction);
  const userVoiceChannelId = getMemberVoiceChannelId(interaction);
  if (!userVoiceChannelId) {
    await replyBlocked(interaction, copy.voice.joinVoiceForMusic);
    return null;
  }

  const botVoiceChannelId = interaction.guildId ? app.audio?.getPlayerVoiceChannelId(interaction.guildId) : null;
  if (botVoiceChannelId && botVoiceChannelId !== userVoiceChannelId) {
    await replyBlocked(interaction, copy.voice.mustBeInBotVoiceForMusic);
    return null;
  }

  if (!botVoiceChannelId && !await ensureBotCanUseVoice(interaction, userVoiceChannelId)) return null;
  return userVoiceChannelId;
}

export async function requireControlVoice(interaction: MusicInteraction, app: App) {
  const copy = await getCopy(interaction);
  const userVoiceChannelId = getMemberVoiceChannelId(interaction);
  if (!userVoiceChannelId) {
    await replyBlocked(interaction, copy.voice.joinBotVoiceForControl);
    return null;
  }

  const botVoiceChannelId = interaction.guildId ? app.audio?.getPlayerVoiceChannelId(interaction.guildId) : null;
  if (!botVoiceChannelId) {
    await replyBlocked(interaction, copy.voice.noActivePlayer);
    return null;
  }

  if (botVoiceChannelId !== userVoiceChannelId) {
    await replyBlocked(interaction, copy.voice.mustBeInBotVoiceForControl);
    return null;
  }

  return userVoiceChannelId;
}

export function getInteractionMemberVoiceChannelId(interaction: MusicInteraction) {
  return getMemberVoiceChannelId(interaction);
}
