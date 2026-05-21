import { MessageFlags, PermissionFlagsBits } from "discord.js";
import { CommandBuilder } from "../../../config/CommandBuilder.js";
import { NO_PING_ALLOWED_MENTIONS } from "../../../config/DiscordMentions.js";
import { requireTextReplyPermissions } from "../../../config/CommandPermissionGuards.js";
import { buildNeutralNoticePanel, buildQueuePanel } from "../../../services/audio/audioPanel.js";
import { defaultAudioCommandCopy, getAudioCommandCopy } from "../../../services/audio/audioCommandCache.js";
import { requireControlVoice } from "../../../services/audio/voiceGuards.js";

export default CommandBuilder({
  name: "skip",
  description: "Vote to skip to the next track",
  name_localizations: {
    fr: "passer",
    de: "ueberspringen",
    "es-ES": "saltar",
  },
  description_localizations: {
    fr: "Voter pour passer a la musique suivante",
    de: "Abstimmen, um zum naechsten Titel zu springen",
    "es-ES": "Votar para saltar a la siguiente musica",
  },
  permissions: [PermissionFlagsBits.Connect],
  cooldown: 2,
}, async (interaction, app) => {
  if (!interaction.guildId) {
    return interaction.reply({ components: [await buildNeutralNoticePanel(null, defaultAudioCommandCopy.serverOnly)], flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2 });
  }
  if (!await requireTextReplyPermissions(interaction)) return;

  const copy = await getAudioCommandCopy(interaction.guildId);
  if (!await requireControlVoice(interaction, app)) return;

  const vote = await app.audio?.voteSkip(interaction.guildId, interaction.user.id);
  if (!vote?.skipped) {
    return interaction.reply({
      components: [await buildNeutralNoticePanel(
        interaction.guildId,
        vote?.reason === "no_next"
          ? copy.controls.noNextTrack
          : vote
          ? copy.voteSkip(vote.votes, vote.needed)
          : copy.noCurrentTrack,
      )],
      flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
    });
  }

  return interaction.reply({
    components: [await buildQueuePanel(await app.audio!.getQueue(interaction.guildId), interaction.guildId)],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: NO_PING_ALLOWED_MENTIONS,
  });
});
