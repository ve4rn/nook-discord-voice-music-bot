import { MessageFlags, PermissionFlagsBits } from "discord.js";
import { CommandBuilder } from "../../../config/CommandBuilder.js";
import { NO_PING_ALLOWED_MENTIONS } from "../../../config/DiscordMentions.js";
import { requireTextReplyPermissions } from "../../../config/CommandPermissionGuards.js";
import { buildNeutralNoticePanel, buildQueuePanel } from "../../../services/audio/audioPanel.js";
import { defaultAudioCommandCopy, getAudioCommandCopy } from "../../../services/audio/audioCommandCache.js";
import { requirePlayableVoice } from "../../../services/audio/voiceGuards.js";

export default CommandBuilder({
  name: "queue",
  description: "Show the music queue",
  name_localizations: {
    fr: "file",
    de: "warteschlange",
    "es-ES": "cola",
  },
  description_localizations: {
    fr: "Afficher la file de musique",
    de: "Die Musikwarteschlange anzeigen",
    "es-ES": "Mostrar la cola de musica",
  },
  permissions: [PermissionFlagsBits.SendMessages],
  cooldown: 2,
}, async (interaction, app) => {
  if (!interaction.guildId) {
    return interaction.reply({ components: [await buildNeutralNoticePanel(null, defaultAudioCommandCopy.serverOnly)], flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2 });
  }
  if (!await requireTextReplyPermissions(interaction)) return;

  const copy = await getAudioCommandCopy(interaction.guildId);
  if (!await requirePlayableVoice(interaction, app)) return;

  const state = await app.audio?.getQueue(interaction.guildId);
  if (!state) {
    return interaction.reply({ components: [await buildNeutralNoticePanel(interaction.guildId, copy.emptyQueue)], flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2 });
  }

  return interaction.reply({
    components: [await buildQueuePanel(state, interaction.guildId)],
    flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
    allowedMentions: NO_PING_ALLOWED_MENTIONS,
  });
});
