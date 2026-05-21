import {
  ButtonInteraction,
  ChatInputCommandInteraction,
  MessageFlags,
  StringSelectMenuInteraction,
  type ChannelSelectMenuInteraction,
} from "discord.js";
import { privateVoiceManager } from "./PrivateVoiceManager.js";
import {
  checkCanSendComponents,
  checkCanSendText,
  formatDiscordPermissionInline,
  type PermissionKey,
  type PermissionLanguage,
} from "./PermissionChecks.js";
import { parseLanguage as parseI18nLanguage, t } from "./i18n.js";
import { buildPermissionIssuePayload } from "../services/audio/permissionPanels.js";

type CommandInteractionWithReply =
  | ButtonInteraction
  | ChatInputCommandInteraction
  | StringSelectMenuInteraction
  | ChannelSelectMenuInteraction;

function parsePermissionLanguage(raw: string | null | undefined): PermissionLanguage {
  const parsed = parseI18nLanguage(raw);
  if (parsed === "fr" || parsed === "en" || parsed === "es" || parsed === "de") return parsed;
  return "en";
}

async function getLanguage(guildId: string | null | undefined): Promise<PermissionLanguage> {
  if (!guildId) return "en";
  const cached = privateVoiceManager.guildConfigCache.get(guildId);
  const config = cached ?? await privateVoiceManager.getOrCreateGuildConfig(guildId).catch(() => null);
  return parsePermissionLanguage(config?.lang);
}

async function replyMissingPermissions(
  interaction: CommandInteractionWithReply,
  language: PermissionLanguage,
  missing: PermissionKey[],
  voice = false,
) {
  const payload = await buildPermissionIssuePayload(interaction.guildId, missing, voice);
  const content = t(
    language,
    voice ? "common.missingVoicePermissionsDescription" : "common.missingPermissionsDescription",
    { permissions: formatDiscordPermissionInline(missing) },
  );

  if (interaction.deferred || interaction.replied) {
    await interaction.followUp({
      ...payload,
      flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
    }).catch(async () => {
      await interaction.followUp({ content, flags: MessageFlags.Ephemeral }).catch(() => undefined);
    });
    return;
  }

  await interaction.reply({
    ...payload,
    flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
  }).catch(async () => {
    await interaction.reply({ content, flags: MessageFlags.Ephemeral }).catch(() => undefined);
  });
}

export async function requireComponentReplyPermissions(interaction: CommandInteractionWithReply) {
  if (!interaction.guildId || !interaction.channel) return true;

  const check = checkCanSendComponents(interaction.channel as Parameters<typeof checkCanSendComponents>[0]);
  if (check.ok) return true;

  const language = await getLanguage(interaction.guildId);
  await replyMissingPermissions(interaction, language, check.missing);
  return false;
}

export async function requireTextReplyPermissions(interaction: CommandInteractionWithReply) {
  if (!interaction.guildId || !interaction.channel) return true;

  const check = checkCanSendText(interaction.channel as Parameters<typeof checkCanSendText>[0]);
  if (check.ok) return true;

  const language = await getLanguage(interaction.guildId);
  await replyMissingPermissions(interaction, language, check.missing);
  return false;
}
