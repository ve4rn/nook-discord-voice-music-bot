import { MessageFlags, PermissionFlagsBits } from "discord.js";
import { CommandBuilder } from "../../../config/CommandBuilder.js";
import { requireTextReplyPermissions } from "../../../config/CommandPermissionGuards.js";
import { buildNeutralNoticePanel } from "../../../services/audio/audioPanel.js";
import { defaultAudioCommandCopy, getAudioCommandCopy } from "../../../services/audio/audioCommandCache.js";
import { requireControlVoice } from "../../../services/audio/voiceGuards.js";

export default CommandBuilder({
  name: "leave",
  description: "Leave the voice channel and keep the session resumable",
  name_localizations: {
    fr: "quitter",
    de: "verlassen",
    "es-ES": "salir",
  },
  description_localizations: {
    fr: "Quitter le vocal et garder la session reprise",
    de: "Den Sprachkanal verlassen und die Sitzung fortsetzbar behalten",
    "es-ES": "Salir del canal de voz y mantener la sesion reanudable",
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

  await app.audio?.stop(interaction.guildId, interaction.user.toString());
  return interaction.reply({ components: [await buildNeutralNoticePanel(interaction.guildId, copy.controls.leaveSuccess)], flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2 });
});
