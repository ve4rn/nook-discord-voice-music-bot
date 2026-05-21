import { GuildMember, MessageFlags, PermissionFlagsBits } from "discord.js";
import { CommandBuilder } from "../../../config/CommandBuilder.js";
import { NO_PING_ALLOWED_MENTIONS } from "../../../config/DiscordMentions.js";
import { requireTextReplyPermissions } from "../../../config/CommandPermissionGuards.js";
import { buildLetsPlayPanel, buildNeutralNoticePanel } from "../../../services/audio/audioPanel.js";
import { defaultAudioCommandCopy } from "../../../services/audio/audioCommandCache.js";
import { formatSlashCommandMention } from "../../../services/audio/commandMentions.js";
import { requireJoinVoice } from "../../../services/audio/voiceGuards.js";

export default CommandBuilder({
  name: "join",
  description: "Join your voice channel",
  name_localizations: {
    fr: "rejoindre",
    de: "beitreten",
    "es-ES": "unirse",
  },
  description_localizations: {
    fr: "Rejoindre votre salon vocal",
    de: "Deinem Sprachkanal beitreten",
    "es-ES": "Unirse a tu canal de voz",
  },
  permissions: [PermissionFlagsBits.Connect],
  cooldown: 2,
}, async (interaction, app) => {
  if (!interaction.guildId) {
    return interaction.reply({ components: [await buildNeutralNoticePanel(null, defaultAudioCommandCopy.serverOnly)], flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2 });
  }
  if (!await requireTextReplyPermissions(interaction)) return;

  const voiceChannelId = await requireJoinVoice(interaction, app);
  if (!voiceChannelId) return;

  await app.audio?.join(interaction.guildId, voiceChannelId, interaction.channelId);
  const accentColor = interaction.member instanceof GuildMember ? interaction.member.displayColor : null;
  return interaction.reply({
    components: [await buildLetsPlayPanel({
      guildId: interaction.guildId,
      memberMention: interaction.user.toString(),
      playCommand: await formatSlashCommandMention(interaction.client, "play"),
      accentColor,
    })],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: NO_PING_ALLOWED_MENTIONS,
  });
});
