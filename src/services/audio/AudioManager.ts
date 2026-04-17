import { LavalinkManager, type Player, type Track } from "lavalink-client";
import { ChannelType, MessageFlags, type TextChannel, type VoiceBasedChannel, type VoiceState } from "discord.js";
import type App from "../../config/App.js";
import { NookBuilder } from "../../config/NookBuilder.js";
import { checkCanSendComponents } from "../../config/PermissionChecks.js";
import { AudioStateRepository } from "./AudioStateRepository.js";
import { TrackSearchService } from "./TrackSearchService.js";
import { getAudioCommandCopy } from "./audioCommandCache.js";
import { getAudioQueueAvailableSlots, getStoredTrackKey, MAX_AUDIO_QUEUE_SIZE, StoredTrack, trackToStored } from "./types.js";
import type { PlaylistTrackConfig } from "./playlists.js";

type PlayRequest = {
    guildId: string;
    voiceChannelId: string;
    textChannelId: string;
    query: string;
    requestedBy: string;
};

type PlaylistAddRequest = {
    guildId: string;
    voiceChannelId: string;
    textChannelId: string;
    requestedBy: string;
    tracks: PlaylistTrackConfig[];
};

const LAVALINK_PLAY_RETRIES = 1;
const LAVALINK_PLAY_RETRY_DELAY_MS = 750;

export class AudioManager {
    readonly lavalink: LavalinkManager;
    readonly search: TrackSearchService;
    private readonly repository = new AudioStateRepository();
    private readonly lastPositionSync = new Map<string, number>();
    private readonly skipVotes = new Map<string, { trackKey: string; votes: Set<string> }>();
    private readonly emptyDisconnectTimers = new Map<string, NodeJS.Timeout>();
    private readonly expectedVoiceDisconnects = new Map<string, number>();
    private readonly EMPTY_DISCONNECT_MS = 5 * 60 * 1000;

    constructor(private readonly app: App) {
        this.lavalink = new LavalinkManager({
            nodes: [
                {
                    id: "main",
                    host: process.env.LAVALINK_HOST ?? "localhost",
                    port: Number(process.env.LAVALINK_PORT ?? 2333),
                    authorization: process.env.LAVALINK_PASSWORD ?? "youshallnotpass",
                    secure: process.env.LAVALINK_SECURE === "true",
                },
            ],
            sendToShard: (guildId, payload) => {
                this.app.guilds.cache.get(guildId)?.shard?.send(payload);
            },
            autoSkip: true,
            autoMove: true,
            playerOptions: {
                defaultSearchPlatform: "ytsearch",
                onDisconnect: {
                    autoReconnect: true,
                    destroyPlayer: false,
                },
                onEmptyQueue: {
                    destroyAfterMs: undefined,
                },
                useUnresolvedData: true,
            },
            queueOptions: {
                maxPreviousTracks: 10,
            },
            advancedOptions: {
                debugOptions: {
                    playerDestroy: {
                        dontThrowError: true,
                    },
                },
            },
        });

        this.search = new TrackSearchService(this.lavalink);
        this.bindEvents();
    }

    async init(id: string, username: string) {
        if (this.lavalink.initiated) return;
        await this.lavalink.init({ id, username });
    }

    async sendRaw(payload: unknown) {
        if (!this.lavalink.initiated) return;
        await this.lavalink.sendRawData(payload as any);
    }

    async restoreStates() {
        const states = await this.repository.listActive();
        await Promise.all(states.map(state => this.repository.markStoppedKeepQueue(state.guildId)));
    }

    async join(guildId: string, voiceChannelId: string, textChannelId: string) {
        const state = await this.repository.getOrCreate(guildId);
        const player = this.lavalink.createPlayer({
            guildId,
            voiceChannelId,
            textChannelId,
            volume: state.volume ?? 80,
            selfDeaf: true,
            selfMute: false,
        });
        player.textChannelId = textChannelId;
        await player.setRepeatMode(state.loop ? "queue" : "off").catch(() => null);
        if (!player.connected) await player.connect();
        await this.repository.setChannels(guildId, voiceChannelId, textChannelId);
        return player;
    }

    getPlayerVoiceChannelId(guildId: string) {
        return this.lavalink.getPlayer(guildId)?.voiceChannelId ?? null;
    }

    isUserInPlayerVoice(guildId: string, userVoiceChannelId: string | null | undefined) {
        const playerVoiceChannelId = this.getPlayerVoiceChannelId(guildId);
        if (!playerVoiceChannelId) return true;
        return !!userVoiceChannelId && userVoiceChannelId === playerVoiceChannelId;
    }

    async leave(guildId: string) {
        const player = this.lavalink.getPlayer(guildId);
        if (player) {
            this.markExpectedVoiceDisconnect(guildId);
            await player.destroy("leave command", true).catch(() => null);
        }
        await this.repository.reset(guildId);
    }

    async handleBotVoiceStateUpdate(oldState: VoiceState, newState: VoiceState) {
        if (!this.app.user || oldState.id !== this.app.user.id) return;
        if (!oldState.channelId || newState.channelId) return;

        const guildId = oldState.guild.id;
        if (this.consumeExpectedVoiceDisconnect(guildId)) return;

        const state = await this.repository.getOrCreate(guildId);
        const textChannelId = this.lavalink.getPlayer(guildId)?.textChannelId ?? state.textChannelId;
        const player = this.lavalink.getPlayer(guildId);
        if (player) {
            await player.destroy("bot removed from voice channel", true).catch(() => null);
        }

        this.clearEmptyDisconnectTimer(guildId);
        this.skipVotes.delete(guildId);
        await this.repository.reset(guildId);
        await this.sendVoiceDisconnectedNotice(guildId, textChannelId);
    }

    async play(request: PlayRequest) {
        if (!this.lavalink.useable) {
            throw new Error("LAVALINK_NOT_READY");
        }

        const choice = await this.search.resolve(request.query, request.requestedBy);
        if (!choice?.lavalinkTrack) {
            throw new Error("TRACK_NOT_FOUND");
        }

        this.clearEmptyDisconnectTimer(request.guildId);
        const player = await this.join(request.guildId, request.voiceChannelId, request.textChannelId);
        const shouldQueue = player.playing || player.paused || !!player.queue.current;

        if (shouldQueue) {
            await this.repository.enqueue(request.guildId, choice.track);
            player.queue.add(choice.lavalinkTrack);
            return { queued: true, track: choice.track };
        }

        player.queue.add(choice.lavalinkTrack);
        await this.repository.setCurrent(request.guildId, choice.track);
        try {
            await this.playWithRetry(player, request.guildId, "play command");
        } catch (error) {
            await this.rollbackFailedPlayback(request.guildId, player);
            throw error;
        }
        return { queued: false, track: choice.track };
    }

    async addPlaylistTracks(request: PlaylistAddRequest) {
        if (!this.lavalink.useable) {
            throw new Error("LAVALINK_NOT_READY");
        }

        const state = await this.getQueue(request.guildId);
        const availableSlots = getAudioQueueAvailableSlots(state);
        if (availableSlots <= 0) throw new Error("QUEUE_LIMIT_REACHED");

        const requestedTracks = request.tracks.slice(0, availableSlots);
        const player = await this.join(request.guildId, request.voiceChannelId, request.textChannelId);
        const resolvedTracks = await this.resolvePlaylistTracks(player, requestedTracks, request.requestedBy);
        if (resolvedTracks.length === 0) throw new Error("TRACK_NOT_FOUND");

        this.clearEmptyDisconnectTimer(request.guildId);
        const shouldQueue = player.playing || player.paused || !!player.queue.current;

        if (!shouldQueue) {
            const firstTrack = resolvedTracks[0];
            player.queue.add(firstTrack);
            await this.repository.setCurrent(request.guildId, trackToStored(firstTrack, request.requestedBy));
            try {
                await this.playWithRetry(player, request.guildId, "playlist");
            } catch (error) {
                await this.rollbackFailedPlayback(request.guildId, player);
                throw error;
            }
        }

        const tracksToQueue = shouldQueue ? resolvedTracks : resolvedTracks.slice(1);
        for (const track of tracksToQueue) {
            await this.repository.enqueue(request.guildId, trackToStored(track, request.requestedBy));
            player.queue.add(track);
        }

        return {
            added: resolvedTracks.map(track => trackToStored(track, request.requestedBy)),
            requested: request.tracks.length,
        };
    }

    async pauseToggle(guildId: string) {
        const player = this.lavalink.getPlayer(guildId);
        if (!player) return null;

        if (player.paused) {
            await player.resume();
            await this.repository.setPaused(guildId, false, player.position);
            return false;
        }

        await player.pause();
        await this.repository.setPaused(guildId, true, player.position);
        return true;
    }

    async voteSkip(guildId: string, userId: string) {
        const player = this.lavalink.getPlayer(guildId);
        if (!player?.queue.current) return { skipped: false, votes: 0, needed: 0, listeners: 0 };

        const listeners = this.getNonBotListenerIds(guildId, player.voiceChannelId);
        const needed = Math.max(1, Math.floor(listeners.length / 2) + 1);
        const trackKey = this.getCurrentTrackKey(player.queue.current);
        const currentVote = this.skipVotes.get(guildId);
        const vote = currentVote?.trackKey === trackKey
            ? currentVote
            : { trackKey, votes: new Set<string>() };

        vote.votes.add(userId);
        this.skipVotes.set(guildId, vote);

        if (listeners.length <= 1 || vote.votes.size >= needed) {
            this.skipVotes.delete(guildId);
            const result = await this.skip(guildId);
            return { skipped: result.skipped, reason: result.reason, votes: vote.votes.size, needed, listeners: listeners.length };
        }

        return { skipped: false, votes: vote.votes.size, needed, listeners: listeners.length };
    }

    async removeQueuedTrack(guildId: string, queueIndex: number, userId: string, expectedKey?: string) {
        if (!Number.isInteger(queueIndex) || queueIndex < 0 || queueIndex >= MAX_AUDIO_QUEUE_SIZE) {
            return { removed: false, reason: "missing" as const };
        }

        const player = this.lavalink.getPlayer(guildId);
        if (player) {
            const track = player.queue.tracks[queueIndex] as Track | undefined;
            if (!track) return { removed: false, reason: "missing" as const };

            const stored = trackToStored(track, (track.requester as { id?: string } | undefined)?.id ?? "unknown");
            if (expectedKey && getStoredTrackKey(stored) !== expectedKey) return { removed: false, reason: "missing" as const };
            if (stored.requestedBy !== userId) return { removed: false, reason: "forbidden" as const };

            await player.queue.splice(queueIndex, 1);
            await this.repository.removeQueuedTrack(guildId, queueIndex, stored.encoded);
            return { removed: true as const, track: stored };
        }

        const state = await this.repository.getOrCreate(guildId);
        const track = this.repository.getQueueFromState(state)[queueIndex];
        if (!track) return { removed: false, reason: "missing" as const };
        if (expectedKey && getStoredTrackKey(track) !== expectedKey) return { removed: false, reason: "missing" as const };
        if (track.requestedBy !== userId) return { removed: false, reason: "forbidden" as const };

        await this.repository.removeQueuedTrack(guildId, queueIndex, track.encoded);
        return { removed: true as const, track };
    }

    async shuffleQueue(guildId: string) {
        const player = this.lavalink.getPlayer(guildId);
        if (player) {
            const displayedCount = player.queue.tracks.length + (player.queue.current ? 1 : 0);
            if (!player.queue.current || displayedCount < 5 || player.queue.tracks.length < 4) {
                return { shuffled: false as const, reason: "too_small" as const };
            }

            const tracks = [...player.queue.tracks] as Track[];
            const shuffledTracks = this.shuffleTracks(tracks);
            await player.queue.splice(0, player.queue.tracks.length, shuffledTracks);
            await this.repository.replaceQueue(
                guildId,
                shuffledTracks.map(track => trackToStored(track, (track.requester as { id?: string } | undefined)?.id ?? "unknown")),
            );
            return { shuffled: true as const };
        }

        const state = await this.repository.getOrCreate(guildId);
        const displayedCount = state.queue.length + (state.currentTrack ? 1 : 0);
        if (!state.currentTrack || displayedCount < 5 || state.queue.length < 4) {
            return { shuffled: false as const, reason: "too_small" as const };
        }

        const shuffledQueue = this.shuffleTracks(this.repository.getQueueFromState(state));
        await this.repository.replaceQueue(guildId, shuffledQueue);
        return { shuffled: true as const };
    }

    private async skip(guildId: string) {
        const player = this.lavalink.getPlayer(guildId);
        if (!player) return { skipped: false as const, reason: "no_player" as const };

        const state = await this.repository.getOrCreate(guildId);
        const loop = state.loop ?? false;
        const queue = this.repository.getQueueFromState(state);

        if (player.queue.tracks.length === 0) {
            await player.stopPlaying(true).catch(() => null);
            await this.repository.markStoppedKeepQueue(guildId);
            return { skipped: false as const, reason: "no_next" as const };
        }

        if (!loop) this.clearPreviousTracks(player);
        try {
            await player.skip();
        } catch (error) {
            if (error instanceof RangeError) {
                await player.stopPlaying(true).catch(() => null);
                await this.repository.markStoppedKeepQueue(guildId);
                return { skipped: false as const, reason: "no_next" as const };
            }
            throw error;
        }
        if (!loop) this.clearPreviousTracks(player);
        return { skipped: true as const };
    }

    async toggleLoop(guildId: string) {
        const state = await this.repository.getOrCreate(guildId);
        const loop = !(state.loop ?? false);
        await this.repository.setLoop(guildId, loop);
        const player = this.lavalink.getPlayer(guildId);
        await player?.setRepeatMode(loop ? "queue" : "off").catch(() => null);
        if (!loop && player) this.clearPreviousTracks(player);
        return loop;
    }

    async getQueue(guildId: string) {
        const state = await this.repository.getOrCreate(guildId);
        const player = this.lavalink.getPlayer(guildId);
        const current = player?.queue.current
            ? trackToStored(player.queue.current, (player.queue.current.requester as { id?: string } | undefined)?.id ?? "unknown")
            : this.repository.getCurrentFromState(state);
        const queue = player
            ? player.queue.tracks.map(track => trackToStored(track as Track, ((track as Track).requester as { id?: string } | undefined)?.id ?? "unknown")).slice(0, MAX_AUDIO_QUEUE_SIZE)
            : this.repository.getQueueFromState(state).slice(0, MAX_AUDIO_QUEUE_SIZE);
        const positionMs = player ? player.position : state.positionMs;

        return {
            current,
            queue,
            isPaused: player ? player.paused : state.isPaused,
            isPlaying: player ? player.playing || !!player.queue.current : state.isPlaying,
            positionMs,
            loop: player ? player.repeatMode === "queue" : state.loop ?? false,
        };
    }

    private bindEvents() {
        this.lavalink.on("trackStart", (player, track) => {
            this.clearEmptyDisconnectTimer(player.guildId);
            this.skipVotes.delete(player.guildId);
            void this.onTrackStart(player.guildId, track).catch(error => {
                console.error(`[Audio] trackStart state sync failed for guild ${player.guildId}`, error);
            });
        });
        this.lavalink.on("trackEnd", (player) => {
            if (player.repeatMode !== "queue") this.clearPreviousTracks(player);
        });
        this.lavalink.on("queueEnd", (player) => {
            if (player.repeatMode !== "queue") {
                this.clearPreviousTracks(player);
                void this.scheduleEmptyDisconnect(player.guildId, player.textChannelId);
                void this.repository.markStoppedKeepQueue(player.guildId);
            }
        });
        this.lavalink.on("playerDestroy", (player) => {
            this.clearEmptyDisconnectTimer(player.guildId);
            this.skipVotes.delete(player.guildId);
            void this.repository.markStoppedKeepQueue(player.guildId);
        });
        this.lavalink.on("playerUpdate", (_oldPlayer, player) => {
            void this.syncPosition(player.guildId, player.position);
        });
        this.lavalink.on("playerClientUpdate", (_oldPlayer, player) => {
            void this.syncPosition(player.guildId, player.position);
        });
        this.lavalink.nodeManager.on("error", (node, error) => {
            console.error(`[Lavalink] Node ${node.id} error:`, error);
        });
    }

    private async onTrackStart(guildId: string, track: Track | null) {
        if (!track) {
            await this.repository.markStoppedKeepQueue(guildId);
            return;
        }

        const requester = (track.requester as { id?: string } | undefined)?.id ?? "unknown";
        const stored: StoredTrack = trackToStored(track, requester);
        await this.repository.removeQueuedByEncoded(guildId, track.encoded);
        await this.repository.setCurrent(guildId, stored);
    }

    private async syncPosition(guildId: string, positionMs: number) {
        const now = Date.now();
        const last = this.lastPositionSync.get(guildId) ?? 0;
        if (now - last < 5000) return;
        this.lastPositionSync.set(guildId, now);
        await this.repository.setPosition(guildId, positionMs).catch(() => null);
    }

    private clearPreviousTracks(player: { queue?: { previous?: unknown[] } }) {
        if (Array.isArray(player.queue?.previous)) {
            player.queue.previous.splice(0, player.queue.previous.length);
        }
    }

    private getCurrentTrackKey(track: Track) {
        return track.encoded ?? track.info.identifier ?? track.info.uri ?? track.info.title;
    }

    private shuffleTracks<T>(tracks: T[]) {
        const shuffled = [...tracks];
        for (let index = shuffled.length - 1; index > 0; index--) {
            const randomIndex = Math.floor(Math.random() * (index + 1));
            [shuffled[index], shuffled[randomIndex]] = [shuffled[randomIndex], shuffled[index]];
        }
        return shuffled;
    }

    private isTimeoutError(error: unknown) {
        const typed = error as { name?: string; message?: string };
        const message = typed?.message?.toLowerCase() ?? "";
        return typed?.name === "TimeoutError"
            || message.includes("operation was aborted due to timeout")
            || message.includes("timeout");
    }

    private async playWithRetry(player: Player, guildId: string, context: string) {
        for (let attempt = 0; attempt <= LAVALINK_PLAY_RETRIES; attempt++) {
            try {
                await player.play();
                return;
            } catch (error) {
                if (!this.isTimeoutError(error)) throw error;

                console.warn(`[Audio] Lavalink play timeout for guild ${guildId} (${context}), attempt ${attempt + 1}/${LAVALINK_PLAY_RETRIES + 1}.`);
                if (attempt >= LAVALINK_PLAY_RETRIES) throw new Error("LAVALINK_TIMEOUT");

                await this.sleep(LAVALINK_PLAY_RETRY_DELAY_MS);
                const currentPlayer = this.lavalink.getPlayer(guildId);
                if (currentPlayer?.playing) return;
            }
        }
    }

    private async rollbackFailedPlayback(guildId: string, player: Player) {
        await player.stopPlaying(true).catch(() => null);
        await this.repository.markStoppedKeepQueue(guildId).catch(() => null);
    }

    private sleep(ms: number) {
        return new Promise<void>(resolve => {
            const timer = setTimeout(resolve, ms);
            timer.unref?.();
        });
    }

    private async resolvePlaylistTracks(player: Player, tracks: PlaylistTrackConfig[], requestedBy: string) {
        const resolved: Track[] = [];
        for (const track of tracks) {
            const lavalinkTrack = await this.resolvePlaylistTrack(player, track, requestedBy);
            if (lavalinkTrack) resolved.push(lavalinkTrack);
        }
        return resolved;
    }

    private async resolvePlaylistTrack(player: Player, track: PlaylistTrackConfig, requestedBy: string) {
        if (track.encoded) {
            const decoded = await player.node.decode.singleTrack(track.encoded, { id: requestedBy }).catch(() => null);
            if (decoded) return decoded;
        }

        const query = track.query ?? track.url ?? track.identifier;
        if (!query) return null;

        const choice = await this.search.resolve(query, requestedBy);
        return choice?.lavalinkTrack ?? null;
    }

    private getNonBotListenerIds(guildId: string, voiceChannelId: string | null) {
        if (!voiceChannelId) return [];
        const guild = this.app.guilds.cache.get(guildId);
        const channel = guild?.channels.cache.get(voiceChannelId);
        if (!channel || (channel.type !== ChannelType.GuildVoice && channel.type !== ChannelType.GuildStageVoice)) return [];
        return Array.from((channel as VoiceBasedChannel).members.values())
            .filter(member => !member.user.bot)
            .map(member => member.id);
    }

    private scheduleEmptyDisconnect(guildId: string, textChannelId: string | null) {
        this.clearEmptyDisconnectTimer(guildId);
        const timer = setTimeout(() => {
            void this.disconnectAfterEmpty(guildId, textChannelId);
        }, this.EMPTY_DISCONNECT_MS);
        timer.unref?.();
        this.emptyDisconnectTimers.set(guildId, timer);
    }

    private clearEmptyDisconnectTimer(guildId: string) {
        const timer = this.emptyDisconnectTimers.get(guildId);
        if (timer) clearTimeout(timer);
        this.emptyDisconnectTimers.delete(guildId);
    }

    private async disconnectAfterEmpty(guildId: string, textChannelId: string | null) {
        this.emptyDisconnectTimers.delete(guildId);
        const player = this.lavalink.getPlayer(guildId);
        if (!player || player.queue.current || player.queue.tracks.length > 0) return;

        if (textChannelId) {
            const channel = await this.app.channels.fetch(textChannelId).catch(() => null);
            if (channel && "send" in channel) {
                const copy = await getAudioCommandCopy(guildId);
                await (channel as TextChannel).send(copy.session.emptyDisconnect).catch(() => null);
            }
        }

        this.markExpectedVoiceDisconnect(guildId);
        await player.destroy("empty queue timeout", true).catch(() => null);
        await this.repository.markStoppedKeepQueue(guildId);
    }

    private markExpectedVoiceDisconnect(guildId: string) {
        this.expectedVoiceDisconnects.set(guildId, Date.now() + 15_000);
    }

    private consumeExpectedVoiceDisconnect(guildId: string) {
        const expiresAt = this.expectedVoiceDisconnects.get(guildId);
        if (!expiresAt) return false;

        this.expectedVoiceDisconnects.delete(guildId);
        return expiresAt > Date.now();
    }

    private async sendVoiceDisconnectedNotice(guildId: string, textChannelId: string | null | undefined) {
        if (!textChannelId) return;

        const channel = await this.app.channels.fetch(textChannelId).catch(() => null);
        if (!channel || !("send" in channel)) return;

        const copy = await getAudioCommandCopy(guildId);
        if (!checkCanSendComponents(channel as TextChannel).ok) {
            await (channel as TextChannel).send(`${copy.session.voiceDisconnectedTitle}\n${copy.session.voiceDisconnectedDescription}`).catch(() => null);
            return;
        }

        const panel = new NookBuilder()
            .addTextDisplayComponents(text =>
                text.setContent(`## ${copy.session.voiceDisconnectedTitle}\n${copy.session.voiceDisconnectedDescription}`),
            );

        await (channel as TextChannel).send({
            components: [panel],
            flags: MessageFlags.IsComponentsV2,
        }).catch(() => null);
    }
}
