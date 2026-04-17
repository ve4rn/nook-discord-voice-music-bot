import { MessageFlags, PermissionFlagsBits } from "discord.js";
import { CommandBuilder } from "../../../config/CommandBuilder.js";
import { requireTextReplyPermissions } from "../../../config/CommandPermissionGuards.js";
import { defaultAudioCommandCopy, getAudioCommandCopy } from "../../../services/audio/audioCommandCache.js";
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
        return interaction.reply({ content: defaultAudioCommandCopy.serverOnly, flags: MessageFlags.Ephemeral });
    }
    if (!await requireTextReplyPermissions(interaction)) return;

    const copy = await getAudioCommandCopy(interaction.guildId);

    const voiceChannelId = await requireJoinVoice(interaction, app);
    if (!voiceChannelId) return;

    await app.audio?.join(interaction.guildId, voiceChannelId, interaction.channelId);
    return interaction.reply({ content: copy.voice.joinSuccess, flags: MessageFlags.Ephemeral });
});
