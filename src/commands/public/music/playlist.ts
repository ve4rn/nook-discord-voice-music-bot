import { MessageFlags, PermissionFlagsBits } from "discord.js";
import { CommandBuilder } from "../../../config/CommandBuilder.js";
import { requireTextReplyPermissions } from "../../../config/CommandPermissionGuards.js";
import { buildNeutralNoticePanel, buildPlaylistLauncherPanel } from "../../../services/audio/audioPanel.js";
import { defaultAudioCommandCopy } from "../../../services/audio/audioCommandCache.js";

export default CommandBuilder({
  name: "playlist",
  description: "Pick a playlist and launch the first 10 tracks instantly",
  description_localizations: {
    fr: "Choisis une playlist et lance 10 titres instantanement",
    de: "Waehle eine Playlist und starte sofort 10 Titel",
    "es-ES": "Elige una playlist y lanza 10 pistas al instante",
  },
  permissions: [PermissionFlagsBits.Connect],
  cooldown: 2,
}, async (interaction) => {
  if (!interaction.guildId) {
    return interaction.reply({ components: [await buildNeutralNoticePanel(null, defaultAudioCommandCopy.playlist.serverOnly)], flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2 });
  }
  if (!await requireTextReplyPermissions(interaction)) return;

  return interaction.reply({
    components: [await buildPlaylistLauncherPanel(interaction.guildId)],
    flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
  });
});
