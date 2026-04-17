import { MessageFlags, PermissionFlagsBits } from "discord.js";
import { CommandBuilder } from "../../../config/CommandBuilder.js";
import { requireComponentReplyPermissions, requireTextReplyPermissions } from "../../../config/CommandPermissionGuards.js";
import { buildAudioPanel } from "../../../services/audio/audioPanel.js";
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
        return interaction.reply({ content: defaultAudioCommandCopy.serverOnly, flags: MessageFlags.Ephemeral });
    }
    if (!await requireTextReplyPermissions(interaction)) return;

    const copy = await getAudioCommandCopy(interaction.guildId);

    if (!await requirePlayableVoice(interaction, app)) return;

    const state = await app.audio?.getQueue(interaction.guildId);
    if (!state || (!state.current && state.queue.length === 0)) {
        return interaction.reply({ content: copy.emptyQueue, flags: MessageFlags.Ephemeral });
    }

    const panel = await buildAudioPanel(state, interaction.guildId);
    if (!await requireComponentReplyPermissions(interaction)) return;

    return interaction.reply({
        components: [panel],
        flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
    });
});
