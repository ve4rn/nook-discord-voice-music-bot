import {
    MessageFlags,
    PermissionFlagsBits,
    SeparatorSpacingSize,
    StringSelectMenuBuilder,
    StringSelectMenuInteraction,
} from "discord.js";
import { CommandBuilder } from "../../../config/CommandBuilder.js";
import { requireComponentReplyPermissions, requireTextReplyPermissions } from "../../../config/CommandPermissionGuards.js";
import { NookBuilder } from "../../../config/NookBuilder.js";
import type App from "../../../config/App.js";
import { defaultAudioCommandCopy, getAudioCommandCopy, getPlayErrorMessage } from "../../../services/audio/audioCommandCache.js";
import { formatDuration, getAudioQueueAvailableSlots, type AudioCommandCopy } from "../../../services/audio/types.js";
import { getAudioPlaylist, searchAudioPlaylists, type AudioPlaylistConfig, type PlaylistTrackConfig } from "../../../services/audio/playlists.js";
import { requirePlayableVoice } from "../../../services/audio/voiceGuards.js";

const PLAYLIST_PREFIX = "playlist:add";
const MAX_MENU_OPTIONS = 25;

function playlistCustomId(guildId: string, userId: string, playlistId: string) {
    return `${PLAYLIST_PREFIX}:${guildId}:${userId}:${playlistId}`;
}

function parsePlaylistCustomId(customId: string) {
    const [prefix, action, guildId, userId, playlistId] = customId.split(":");
    if (`${prefix}:${action}` !== PLAYLIST_PREFIX || !guildId || !userId || !playlistId) return null;
    return { guildId, userId, playlistId };
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

function playlistOption(track: PlaylistTrackConfig, copy: AudioCommandCopy) {
    return {
        label: formatPlaylistTrackLabel(track, copy),
        value: track.id,
    };
}

function buildPlaylistPanel(playlist: AudioPlaylistConfig, guildId: string, userId: string, copy: AudioCommandCopy, availableSlots: number) {
    const shownTracks = playlist.tracks.slice(0, MAX_MENU_OPTIONS);
    const maxSelectable = Math.min(availableSlots, shownTracks.length, MAX_MENU_OPTIONS);
    const previewLines = shownTracks.map((track, index) =>
        `**${index + 1}.** ${formatPlaylistTrackLabel(track, copy)}`,
    );
    const hiddenCount = Math.max(0, playlist.tracks.length - shownTracks.length);

    const panel = new NookBuilder()
        .addTextDisplayComponents(text =>
            text.setContent(`## ${copy.playlist.title(playlist.name)}\n${copy.playlist.description(availableSlots)}`),
        );

    if (previewLines.length > 0) {
        panel
            .addSeparatorComponents(separator => separator.setDivider(true).setSpacing(SeparatorSpacingSize.Small))
            .addTextDisplayComponents(text => text.setContent(previewLines.join("\n")));
    }

    if (hiddenCount > 0) {
        panel.addTextDisplayComponents(text => text.setContent(copy.playlist.truncated(hiddenCount)));
    }

    return panel
        .addSeparatorComponents(separator => separator.setDivider(true).setSpacing(SeparatorSpacingSize.Small))
        .addActionRowComponents(row =>
            row.addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId(playlistCustomId(guildId, userId, playlist.id))
                    .setPlaceholder(copy.playlist.placeholder)
                    .setMinValues(1)
                    .setMaxValues(maxSelectable)
                    .addOptions(shownTracks.map(track => playlistOption(track, copy))),
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

export async function handlePlaylistSelect(interaction: StringSelectMenuInteraction) {
    const parsed = parsePlaylistCustomId(interaction.customId);
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

    const playlist = getAudioPlaylist(parsed.playlistId);
    if (!playlist) {
        await interaction.reply({ content: copy.playlist.notFound, flags: MessageFlags.Ephemeral });
        return true;
    }

    const tracks = selectedTracks(playlist, interaction.values);
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

        const message = result.added.length === tracks.length
            ? copy.playlist.added(result.added.length)
            : copy.playlist.partiallyAdded(result.added.length, tracks.length);
        await interaction.editReply({ components: [buildNoticePanel(message)], flags: MessageFlags.IsComponentsV2 });
    } catch (error) {
        const errorMessage = error instanceof Error && error.message === "QUEUE_LIMIT_REACHED"
            ? copy.playlist.fullQueue
            : getPlayErrorMessage(copy, error) || copy.playlist.addFailed;
        await interaction.editReply({
            components: [buildNoticePanel(errorMessage)],
            flags: MessageFlags.IsComponentsV2,
        });
    }

    return true;
}

export default CommandBuilder({
    name: "playlist",
    description: "Pick a vibe and start instantly",
    description_localizations: {
        fr: "Choisis une ambiance et lance instantanément",
        de: "Wähle eine Stimmung und starte sofort",
        "es-ES": "Elige un ambiente y empieza al instante",
    },
    permissions: [PermissionFlagsBits.Connect],
    cooldown: 2,
    args: [
        {
            name: "type",
            description: "Playlist type",
            name_localizations: {
                fr: "type",
                de: "typ",
                "es-ES": "tipo",
            },
            description_localizations: {
                fr: "Type de playlist",
                de: "Playlist-Typ",
                "es-ES": "Tipo de playlist",
            },
            type: "String",
            required: true,
            autocomplete: true,
        },
    ],
}, async (interaction, app) => {
    if (!interaction.guildId) {
        return interaction.reply({ content: defaultAudioCommandCopy.playlist.serverOnly, flags: MessageFlags.Ephemeral });
    }
    if (!await requireTextReplyPermissions(interaction)) return;

    const copy = await getAudioCommandCopy(interaction.guildId);
    const playlistId = interaction.options.getString("type", true);
    const playlist = getAudioPlaylist(playlistId);
    if (!playlist) {
        return interaction.reply({ content: copy.playlist.notFound, flags: MessageFlags.Ephemeral });
    }

    if (playlist.tracks.length === 0) {
        return interaction.reply({ content: copy.playlist.empty, flags: MessageFlags.Ephemeral });
    }

    if (!app.audio) {
        return interaction.reply({ content: copy.playlist.playerNotReady, flags: MessageFlags.Ephemeral });
    }

    const voiceChannelId = await requirePlayableVoice(interaction, app);
    if (!voiceChannelId) return;

    const state = await app.audio.getQueue(interaction.guildId);
    const availableSlots = getAudioQueueAvailableSlots(state);
    if (availableSlots <= 0) {
        return interaction.reply({ content: copy.playlist.fullQueue, flags: MessageFlags.Ephemeral });
    }

    if (!await requireComponentReplyPermissions(interaction)) return;

    return interaction.reply({
        components: [buildPlaylistPanel(playlist, interaction.guildId, interaction.user.id, copy, availableSlots)],
        flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
    });
}, async (interaction) => {
    const focused = String(interaction.options.getFocused());
    const choices = searchAudioPlaylists(focused).map(playlist => ({
        name: truncate(playlist.description ? `${playlist.name} - ${playlist.description}` : playlist.name, 100),
        value: playlist.id,
    }));
    await interaction.respond(choices);
});
