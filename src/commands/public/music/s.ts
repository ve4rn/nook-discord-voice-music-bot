import { MessageFlags, PermissionFlagsBits } from "discord.js";
import { CommandBuilder } from "../../../config/CommandBuilder.js";
import { requireComponentReplyPermissions, requireTextReplyPermissions } from "../../../config/CommandPermissionGuards.js";
import { buildAudioPanel } from "../../../services/audio/audioPanel.js";
import { defaultAudioCommandCopy, getAudioCommandCopy } from "../../../services/audio/audioCommandCache.js";
import { requireControlVoice } from "../../../services/audio/voiceGuards.js";

export default CommandBuilder({
    name: "skip",
    description: "Skip to the next track",
    name_localizations: {
        fr: "passer",
        de: "ueberspringen",
        "es-ES": "saltar",
    },
    description_localizations: {
        fr: "Passer a la musique suivante",
        de: "Zum naechsten Titel springen",
        "es-ES": "Saltar a la siguiente musica",
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

    const vote = await app.audio?.voteSkip(interaction.guildId, interaction.user.id);
    if (!vote?.skipped) {
        return interaction.reply({
            content: vote?.reason === "no_next"
                ? copy.controls.noNextTrack
                : vote && vote.needed > 0
                ? copy.voteSkip(vote.votes, vote.needed)
                : copy.noCurrentTrack,
            flags: MessageFlags.Ephemeral,
        });
    }

    const state = await app.audio!.getQueue(interaction.guildId);
    if (!await requireComponentReplyPermissions(interaction)) return;
    return interaction.reply({
        components: [await buildAudioPanel(state, interaction.guildId)],
        flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
    });
});
