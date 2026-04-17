import {
    ButtonBuilder,
    ButtonInteraction,
    ButtonStyle,
    MessageFlags,
    PermissionFlagsBits,
    SeparatorSpacingSize,
    StringSelectMenuBuilder,
    StringSelectMenuInteraction,
    type AutocompleteInteraction,
    type ChatInputCommandInteraction,
} from "discord.js";
import { CommandBuilder } from "../../../config/CommandBuilder.js";
import { requireComponentReplyPermissions, requireTextReplyPermissions } from "../../../config/CommandPermissionGuards.js";
import { NookBuilder } from "../../../config/NookBuilder.js";
import type App from "../../../config/App.js";
import { buildTrackNoticePanel } from "../../../services/audio/audioPanel.js";
import { isQueueLimitError } from "../../../services/audio/AudioErrorMapper.js";
import { defaultAudioCommandCopy, getAudioCommandCopy, getPlayErrorMessage } from "../../../services/audio/audioCommandCache.js";
import { formatDuration, getAudioQueueAvailableSlots, type AudioCommandCopy, type StoredTrack } from "../../../services/audio/types.js";
import type { AudioPlaylistConfig, PlaylistTrackConfig } from "../../../services/audio/playlists.js";
import { requirePlayableVoice } from "../../../services/audio/voiceGuards.js";

const IMPORT_PREFIX = "play:import";
const IMPORT_PAGE_PREFIX = "play:import_page";
const IMPORT_CACHE_TTL_MS = 10 * 60 * 1000;
const MAX_MENU_OPTIONS = 25;
const IMPORT_TRACK_LIMIT = 100;
const SPOTIFY_PLAYLIST_UNAVAILABLE_MESSAGE = "Spotify playlist imports are not available right now due to API issues. Please use a YouTube, SoundCloud, or Deezer playlist URL.";

type ImportedPlaylistCacheEntry = {
    expiresAt: number;
    guildId: string;
    userId: string;
    playlist: AudioPlaylistConfig;
};

const importedPlaylists = new Map<string, ImportedPlaylistCacheEntry>();

function playlistTrackId(track: StoredTrack) {
    return (track.identifier || track.title)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 48) || "track";
}

function importCustomId(guildId: string, userId: string, importId: string) {
    return `${IMPORT_PREFIX}:${guildId}:${userId}:${importId}`;
}

function importPageCustomId(guildId: string, userId: string, importId: string, page: number) {
    return `${IMPORT_PAGE_PREFIX}:${guildId}:${userId}:${importId}:${page}`;
}

function parseImportCustomId(customId: string) {
    const [prefix, action, guildId, userId, importId] = customId.split(":");
    if (`${prefix}:${action}` !== IMPORT_PREFIX || !guildId || !userId || !importId) return null;
    return { guildId, userId, importId };
}

function parseImportPageCustomId(customId: string) {
    const [prefix, action, guildId, userId, importId, rawPage] = customId.split(":");
    if (`${prefix}:${action}` !== IMPORT_PAGE_PREFIX || !guildId || !userId || !importId) return null;
    const page = Number.parseInt(rawPage ?? "", 10);
    return { guildId, userId, importId, page: Number.isFinite(page) ? page : 0 };
}

function pruneImportedPlaylists() {
    const now = Date.now();
    for (const [id, entry] of importedPlaylists) {
        if (entry.expiresAt <= now) importedPlaylists.delete(id);
    }
}

function cacheImportedPlaylist(guildId: string, userId: string, playlist: AudioPlaylistConfig) {
    pruneImportedPlaylists();
    importedPlaylists.set(playlist.id, {
        expiresAt: Date.now() + IMPORT_CACHE_TTL_MS,
        guildId,
        userId,
        playlist,
    });
}

function truncate(text: string, maxLength: number) {
    if (text.length <= maxLength) return text;
    return `${text.slice(0, Math.max(0, maxLength - 3))}...`;
}

function formatPlaylistTrackLabel(track: PlaylistTrackConfig, copy: AudioCommandCopy) {
    const duration = formatDuration(track.duration, copy);
    const fixedLength = `${track.author} -  (${duration})`.length;
    const titleLimit = Math.max(8, 100 - fixedLength);
    const croppedTitle = truncate(track.title, titleLimit);
    return truncate(`${track.author} - ${croppedTitle} (${duration})`, 100);
}

function importedPlaylistOption(track: PlaylistTrackConfig, copy: AudioCommandCopy) {
    return {
        label: formatPlaylistTrackLabel(track, copy),
        value: track.id,
    };
}

function getImportedPlaylistPageCount(playlist: AudioPlaylistConfig) {
    return Math.max(1, Math.ceil(playlist.tracks.length / MAX_MENU_OPTIONS));
}

function clampImportedPlaylistPage(playlist: AudioPlaylistConfig, page: number) {
    return Math.min(Math.max(0, page), getImportedPlaylistPageCount(playlist) - 1);
}

function buildImportedPlaylistPanel(playlist: AudioPlaylistConfig, guildId: string, userId: string, copy: AudioCommandCopy, availableSlots: number, page = 0) {
    const pageCount = getImportedPlaylistPageCount(playlist);
    const safePage = clampImportedPlaylistPage(playlist, page);
    const pageStart = safePage * MAX_MENU_OPTIONS;
    const shownTracks = playlist.tracks.slice(pageStart, pageStart + MAX_MENU_OPTIONS);
    const maxSelectable = Math.min(availableSlots, shownTracks.length, MAX_MENU_OPTIONS);
    const previewLines = shownTracks.map((track, index) =>
        `**${pageStart + index + 1}.** ${formatPlaylistTrackLabel(track, copy)}`,
    );

    const panel = new NookBuilder()
        .addTextDisplayComponents(text =>
            text.setContent(`## ${copy.playlist.title(playlist.name)}\n${copy.playlist.description(availableSlots)}`),
        );

    if (previewLines.length > 0) {
        panel
            .addSeparatorComponents(separator => separator.setDivider(true).setSpacing(SeparatorSpacingSize.Small))
            .addTextDisplayComponents(text => text.setContent(previewLines.join("\n")));
    }

    panel
        .addSeparatorComponents(separator => separator.setDivider(true).setSpacing(SeparatorSpacingSize.Small))
        .addActionRowComponents(row =>
            row.addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId(importCustomId(guildId, userId, playlist.id))
                    .setPlaceholder(copy.playlist.placeholder)
                    .setMinValues(1)
                    .setMaxValues(maxSelectable)
                    .addOptions(shownTracks.map(track => importedPlaylistOption(track, copy))),
            ),
        );

    if (pageCount <= 1) return panel;

    return panel.addActionRowComponents(row =>
        row.addComponents(
            new ButtonBuilder()
                .setCustomId(importPageCustomId(guildId, userId, playlist.id, safePage - 1))
                .setLabel("<")
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(safePage === 0),
            new ButtonBuilder()
                .setCustomId(importPageCustomId(guildId, userId, playlist.id, safePage))
                .setLabel(`${safePage + 1}/${pageCount}`)
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(true),
            new ButtonBuilder()
                .setCustomId(importPageCustomId(guildId, userId, playlist.id, safePage + 1))
                .setLabel(">")
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(safePage >= pageCount - 1),
        ),
    );
}

function buildNoticePanel(message: string) {
    return new NookBuilder().addTextDisplayComponents(text => text.setContent(message));
}

function selectedTracks(playlist: AudioPlaylistConfig, values: string[]) {
    const selectedIds = new Set(values);
    return playlist.tracks.filter(track => selectedIds.has(track.id));
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

export async function handleImportedPlaylistSelect(interaction: StringSelectMenuInteraction) {
    const parsed = parseImportCustomId(interaction.customId);
    if (!parsed) return false;

    const app = interaction.client as App;
    const copy = interaction.guildId
        ? await getAudioCommandCopy(interaction.guildId)
        : defaultAudioCommandCopy;

    if (!interaction.guildId || interaction.guildId !== parsed.guildId) {
        await interaction.reply({ content: copy.playlist.guildMismatch, flags: MessageFlags.Ephemeral });
        return true;
    }
    if (!await requireTextReplyPermissions(interaction)) return true;

    if (interaction.user.id !== parsed.userId) {
        await interaction.reply({ content: copy.playlist.ownerOnly, flags: MessageFlags.Ephemeral });
        return true;
    }

    if (!app.audio) {
        await interaction.reply({ content: copy.playlist.playerNotReady, flags: MessageFlags.Ephemeral });
        return true;
    }

    const voiceChannelId = await requirePlayableVoice(interaction, app);
    if (!voiceChannelId) return true;
    if (!await requireComponentReplyPermissions(interaction)) return true;

    if (!interaction.channelId) {
        await interaction.reply({ content: copy.playlist.addFailed, flags: MessageFlags.Ephemeral });
        return true;
    }

    pruneImportedPlaylists();
    const cached = importedPlaylists.get(parsed.importId);
    if (!cached || cached.guildId !== interaction.guildId || cached.userId !== interaction.user.id) {
        await interaction.reply({ content: copy.playlist.notFound, flags: MessageFlags.Ephemeral });
        return true;
    }

    const state = await app.audio.getQueue(interaction.guildId);
    const availableSlots = getAudioQueueAvailableSlots(state);
    if (availableSlots <= 0) {
        await interaction.reply({ content: copy.playlist.fullQueue, flags: MessageFlags.Ephemeral });
        return true;
    }

    const tracks = selectedTracks(cached.playlist, interaction.values).slice(0, availableSlots);
    if (tracks.length === 0) {
        await interaction.reply({ content: copy.playlist.noSelection, flags: MessageFlags.Ephemeral });
        return true;
    }

    await interaction.deferUpdate();

    try {
        const result = await app.audio.addPlaylistTracks({
            guildId: interaction.guildId,
            voiceChannelId,
            textChannelId: interaction.channelId,
            requestedBy: interaction.user.id,
            tracks,
        });

        const message = result.added.length === interaction.values.length
            ? copy.playlist.added(result.added.length)
            : copy.playlist.partiallyAdded(result.added.length, interaction.values.length);
        importedPlaylists.delete(parsed.importId);
        await interaction.editReply({ components: [buildNoticePanel(message)], flags: MessageFlags.IsComponentsV2 });
    } catch (error) {
        const errorMessage = isQueueLimitError(error)
            ? copy.playlist.fullQueue
            : getPlayErrorMessage(copy, error) || copy.playlist.addFailed;
        await interaction.editReply({
            components: [buildNoticePanel(errorMessage)],
            flags: MessageFlags.IsComponentsV2,
        });
    }

    return true;
}

export async function handleImportedPlaylistPageButton(interaction: ButtonInteraction) {
    const parsed = parseImportPageCustomId(interaction.customId);
    if (!parsed) return false;

    const app = interaction.client as App;
    const copy = interaction.guildId
        ? await getAudioCommandCopy(interaction.guildId)
        : defaultAudioCommandCopy;

    if (!interaction.guildId || interaction.guildId !== parsed.guildId) {
        await interaction.reply({ content: copy.playlist.guildMismatch, flags: MessageFlags.Ephemeral });
        return true;
    }
    if (!await requireTextReplyPermissions(interaction)) return true;

    if (interaction.user.id !== parsed.userId) {
        await interaction.reply({ content: copy.playlist.ownerOnly, flags: MessageFlags.Ephemeral });
        return true;
    }

    if (!app.audio) {
        await interaction.reply({ content: copy.playlist.playerNotReady, flags: MessageFlags.Ephemeral });
        return true;
    }
    if (!await requireComponentReplyPermissions(interaction)) return true;

    pruneImportedPlaylists();
    const cached = importedPlaylists.get(parsed.importId);
    if (!cached || cached.guildId !== interaction.guildId || cached.userId !== interaction.user.id) {
        await interaction.reply({ content: copy.playlist.notFound, flags: MessageFlags.Ephemeral });
        return true;
    }

    const state = await app.audio.getQueue(interaction.guildId);
    const availableSlots = getAudioQueueAvailableSlots(state);
    if (availableSlots <= 0) {
        await interaction.reply({ content: copy.playlist.fullQueue, flags: MessageFlags.Ephemeral });
        return true;
    }

    await interaction.update({
        components: [buildImportedPlaylistPanel(cached.playlist, interaction.guildId, interaction.user.id, copy, availableSlots, parsed.page)],
        flags: MessageFlags.IsComponentsV2,
    });
    return true;
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

async function replyPlayError(interaction: ChatInputCommandInteraction, content: string) {
    if (interaction.deferred || interaction.replied) {
        return interaction.editReply({ content, components: [] }).catch(() => undefined);
    }

    return interaction.reply({ content, flags: MessageFlags.Ephemeral }).catch(() => undefined);
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
    if (!await requireTextReplyPermissions(interaction)) return;

    const copy = await getAudioCommandCopy(interaction.guildId);
    const query = interaction.options.getString("query", true);
    if (!app.audio) {
        return interaction.reply({ content: copy.playlist.playerNotReady, flags: MessageFlags.Ephemeral });
    }

    if (app.audio.search.isSpotifyPlaylistUrl(query)) {
        return interaction.reply({ content: SPOTIFY_PLAYLIST_UNAVAILABLE_MESSAGE, flags: MessageFlags.Ephemeral });
    }

    const voiceChannelId = await requirePlayableVoice(interaction, app);
    if (!voiceChannelId) return;
    if (!await requireComponentReplyPermissions(interaction)) return;

    try {
        const playlistImportUrl = await app.audio.search.resolvePlaylistImportUrl(query);
        if (playlistImportUrl) {
            if (!app.audio.lavalink.useable) {
                return interaction.reply({ content: copy.errors.lavalinkNotReady, flags: MessageFlags.Ephemeral });
            }

            const state = await app.audio.getQueue(interaction.guildId);
            const availableSlots = getAudioQueueAvailableSlots(state);
            if (availableSlots <= 0) {
                return interaction.reply({ content: copy.playlist.fullQueue, flags: MessageFlags.Ephemeral });
            }

            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            const playlist = await app.audio.search.importPlaylistUrl(playlistImportUrl, interaction.user.id, IMPORT_TRACK_LIMIT);
            if (!playlist || playlist.tracks.length === 0) {
                return interaction.editReply({ content: copy.playlist.notFound });
            }

            cacheImportedPlaylist(interaction.guildId, interaction.user.id, playlist);
            return interaction.editReply({
                components: [buildImportedPlaylistPanel(playlist, interaction.guildId, interaction.user.id, copy, availableSlots)],
                flags: MessageFlags.IsComponentsV2,
            });
        }

        await interaction.deferReply();
        const result = await app.audio.play({
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
        return replyPlayError(interaction, getPlayErrorMessage(copy, error));
    }
}, async (interaction, app) => {
    const focused = interaction.options.getFocused();
    const choices = await app.audio?.search.autocomplete(String(focused), interaction.user.id) ?? [];
    await safeAutocompleteRespond(interaction, choices.map(choice => ({
        name: choice.label,
        value: choice.token,
    })));
});
