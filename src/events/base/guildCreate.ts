import {
  ContainerBuilder,
  Guild,
  GuildMember,
  MessageFlags,
  PermissionFlagsBits,
  SeparatorSpacingSize,
  StringSelectMenuInteraction,
  TextChannel,
} from "discord.js";
import { NO_PING_ALLOWED_MENTIONS } from "../../config/DiscordMentions.js";
import { EventBuilder } from "../../config/EventBuilder.js";
import ConsoleMessage from "../../config/ConsoleMessage.js";
import { env } from "../../config/env.js";
import { requireComponentReplyPermissions, requireTextReplyPermissions } from "../../config/CommandPermissionGuards.js";
import { getMessages, parseLanguage, type BotLanguage } from "../../config/i18n.js";
import { privateVoiceManager } from "../../config/PrivateVoiceManager.js";
import { checkCanSendComponents, findFirstPublicWritableTextChannel } from "../../config/PermissionChecks.js";
import { buildWelcomePanel } from "../../services/audio/audioPanel.js";
import { AUDIO_CUSTOM_IDS } from "../../services/audio/audioCustomIds.js";

function detectLanguage(locale: string | null | undefined): BotLanguage {
  return parseLanguage(locale);
}

async function saveGuildLanguage(guildId: string, language: BotLanguage) {
  await privateVoiceManager.setGuildLanguage(guildId, language);
}

export async function handleGuildWelcomeLanguageSelect(interaction: StringSelectMenuInteraction) {
  const [prefix, action, guildId] = interaction.customId.split(":");
  if (`${prefix}:${action}` !== "audio:welcome_lang") return false;

  const selectedLanguage = parseLanguage(interaction.values[0]);
  const messages = getMessages(selectedLanguage);

  if (!interaction.guild || interaction.guild.id !== guildId) {
    await interaction.reply({ content: "This panel does not belong to this server.", flags: MessageFlags.Ephemeral });
    return true;
  }

  const member = interaction.member instanceof GuildMember
    ? interaction.member
    : await interaction.guild.members.fetch(interaction.user.id).catch(() => null);

  if (!member?.permissions.has(PermissionFlagsBits.Administrator)) {
    await interaction.reply({ content: "Only administrators can change this language.", flags: MessageFlags.Ephemeral });
    return true;
  }
  if (!await requireTextReplyPermissions(interaction)) return true;
  if (!await requireComponentReplyPermissions(interaction)) return true;

  await saveGuildLanguage(interaction.guild.id, selectedLanguage);

  await interaction.update({
    components: [await buildWelcomePanel(interaction.guild.id, selectedLanguage)],
    flags: MessageFlags.IsComponentsV2,
  });
  await interaction.followUp({
    content: messages.welcome.languageSelected.replace("{language}", selectedLanguage.toUpperCase()),
    flags: MessageFlags.Ephemeral,
  });
  return true;
}

async function sendWelcome(guild: Guild) {
  const language = detectLanguage(guild.preferredLocale);
  await saveGuildLanguage(guild.id, language);
  const channel = await findFirstPublicWritableTextChannel(guild);
  if (!channel) {
    ConsoleMessage.warn(`No public writable text channel found for ${guild.name} (${guild.id}).`, "GuildCreate");
    return;
  }

  const componentCheck = checkCanSendComponents(channel);
  if (componentCheck.ok) {
    await channel.send({
      components: [await buildWelcomePanel(guild.id, language)],
      flags: MessageFlags.IsComponentsV2,
    });
  } else {
    await channel.send(getMessages(language).welcome.title).catch(() => null);
  }
}

type GuildLifecycleContext = {
  source?: "emit";
};

async function sendPrivateGuildCreateLog(guild: Guild, context?: GuildLifecycleContext) {
  const channelId = env.logs.privateLogsChannelId;
  if (!channelId) return;

  const channel = await guild.client.channels.fetch(channelId).catch(() => null);
  if (!channel || !("send" in channel)) return;

  const accentColor = context?.source === "emit" ? 0xF59E0B : 0x22C55E;
  const titleSuffix = context?.source === "emit" ? " (emit)" : "";
  const owner = await guild.fetchOwner().catch(() => null);
  const ownerLabel = owner ? `${owner.user.tag} (\`${owner.id}\`)` : guild.ownerId ? `<@${guild.ownerId}>` : "Unknown";
  const iconUrl = guild.iconURL({ extension: "png", size: 256 }) ?? "https://cdn.discordapp.com/embed/avatars/0.png";

  const panel = new ContainerBuilder()
    .setAccentColor(accentColor)
    .addTextDisplayComponents(text => text.setContent(`### Nook just joined ${guild.name}${titleSuffix}`))
    .addSeparatorComponents(separator => separator.setDivider(true).setSpacing(SeparatorSpacingSize.Large))
    .addSectionComponents(section =>
      section
        .addTextDisplayComponents(text =>
          text.setContent(
            [
              `- Members : ${guild.memberCount}`,
              `- Owner : ${ownerLabel}`,
            ].join("\n"),
          ),
        )
        .setThumbnailAccessory(thumbnail =>
          thumbnail
            .setURL(iconUrl)
            .setDescription(guild.name),
        ),
    );

  await (channel as TextChannel).send({
    components: [panel],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: NO_PING_ALLOWED_MENTIONS,
  }).catch(() => undefined);
}

export default EventBuilder({
  name: "guildCreate",
  description: "Send the welcome message when the bot joins a server",
}, async (guild, context?: GuildLifecycleContext) => {
  await sendWelcome(guild);
  await sendPrivateGuildCreateLog(guild, context);
});
