import { MessageFlags, PermissionFlagsBits } from "discord.js";
import { CommandBuilder } from "../../../config/CommandBuilder.js";
import { requireTextReplyPermissions } from "../../../config/CommandPermissionGuards.js";
import { defaultAudioCommandCopy, getAudioCommandCopy } from "../../../services/audio/audioCommandCache.js";
import { requireControlVoice } from "../../../services/audio/voiceGuards.js";

export default CommandBuilder({
    name: "leave",
    description: "Leave the voice channel and reset the music session",
    name_localizations: {
        fr: "quitter",
        de: "verlassen",
        "es-ES": "salir",
    },
    description_localizations: {
        fr: "Quitter le vocal et reinitialiser la musique",
        de: "Den Sprachkanal verlassen und die Musiksitzung zuruecksetzen",
        "es-ES": "Salir del canal de voz y reiniciar la sesion de musica",
    },
    permissions: [PermissionFlagsBits.Connect],
    cooldown: 2,
}, async (interaction, app) => {
    if (!interaction.guildId) {
        return interaction.reply({ content: defaultAudioCommandCopy.serverOnly, flags: MessageFlags.Ephemeral });
    }
    if (!await requireTextReplyPermissions(interaction)) return;

    const copy = await getAudioCommandCopy(interaction.guildId);

    if (!await requireControlVoice(interaction, app)) return;

    await app.audio?.leave(interaction.guildId);
    return interaction.reply({ content: copy.controls.leaveSuccess, flags: MessageFlags.Ephemeral });
});
