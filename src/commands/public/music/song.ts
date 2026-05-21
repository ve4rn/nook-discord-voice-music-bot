import { MessageFlags, PermissionFlagsBits } from "discord.js";
import { CommandBuilder } from "../../../config/CommandBuilder.js";
import { NO_PING_ALLOWED_MENTIONS } from "../../../config/DiscordMentions.js";
import { requireTextReplyPermissions } from "../../../config/CommandPermissionGuards.js";
import { buildNeutralNoticePanel, buildTrackNoticePanel } from "../../../services/audio/audioPanel.js";
import { defaultAudioCommandCopy, getAudioCommandCopy } from "../../../services/audio/audioCommandCache.js";
import { requirePlayableVoice } from "../../../services/audio/voiceGuards.js";

export default CommandBuilder({
  name: "song",
  description: "Show the current song",
  name_localizations: {
    fr: "son",
    de: "song",
    "es-ES": "cancion",
  },
  description_localizations: {
    fr: "Afficher le son en cours",
    de: "Den aktuellen Song anzeigen",
    "es-ES": "Mostrar la cancion actual",
  },
  permissions: [PermissionFlagsBits.SendMessages],
  cooldown: 2,
}, async (interaction, app) => {
  if (!interaction.guildId) {
    return interaction.reply({
      components: [await buildNeutralNoticePanel(null, defaultAudioCommandCopy.serverOnly)],
      flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
    });
  }
  if (!await requireTextReplyPermissions(interaction)) return;

  const copy = await getAudioCommandCopy(interaction.guildId);
  if (!await requirePlayableVoice(interaction, app)) return;

  const state = await app.audio?.getQueue(interaction.guildId);
  if (!state?.current) {
    return interaction.reply({
      components: [await buildNeutralNoticePanel(interaction.guildId, copy.noCurrentTrack)],
      flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
    });
  }

  return interaction.reply({
    components: [await buildTrackNoticePanel(state.current, false, interaction.guildId, state.positionMs)],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: NO_PING_ALLOWED_MENTIONS,
  });
});
