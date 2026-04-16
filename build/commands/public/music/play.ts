import { MessageFlags, PermissionFlagsBits, type AutocompleteInteraction } from "discord.js";
import { CommandBuilder } from "../../../config/CommandBuilder.js";
import { buildTrackNoticePanel } from "../../../services/audio/audioPanel.js";
import { defaultAudioCommandCopy, getAudioCommandCopy, getPlayErrorMessage } from "../../../services/audio/audioCommandCache.js";
import type { StoredTrack } from "../../../services/audio/types.js";
import { requirePlayableVoice } from "../../../services/audio/voiceGuards.js";

function playlistTrackId(track: StoredTrack) {
    return (track.identifier || track.title)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 48) || "track";
}

function logPlaylistTrackData(track: StoredTrack) {
    console.info("[playlist-track]", JSON.stringify({
        id: playlistTrackId(track),
        title: track.title,
        author: track.author ?? "",
        duration: track.duration,
        encoded: track.encoded ?? "",
        query: track.url || [track.author, track.title].filter(Boolean).join(" "),
        url: track.url,
        source: track.source,
        identifier: track.identifier,
        artworkUrl: track.artworkUrl,
        isStream: track.isStream ?? false,
    }, null, 2));
}

function isUnknownInteractionError(error: unknown) {
    return (error as { code?: number })?.code === 10062;
}

async function safeAutocompleteRespond(interaction: AutocompleteInteraction, choices: Array<{ name: string; value: string }>) {
    await interaction.respond(choices).catch(error => {
        if (isUnknownInteractionError(error)) return;
        throw error;
    });
}

export default CommandBuilder({
    name: "play",
    description: "Play or add music to the queue",
    name_localizations: {
        fr: "jouer",
        de: "spielen",
        "es-ES": "reproducir",
    },
    description_localizations: {
        fr: "Lancer ou ajouter une musique",
        de: "Musik abspielen oder zur Warteschlange hinzufuegen",
        "es-ES": "Reproducir o anadir musica a la cola",
    },
    permissions: [PermissionFlagsBits.Connect],
    cooldown: 2,
    args: [
        {
            name: "query",
            description: "Title, URL, or autocomplete result",
            name_localizations: {
                fr: "titre",
                de: "suche",
                "es-ES": "titulo",
            },
            description_localizations: {
                fr: "Titre, URL, ou resultat autocomplete",
                de: "Titel, URL oder Autocomplete-Ergebnis",
                "es-ES": "Titulo, URL o resultado de autocompletado",
            },
            type: "String",
            required: true,
            autocomplete: true,
        },
    ],
}, async (interaction, app) => {
    if (!interaction.guildId) {
        return interaction.reply({ content: defaultAudioCommandCopy.serverOnly, flags: MessageFlags.Ephemeral });
    }
    const copy = await getAudioCommandCopy(interaction.guildId);

    const voiceChannelId = await requirePlayableVoice(interaction, app);
    if (!voiceChannelId) return;

    await interaction.deferReply();
    const query = interaction.options.getString("query", true);

    try {
        const result = await app.audio!.play({
            guildId: interaction.guildId,
            voiceChannelId,
            textChannelId: interaction.channelId,
            query,
            requestedBy: interaction.user.id,
        });

        logPlaylistTrackData(result.track);
        const panel = await buildTrackNoticePanel(result.track, result.queued, interaction.guildId);
        return interaction.editReply({
            components: [panel],
            flags: MessageFlags.IsComponentsV2,
        });
    } catch (error) {
        return interaction.editReply({ content: getPlayErrorMessage(copy, error) });
    }
}, async (interaction, app) => {
    const focused = interaction.options.getFocused();
    const choices = await app.audio?.search.autocomplete(String(focused), interaction.user.id) ?? [];
    await safeAutocompleteRespond(interaction, choices.map(choice => ({
        name: choice.label,
        value: choice.token,
    })));
});
