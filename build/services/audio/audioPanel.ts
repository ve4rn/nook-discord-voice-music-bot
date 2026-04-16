import { ButtonBuilder, ButtonStyle } from "discord.js";
import { NookBuilder } from "../../config/NookBuilder.js";
import { getAudioCommandCopy } from "./audioCommandCache.js";
import { formatDuration, formatProgress, formatTrackSummary, getStoredTrackKey } from "./types.js";
import type { AudioCommandCopy, StoredTrack } from "./types.js";

export type AudioPanelState = {
    current: StoredTrack | null;
    queue: StoredTrack[];
    isPaused: boolean;
    isPlaying: boolean;
    positionMs: number;
    loop: boolean;
};

function formatQueueItem(track: StoredTrack, index: number, copy: AudioCommandCopy, current = false, positionMs = 0) {
    const author = track.author?.trim() || copy.panel.unknownAuthor;
    const marker = current ? "<:play:1493770440110505994>" : "-";
    const duration = current
        ? formatProgress(positionMs, track.duration, copy)
        : formatDuration(track.duration, copy);
    return `${marker} **${index + 1}.** ${track.title}\n> ${author} - ${duration}`;
}

function getDisplayedQueueSize(state: AudioPanelState) {
    return state.queue.length + (state.current ? 1 : 0);
}

function getQueueLabel(state: AudioPanelState, copy: AudioCommandCopy) {
    const count = getDisplayedQueueSize(state);
    return copy.panel.trackLabel(count);
}

function canShuffleQueue(state: AudioPanelState) {
    return Boolean(state.current && state.queue.length >= 4);
}

export async function buildAudioPanel(state: AudioPanelState, guildId: string) {
    const copy = await getAudioCommandCopy(guildId);
    const count = getDisplayedQueueSize(state);
    let displayIndex = 0;

    const panel = new NookBuilder()
        .addTextDisplayComponents(td =>
            td.setContent(`${copy.panel.queueTitle(count, getQueueLabel(state, copy))}${count ? "" : `\n${copy.emptyQueue}`}`),
        );

    if (state.current) {
        panel.addTextDisplayComponents(td =>
            td.setContent(formatQueueItem(state.current!, displayIndex++, copy, true, state.positionMs)),
        );
    }

    state.queue.forEach((track, index) => {
        const renderedIndex = displayIndex++;
        panel.addSectionComponents(section =>
            section
                .addTextDisplayComponents(td =>
                    td.setContent(formatQueueItem(track, renderedIndex, copy)),
                )
                .setButtonAccessory(button =>
                    button
                        .setCustomId(`audio:remove:${guildId}:${index}:${getStoredTrackKey(track)}`)
                        .setEmoji({ name: "cross", id: "1493770274607337573" })
                        .setStyle(ButtonStyle.Danger),
                ),
        );
    });

    return panel.addActionRowComponents(row =>
        row.addComponents(
            new ButtonBuilder()
                .setCustomId(`audio:toggle:${guildId}`)
                .setEmoji({ name: state.isPaused ? "play" : "pause", id: state.isPaused ? "1493770440110505994" : "1493770394883063909" })
                .setStyle(state.isPaused ? ButtonStyle.Success : ButtonStyle.Secondary)
                .setDisabled(!state.current),
            new ButtonBuilder()
                .setCustomId(`audio:skip:${guildId}`)
                .setEmoji({ name: "skip", id: "1493770527389515957" })
                .setStyle(ButtonStyle.Primary)
                .setDisabled(!state.current),
            new ButtonBuilder()
                .setCustomId(`audio:loop:${guildId}`)
                .setEmoji({ name: "loop", id: "1493770327287922708" })
                .setStyle(state.loop ? ButtonStyle.Success : ButtonStyle.Danger),
            new ButtonBuilder()
                .setCustomId(`audio:shuffle:${guildId}`)
                .setEmoji({ name: "shuffle", id: "1493770487598153778" })
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(!canShuffleQueue(state)),
        ),
    );
}

export async function buildTrackNoticePanel(track: StoredTrack, queued: boolean, guildId: string) {
    const copy = await getAudioCommandCopy(guildId);

    return new NookBuilder()
        .addTextDisplayComponents(td =>
            td.setContent(`${queued ? copy.panel.queuedTitle : copy.panel.playingTitle}\n${formatTrackSummary(track, copy)}`),
        );
}
