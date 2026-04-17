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
  formatPermissionList,
  type PermissionLanguage,
} from "./PermissionChecks.js";

type CommandInteractionWithReply =
  | ButtonInteraction
  | ChatInputCommandInteraction
  | StringSelectMenuInteraction
  | ChannelSelectMenuInteraction;

function parseLanguage(raw: string | null | undefined): PermissionLanguage {
  if (raw === "fr" || raw === "en" || raw === "es" || raw === "de") return raw;
  return "fr";
}

async function getLanguage(guildId: string | null | undefined): Promise<PermissionLanguage> {
  if (!guildId) return "fr";
  const cached = privateVoiceManager.guildConfigCache.get(guildId);
  const config = cached ?? await privateVoiceManager.getOrCreateGuildConfig(guildId).catch(() => null);
  return parseLanguage(config?.lang);
}

function message(language: PermissionLanguage, permissions: string) {
  if (language === "en") {
    return `I cannot display this panel because I am missing permissions in this channel:\n${permissions}`;
  }
  if (language === "es") {
    return `No puedo mostrar este panel porque me faltan permisos en este canal:\n${permissions}`;
  }
  if (language === "de") {
    return `Ich kann dieses Panel nicht anzeigen, weil mir in diesem Kanal Berechtigungen fehlen:\n${permissions}`;
  }
  return `Je ne peux pas afficher ce panneau car il me manque des permissions dans ce salon:\n${permissions}`;
}

function textMessage(language: PermissionLanguage, permissions: string) {
  if (language === "en") {
    return `I cannot answer properly in this channel because I am missing permissions:\n${permissions}`;
  }
  if (language === "es") {
    return `No puedo responder correctamente en este canal porque me faltan permisos:\n${permissions}`;
  }
  if (language === "de") {
    return `Ich kann in diesem Kanal nicht richtig antworten, weil mir Berechtigungen fehlen:\n${permissions}`;
  }
  return `Je ne peux pas répondre correctement dans ce salon car il me manque des permissions:\n${permissions}`;
}

async function replyMissingPermissions(interaction: CommandInteractionWithReply, content: string) {
  if (interaction.deferred || interaction.replied) {
    await interaction.followUp({ content, flags: MessageFlags.Ephemeral }).catch(() => undefined);
    return;
  }

  await interaction.reply({ content, flags: MessageFlags.Ephemeral }).catch(() => undefined);
}

export async function requireComponentReplyPermissions(interaction: CommandInteractionWithReply) {
  if (!interaction.guildId || !interaction.channel) return true;

  const check = checkCanSendComponents(interaction.channel as Parameters<typeof checkCanSendComponents>[0]);
  if (check.ok) return true;

  const language = await getLanguage(interaction.guildId);
  await replyMissingPermissions(interaction, message(language, formatPermissionList(language, check.missing)));
  return false;
}

export async function requireTextReplyPermissions(interaction: CommandInteractionWithReply) {
  if (!interaction.guildId || !interaction.channel) return true;

  const check = checkCanSendText(interaction.channel as Parameters<typeof checkCanSendText>[0]);
  if (check.ok) return true;

  const language = await getLanguage(interaction.guildId);
  await replyMissingPermissions(interaction, textMessage(language, formatPermissionList(language, check.missing)));
  return false;
}
