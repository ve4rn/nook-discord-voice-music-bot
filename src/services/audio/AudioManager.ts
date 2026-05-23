import { LavalinkManager, type Player, type Track } from "lavalink-client";
import { ChannelType, MessageFlags, type GuildMember, type TextChannel, type VoiceBasedChannel, type VoiceState } from "discord.js";
import type App from "../../config/App.js";
import { NO_PING_ALLOWED_MENTIONS } from "../../config/DiscordMentions.js";
import { getGuildMessages } from "../../config/i18n.js";
import { checkCanSendComponents, checkCanSendText, findFirstPublicWritableTextChannel, formatDiscordPermissionInline, type PermissionKey } from "../../config/PermissionChecks.js";
import { env } from "../../config/env.js";
import { LavalinkNotReadyError, QueueLimitReachedError, TrackNotFoundError } from "../../domain/errors/index.js";
import { AudioStateRepository } from "../../repositories/AudioStateRepository.js";
import {
  PLAYLIST_LAUNCH_LIMIT,
  getAudioQueueAvailableSlots,
  type PlaybackContext,
  type QueueSnapshot,
  type StoredTrack,
  type TrackRequest,
  trackToStored,
} from "../../types/audio.js";
import { AudioPlaybackService } from "./AudioPlaybackService.js";
import { buildLetsPlayPanel, buildNeutralNoticePanel } from "./audioPanel.js";
import { AudioQueueService, type VoteState } from "./AudioQueueService.js";
import { formatSlashCommandMention } from "./commandMentions.js";
import { AudioEnergySaving } from "./energySaving.js";
import { MusicStatsService } from "./MusicStatsService.js";
import { TrackSearchService } from "./TrackSearchService.js";
import type { PlaylistTrackConfig } from "./playlists.js";
import { getDefaultEmojiMention } from "../../config/DiscordEmojis.js";
type PlaylistAddRequest = PlaybackContext & {
  tracks: PlaylistTrackConfig[];
};

type SessionEndReason = "requested" | "afk_timeout" | "manual_disconnect";

type SessionCacheEntry = {
  startedAt: number;
  tracksPlayed: number;
  lastActiveTextChannelId: string | null;
  afk: boolean;
  endedReason?: SessionEndReason;
};

type PendingResumePanelEntry = {
  guildId: string;
  userId: string;
  voiceChannelId: string;
  alerted: boolean;
};

export class AudioManager {
  readonly lavalink: LavalinkManager;
  readonly search: TrackSearchService;
  private readonly playbackService = new AudioPlaybackService();
  private readonly queueService = new AudioQueueService();
  private readonly repository = new AudioStateRepository();
  private readonly lastPositionSync = new Map<string, number>();
  private readonly skipVotes = new Map<string, VoteState>();
  private readonly previousVotes = new Map<string, VoteState>();
  private readonly noListenerTimers = new Map<string, NodeJS.Timeout>();
  private readonly disconnectTimers = new Map<string, NodeJS.Timeout>();
  private readonly expectedVoiceDisconnects = new Map<string, number>();
  private readonly resumePanelCooldowns = new Map<string, number>();
  private readonly sessionCache = new Map<string, SessionCacheEntry>();
  private readonly sessionFinalizationCooldowns = new Map<string, number>();
  private readonly pendingResumePanels = new Map<string, PendingResumePanelEntry>();
  private readonly NO_LISTENERS_STOP_MS = 0;
  private readonly DISCONNECT_AFTER_STOP_MS = 3 * 60 * 1000;
  private readonly RESUME_REWIND_MS = 5_000;
  private readonly VOICE_STATUS_PREFIX = getDefaultEmojiMention("nook");
  private readonly VOICE_STATUS_MAX_LENGTH = 120;
  private readonly energySaving: AudioEnergySaving;
  private readonly musicStats = new MusicStatsService();

  constructor(private readonly app: App) {
    this.lavalink = new LavalinkManager({
      nodes: [
        {
          id: "main",
          host: env.lavalink.host,
          port: env.lavalink.port,
          authorization: env.lavalink.password,
          secure: env.lavalink.secure,
        },
      ],
      sendToShard: (guildId, payload) => {
        this.app.guilds.cache.get(guildId)?.shard?.send(payload);
      },
      autoSkip: true,
      autoMove: true,
      playerOptions: {
        defaultSearchPlatform: "spsearch",
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
        maxPreviousTracks: 25,
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
    this.energySaving = new AudioEnergySaving(this.app, {
      getPlayer: guildId => this.lavalink.getPlayer(guildId) ?? null,
      getNonBotListenerIds: (guildId, voiceChannelId) => this.getNonBotListenerIds(guildId, voiceChannelId),
      onTimeout: async (guildId, textChannelId) => {
        await this.finalizeSession(guildId, "afk_timeout", {
          textChannelId,
          destroyPlayer: true,
          cleanupState: false,
        });
      },
    });
    this.bindEvents();
  }

  async init(id: string, username: string) {
    await this.musicStats.init();
    if (this.lavalink.initiated) return;
    await this.lavalink.init({ id, username });
  }

  async sendRaw(payload: unknown) {
    if (!this.lavalink.initiated) return;
    await this.lavalink.sendRawData(payload as Parameters<LavalinkManager["sendRawData"]>[0]);
  }

  async restoreStates() {
    const states = await this.repository.listActive();
    await Promise.all(states.map(async state => {
      await this.repository.markStoppedKeepQueue(state.guildId, state.positionMs);
      await this.repository.setDisconnected(state.guildId);
    }));
  }

  getMusicStatsBufferHealth() {
    return this.musicStats.getBufferHealthSnapshot();
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
    await player.setRepeatMode("queue").catch(() => null);
    if (!player.connected) await player.connect();
    await this.repository.setChannels(guildId, voiceChannelId, textChannelId, state.currentTrackId || state.queue.length ? "stopped" : "active");
    return player;
  }

  getPlayerVoiceChannelId(guildId: string) {
    return this.lavalink.getPlayer(guildId)?.voiceChannelId ?? null;
  }

  async resumeSession(guildId: string, voiceChannelId: string, textChannelId: string) {
    const state = await this.repository.getOrCreate(guildId);
    const currentStored = this.repository.getCurrentFromState(state);
    if (!currentStored) return false;
    const resumePosition = this.rewindPosition(state.positionMs);

    const player = await this.join(guildId, voiceChannelId, textChannelId);
    this.clearStopTimers(guildId);

    if (player.queue.current) {
      await player.seek(resumePosition).catch(() => null);
      if (player.paused) await player.resume().catch(() => null);
      await this.repository.setSessionState(guildId, "active", resumePosition);
      this.ensureSessionCache(guildId, textChannelId).afk = false;
      await this.musicStats.resumeTrack({
        guildId,
        track: trackToStored(player.queue.current, (player.queue.current.requester as { id?: string } | undefined)?.id ?? currentStored.requestedBy),
      });
      await this.syncVoiceChannelStatus(player.voiceChannelId, player.queue.current);
      this.energySaving.refresh(guildId, player.voiceChannelId, textChannelId);
      this.pendingResumePanels.delete(guildId);
      return true;
    }

    const current = await this.resolveStoredTrack(player, currentStored);
    if (!current) throw new TrackNotFoundError();

    const queue = await this.resolveStoredTracks(player, this.repository.getQueueFromState(state));
    await player.stopPlaying(true).catch(() => null);
    await player.queue.splice(0, player.queue.tracks.length).catch(() => null);
    player.queue.add(current);
    if (queue.length > 0) player.queue.add(queue);
    await this.repository.setChannels(guildId, voiceChannelId, textChannelId, "active");
    await this.repository.setSessionState(guildId, "active", resumePosition);
    this.musicStats.markNextTrackStartAsResume(guildId);
    try {
      await this.playbackService.playWithRetry(player, guildId, "resume session", () => Boolean(this.lavalink.getPlayer(guildId)?.playing));
    } catch (error) {
      this.musicStats.clearNextTrackStartMarker(guildId);
      throw error;
    }
    await player.seek(resumePosition).catch(() => null);
    this.ensureSessionCache(guildId, textChannelId).afk = false;
    this.energySaving.refresh(guildId, voiceChannelId, textChannelId);
    this.pendingResumePanels.delete(guildId);
    return true;
  }

  async leave(guildId: string) {
    await this.stop(guildId);
  }

  async stop(guildId: string, requestedBy?: string) {
    const player = this.lavalink.getPlayer(guildId);
    this.clearStopTimers(guildId);
    this.energySaving.clear(guildId);
    const state = await this.repository.getOrCreate(guildId);
    const textChannelId = player?.textChannelId ?? state.textChannelId ?? state.lastTextChannelId;
    await this.finalizeSession(guildId, "requested", {
      requestedBy,
      textChannelId,
      destroyPlayer: true,
      cleanupState: true,
    });
  }

  async play(request: TrackRequest) {
    if (!this.lavalink.useable) throw new LavalinkNotReadyError();

    const choice = await this.search.resolve(request.query, request.requestedBy);
    if (!choice?.lavalinkTrack) throw new TrackNotFoundError();

    const persisted = await this.repository.getOrCreate(request.guildId);
    const player = await this.join(request.guildId, request.voiceChannelId, request.textChannelId);
    this.clearStopTimers(request.guildId);
    this.ensureSessionCache(request.guildId, request.textChannelId);

    const shouldQueue = persisted.sessionState === "active" && (player.playing || player.paused || !!player.queue.current);

    if (shouldQueue) {
      await this.repository.enqueue(request.guildId, choice.track);
      player.queue.add(choice.lavalinkTrack);
      this.energySaving.refresh(request.guildId, player.voiceChannelId, player.textChannelId ?? request.textChannelId);
      return { queued: true, track: choice.track };
    }

    await this.repository.clearCurrentKeepQueue(request.guildId);
    await player.stopPlaying(true).catch(() => null);
    await player.queue.splice(0, player.queue.tracks.length).catch(() => null);
    player.queue.add(choice.lavalinkTrack);
    await this.repository.setCurrent(request.guildId, choice.track);
    try {
      await this.playbackService.playWithRetry(player, request.guildId, "play command", () => Boolean(this.lavalink.getPlayer(request.guildId)?.playing));
    } catch (error) {
      await this.rollbackFailedPlayback(request.guildId, player);
      throw error;
    }
    this.energySaving.refresh(request.guildId, player.voiceChannelId, player.textChannelId ?? request.textChannelId);
    return { queued: false, track: choice.track };
  }

  async addPlaylistTracks(request: PlaylistAddRequest) {
    if (!this.lavalink.useable) throw new LavalinkNotReadyError();

    const state = await this.getQueue(request.guildId);
    const availableSlots = getAudioQueueAvailableSlots(state);
    if (availableSlots <= 0) throw new QueueLimitReachedError();

    const requestedTracks = request.tracks.slice(0, Math.min(availableSlots, PLAYLIST_LAUNCH_LIMIT));
    const player = await this.join(request.guildId, request.voiceChannelId, request.textChannelId);
    const resolvedTracks = await this.resolvePlaylistTracks(player, requestedTracks, request.requestedBy);
    if (resolvedTracks.length === 0) throw new TrackNotFoundError();

    this.clearStopTimers(request.guildId);
    this.ensureSessionCache(request.guildId, request.textChannelId);
    const persisted = await this.repository.getOrCreate(request.guildId);
    const shouldQueue = persisted.sessionState === "active" && (player.playing || player.paused || !!player.queue.current);

    if (!shouldQueue) {
      const firstTrack = resolvedTracks[0];
      player.queue.add(firstTrack);
      await this.repository.setCurrent(request.guildId, trackToStored(firstTrack, request.requestedBy));
      try {
        await this.playbackService.playWithRetry(player, request.guildId, "playlist", () => Boolean(this.lavalink.getPlayer(request.guildId)?.playing));
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

    this.energySaving.refresh(request.guildId, player.voiceChannelId, player.textChannelId ?? request.textChannelId);

    return {
      added: resolvedTracks.map(track => trackToStored(track, request.requestedBy)),
      requested: request.tracks.length,
    };
  }

  async pauseToggle(guildId: string) {
    const player = this.lavalink.getPlayer(guildId);
    if (!player?.queue.current) return null;

    if (player.paused) {
      await player.resume().catch(() => null);
      await this.repository.setSessionState(guildId, "active", player.position);
      this.ensureSessionCache(guildId, player.textChannelId ?? null).afk = false;
      await this.musicStats.resumeTrack({
        guildId,
        track: trackToStored(player.queue.current, (player.queue.current.requester as { id?: string } | undefined)?.id ?? "unknown"),
      });
      await this.syncVoiceChannelStatus(player.voiceChannelId, player.queue.current);
      this.energySaving.refresh(guildId, player.voiceChannelId, player.textChannelId ?? null);
      return false;
    }

    await player.pause().catch(() => null);
    await this.repository.setPaused(guildId, true, player.position);
    await this.musicStats.pauseTrack(guildId);
    await this.setPausedVoiceChannelStatus(guildId, player.voiceChannelId);
    this.energySaving.clear(guildId);
    return true;
  }

  async confirmListenerPresence(guildId: string, userId: string) {
    return this.energySaving.confirm(guildId, userId);
  }

  async voteSkip(guildId: string, userId: string) {
    const player = this.lavalink.getPlayer(guildId);
    if (!player?.queue.current) return { skipped: false, reason: "no_player" as const, votes: 0, needed: 0, listeners: 0 };
    if (player.queue.tracks.length === 0) return { skipped: false, reason: "no_next" as const, votes: 0, needed: 0, listeners: 0 };

    const listeners = this.getNonBotListenerIds(guildId, player.voiceChannelId);
    const trackKey = this.getCurrentTrackKey(player.queue.current);
    const voteResult = this.queueService.registerVote(this.skipVotes.get(guildId), trackKey, userId, listeners.length);
    this.skipVotes.set(guildId, voteResult.vote);
    this.energySaving.refresh(guildId, player.voiceChannelId, player.textChannelId ?? null);

    if (voteResult.shouldPass) {
      this.skipVotes.delete(guildId);
      await this.musicStats.endTrack(guildId);
      await player.skip().catch(() => null);
      return {
        skipped: true,
        votes: voteResult.vote.votes.size,
        needed: voteResult.needed,
        listeners: voteResult.listeners,
      };
    }

    return { skipped: false, votes: voteResult.vote.votes.size, needed: voteResult.needed, listeners: voteResult.listeners };
  }

  async votePrevious(guildId: string, userId: string) {
    const player = this.lavalink.getPlayer(guildId);
    const state = await this.getQueue(guildId);
    if (!player?.queue.current || !state.previous) {
      return { previous: false, reason: "no_previous" as const, votes: 0, needed: 0, listeners: 0 };
    }

    const listeners = this.getNonBotListenerIds(guildId, player.voiceChannelId);
    const trackKey = this.getCurrentTrackKey(player.queue.current);
    const voteResult = this.queueService.registerVote(this.previousVotes.get(guildId), trackKey, userId, listeners.length);
    this.previousVotes.set(guildId, voteResult.vote);
    this.energySaving.refresh(guildId, player.voiceChannelId, player.textChannelId ?? null);

    if (!voteResult.shouldPass) {
      return { previous: false, votes: voteResult.vote.votes.size, needed: voteResult.needed, listeners: voteResult.listeners };
    }

    this.previousVotes.delete(guildId);
    const previous = await this.resolveStoredTrack(player, state.previous);
    if (!previous) {
      return { previous: false, reason: "no_previous" as const, votes: voteResult.vote.votes.size, needed: voteResult.needed, listeners: voteResult.listeners };
    }

    const currentTrack = player.queue.current as Track;
    const nextQueueTracks = prependLiveTrackOnce(currentTrack, [...player.queue.tracks] as Track[]);
    const nextQueueStored = prependStoredTrackOnce(state.current!, state.queue);

    await this.musicStats.endTrack(guildId);
    await player.stopPlaying(true).catch(() => null);
    await player.queue.splice(0, player.queue.tracks.length).catch(() => null);
    player.queue.add(previous);
    if (nextQueueTracks.length > 0) {
      player.queue.add(nextQueueTracks);
    }
    await this.repository.setCurrent(guildId, state.previous).catch(() => null);
    await this.repository.replaceQueue(guildId, nextQueueStored).catch(() => null);
    await player.play({ clientTrack: previous }).catch(() => null);
    return { previous: true, votes: voteResult.vote.votes.size, needed: voteResult.needed, listeners: voteResult.listeners };
  }

  async shuffleQueue(guildId: string) {
    const player = this.lavalink.getPlayer(guildId);
    if (!player) return { shuffled: false as const, reason: "no_player" as const };
    if (!this.queueService.canShuffleQueue(player.queue.current ? 1 : 0, player.queue.tracks.length)) {
      return { shuffled: false as const, reason: "too_small" as const };
    }

    const tracks = [...player.queue.tracks] as Track[];
    const shuffled = this.queueService.shuffleTracks(tracks);
    await player.queue.splice(0, player.queue.tracks.length, shuffled).catch(() => null);
    await this.repository.replaceQueue(guildId, shuffled.map(track => trackToStored(track, ((track.requester as { id?: string } | undefined)?.id ?? "unknown"))));
    this.energySaving.refresh(guildId, player.voiceChannelId, player.textChannelId ?? null);
    return { shuffled: true as const };
  }

  async getQueue(guildId: string): Promise<QueueSnapshot> {
    const state = await this.repository.getOrCreate(guildId);
    const player = this.lavalink.getPlayer(guildId);
    const current = player?.queue.current
      ? trackToStored(player.queue.current, (player.queue.current.requester as { id?: string } | undefined)?.id ?? "unknown")
      : this.repository.getCurrentFromState(state);
    const queue = player
      ? player.queue.tracks.map(track => trackToStored(track as Track, ((track as Track).requester as { id?: string } | undefined)?.id ?? "unknown"))
      : this.repository.getQueueFromState(state);

    return {
      current,
      previous: this.repository.getPreviousFromState(state),
      queue,
      isPaused: player ? player.paused : state.isPaused,
      isPlaying: player ? player.playing || !!player.queue.current : state.isPlaying,
      positionMs: player ? player.position : state.positionMs,
      sessionState: player?.queue.current ? "active" : (state.sessionState as QueueSnapshot["sessionState"]),
      voiceChannelId: player?.voiceChannelId ?? state.voiceChannelId,
      textChannelId: player?.textChannelId ?? state.textChannelId,
      lastVoiceChannelId: state.lastVoiceChannelId,
      lastTextChannelId: state.lastTextChannelId,
    };
  }

  async handleBotVoiceStateUpdate(oldState: VoiceState, newState: VoiceState) {
    if (!this.app.user || oldState.id !== this.app.user.id) return;
    if (!oldState.channelId || newState.channelId) return;

    const guildId = oldState.guild.id;
    if (this.consumeExpectedVoiceDisconnect(guildId)) return;
    if (this.isSessionFinalizationCoolingDown(guildId)) return;

    const state = await this.repository.getOrCreate(guildId);
    const textChannelId = this.lavalink.getPlayer(guildId)?.textChannelId ?? state.textChannelId ?? state.lastTextChannelId;
    const player = this.lavalink.getPlayer(guildId);
    if (player) {
      await player.destroy("bot removed from voice channel", true).catch(() => null);
    }

    this.clearStopTimers(guildId);
    this.skipVotes.delete(guildId);
    this.previousVotes.delete(guildId);
    await this.finalizeSession(guildId, "manual_disconnect", {
      textChannelId,
      destroyPlayer: false,
      cleanupState: true,
    });
  }

  async handleVoiceStateActivity(oldState: VoiceState, newState: VoiceState) {
    await this.handleBotVoiceStateUpdate(oldState, newState);
    if (newState.member?.user.bot || oldState.member?.user.bot) return;

    const guildId = newState.guild.id;
    const playerVoiceChannelId = this.getPlayerVoiceChannelId(guildId);
    const relevantVoiceChannelId = playerVoiceChannelId
      ?? (await this.repository.getOrCreate(guildId)).lastVoiceChannelId;

    if (!relevantVoiceChannelId) return;

    const joinedTrackedVoice = newState.channelId === relevantVoiceChannelId && oldState.channelId !== relevantVoiceChannelId;
    const leftTrackedVoice = oldState.channelId === relevantVoiceChannelId && newState.channelId !== relevantVoiceChannelId;
    if (!joinedTrackedVoice && !leftTrackedVoice) return;

    if (joinedTrackedVoice) {
      this.clearStopTimers(guildId);
      const state = await this.repository.getOrCreate(guildId);
      const voiceChannelId = newState.channelId;
      if (!voiceChannelId) return;

      if (this.sessionCache.get(guildId)?.afk && state.lastVoiceChannelId === voiceChannelId) {
        const player = this.lavalink.getPlayer(guildId);
        const textChannelId = player?.textChannelId ?? state.lastTextChannelId ?? state.textChannelId;
        if (player?.voiceChannelId === voiceChannelId && textChannelId) {
          await this.resumeSession(guildId, voiceChannelId, textChannelId).catch(() => false);
          return;
        }
      } else if (state.sessionState === "stopped" && state.lastVoiceChannelId === voiceChannelId) {
        await this.publishResumePanel(newState, state.guildId);
      } else if (playerVoiceChannelId === voiceChannelId) {
        this.energySaving.refresh(guildId, voiceChannelId, this.lavalink.getPlayer(guildId)?.textChannelId ?? state.lastTextChannelId ?? state.textChannelId);
      }
      return;
    }

    const listeners = this.getNonBotListenerIds(guildId, relevantVoiceChannelId);
    if (listeners.length === 0) {
      this.scheduleNoListenersStop(guildId, relevantVoiceChannelId);
    }
  }

  async handleChannelPermissionsUpdate(channelId: string, guildId: string) {
    const pending = this.pendingResumePanels.get(guildId);
    if (!pending || pending.voiceChannelId !== channelId) return;
    await this.tryPublishResumePanel(pending.guildId, pending.userId, pending.voiceChannelId, {
      notifyOnPermissionIssue: false,
      ignoreCooldown: true,
    });
  }

  async handleBotGuildMemberPermissionsUpdate(guildId: string) {
    const pending = this.pendingResumePanels.get(guildId);
    if (!pending) return;
    await this.tryPublishResumePanel(pending.guildId, pending.userId, pending.voiceChannelId, {
      notifyOnPermissionIssue: false,
      ignoreCooldown: true,
    });
  }

  private bindEvents() {
    this.lavalink.on("trackStart", (player, track) => {
      this.clearStopTimers(player.guildId);
      this.skipVotes.delete(player.guildId);
      this.previousVotes.delete(player.guildId);
      void this.onTrackStart(player.guildId, player, track).catch(error => {
        console.error(`[Audio] trackStart state sync failed for guild ${player.guildId}`, error);
      });
    });
    this.lavalink.on("queueEnd", player => {
      void this.onQueueEnd(player.guildId).catch(error => {
        console.error(`[Audio] queueEnd handling failed for guild ${player.guildId}`, error);
      });
    });
    this.lavalink.on("playerDestroy", player => {
      this.clearStopTimers(player.guildId);
      this.skipVotes.delete(player.guildId);
      this.previousVotes.delete(player.guildId);
      this.energySaving.clear(player.guildId);
      void this.clearVoiceChannelStatus(player.voiceChannelId);
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

  private async onTrackStart(guildId: string, player: Player, track: Track | null) {
    if (!track) {
      await this.musicStats.endTrack(guildId);
      await this.clearVoiceChannelStatus(player.voiceChannelId);
      await this.repository.markStoppedKeepQueue(guildId);
      return;
    }

    const session = this.ensureSessionCache(guildId, player.textChannelId ?? null);
    session.afk = false;
    session.lastActiveTextChannelId = player.textChannelId ?? session.lastActiveTextChannelId;
    session.tracksPlayed += 1;
    await this.syncVoiceChannelStatus(player.voiceChannelId, track);
    const requester = (track.requester as { id?: string } | undefined)?.id ?? "unknown";
    const stored = trackToStored(track, requester);
    await this.repository.setCurrent(guildId, stored);
    await this.repository.replaceQueue(
      guildId,
      player.queue.tracks.map(next => trackToStored(next as Track, ((next as Track).requester as { id?: string } | undefined)?.id ?? "unknown")),
    );
    await this.repository.setSessionState(guildId, "active", 0);
    await this.musicStats.beginTrack({ guildId, track: stored });
  }

  private async onQueueEnd(guildId: string) {
    await this.musicStats.endTrack(guildId);
    const player = this.lavalink.getPlayer(guildId);
    const state = await this.repository.getOrCreate(guildId);
    const current = this.repository.getCurrentFromState(state);
    if (!player || !current) {
      await this.clearVoiceChannelStatus(player?.voiceChannelId ?? state.lastVoiceChannelId ?? state.voiceChannelId);
      await this.repository.markStoppedKeepQueue(guildId);
      return;
    }

    const resolved = await this.resolveStoredTrack(player, current);
    if (!resolved) {
      await this.clearVoiceChannelStatus(player.voiceChannelId);
      await this.repository.markStoppedKeepQueue(guildId);
      return;
    }

    player.queue.add(resolved);
    await this.playbackService.playWithRetry(player, guildId, "queue loop", () => Boolean(this.lavalink.getPlayer(guildId)?.playing));
  }

  private async syncPosition(guildId: string, positionMs: number) {
    const now = Date.now();
    const last = this.lastPositionSync.get(guildId) ?? 0;
    if (now - last < 5000) return;
    this.lastPositionSync.set(guildId, now);
    await this.repository.setPosition(guildId, positionMs).catch(() => null);
  }

  private async rollbackFailedPlayback(guildId: string, player: Player) {
    this.musicStats.clearNextTrackStartMarker(guildId);
    await this.musicStats.endTrack(guildId);
    await player.stopPlaying(true).catch(() => null);
    await this.repository.markStoppedKeepQueue(guildId).catch(() => null);
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

    const query = track.url ?? track.query ?? track.identifier;
    if (!query) return null;

    const choice = await this.search.resolve(query, requestedBy);
    return choice?.lavalinkTrack ?? null;
  }

  private async resolveStoredTrack(player: Player, track: StoredTrack) {
    if (track.encoded) {
      const decoded = await player.node.decode.singleTrack(track.encoded, { id: track.requestedBy }).catch(() => null);
      if (decoded) return this.search.applyStoredMetadata(decoded, track);
    }

    const query = track.url || [track.author, track.title].filter(Boolean).join(" ");
    if (!query) return null;
    const choice = await this.search.resolve(query, track.requestedBy);
    return choice?.lavalinkTrack ? this.search.applyStoredMetadata(choice.lavalinkTrack, track) : null;
  }

  private async resolveStoredTracks(player: Player, tracks: StoredTrack[]) {
    const resolved: Track[] = [];
    for (const track of tracks) {
      const result = await this.resolveStoredTrack(player, track);
      if (result) resolved.push(result);
    }
    return resolved;
  }

  private getCurrentTrackKey(track: Track) {
    return track.encoded ?? track.info.identifier ?? track.info.uri ?? track.info.title;
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

  private scheduleNoListenersStop(guildId: string, voiceChannelId: string) {
    if (this.noListenerTimers.has(guildId)) return;

    const timer = setTimeout(() => {
      void this.stopBecauseNoListeners(guildId, voiceChannelId);
    }, this.NO_LISTENERS_STOP_MS);
    timer.unref?.();
    this.noListenerTimers.set(guildId, timer);
  }

  private clearStopTimers(guildId: string) {
    const stopTimer = this.noListenerTimers.get(guildId);
    if (stopTimer) clearTimeout(stopTimer);
    this.noListenerTimers.delete(guildId);

    const disconnectTimer = this.disconnectTimers.get(guildId);
    if (disconnectTimer) clearTimeout(disconnectTimer);
    this.disconnectTimers.delete(guildId);
  }

  private async stopBecauseNoListeners(guildId: string, voiceChannelId: string) {
    this.noListenerTimers.delete(guildId);
    const listeners = this.getNonBotListenerIds(guildId, voiceChannelId);
    if (listeners.length > 0) return;

    const player = this.lavalink.getPlayer(guildId);
    if (!player?.queue.current) return;

    await player.pause().catch(() => null);
    await this.repository.markStoppedKeepQueue(guildId, player.position);
    await this.musicStats.pauseTrack(guildId);
    this.ensureSessionCache(guildId, player.textChannelId ?? null).afk = true;
    await this.setPausedVoiceChannelStatus(guildId, player.voiceChannelId);
    this.energySaving.clear(guildId);
    this.scheduleDisconnectAfterStop(guildId);
  }

  private rewindPosition(positionMs: number) {
    return Math.max(0, Math.floor(positionMs) - this.RESUME_REWIND_MS);
  }

  private scheduleDisconnectAfterStop(guildId: string) {
    const existing = this.disconnectTimers.get(guildId);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
      void this.disconnectStoppedSession(guildId);
    }, this.DISCONNECT_AFTER_STOP_MS);
    timer.unref?.();
    this.disconnectTimers.set(guildId, timer);
  }

  private async disconnectStoppedSession(guildId: string) {
    this.disconnectTimers.delete(guildId);
    const player = this.lavalink.getPlayer(guildId);
    if (!player) {
      await this.finalizeSession(guildId, "afk_timeout", {
        destroyPlayer: false,
        cleanupState: false,
      });
      return;
    }

    const listeners = this.getNonBotListenerIds(guildId, player.voiceChannelId);
    if (listeners.length > 0) return;

    await this.finalizeSession(guildId, "afk_timeout", {
      textChannelId: player.textChannelId ?? null,
      destroyPlayer: true,
      cleanupState: false,
    });
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

  private async publishResumePanel(newState: VoiceState, guildId: string) {
    if (!newState.channelId) return;
    await this.tryPublishResumePanel(guildId, newState.id, newState.channelId, {
      notifyOnPermissionIssue: true,
      ignoreCooldown: false,
    });
  }

  private async tryPublishResumePanel(
    guildId: string,
    userId: string,
    voiceChannelId: string,
    options: {
      notifyOnPermissionIssue: boolean;
      ignoreCooldown: boolean;
    },
  ) {
    const cooldownKey = `${guildId}:${voiceChannelId}`;
    const lastSentAt = this.resumePanelCooldowns.get(cooldownKey) ?? 0;
    if (!options.ignoreCooldown && Date.now() - lastSentAt < 10_000) return false;

    const guild = this.app.guilds.cache.get(guildId) ?? await this.app.guilds.fetch(guildId).catch(() => null);
    if (!guild) {
      this.pendingResumePanels.delete(guildId);
      return false;
    }

    const state = await this.repository.getOrCreate(guildId);
    if (state.sessionState !== "stopped" || state.lastVoiceChannelId !== voiceChannelId) {
      this.pendingResumePanels.delete(guildId);
      return false;
    }

    const member = guild.members.cache.get(userId) ?? await guild.members.fetch(userId).catch(() => null);
    if (!member || member.voice.channelId !== voiceChannelId) {
      this.pendingResumePanels.delete(guildId);
      return false;
    }

    const targetChannel = guild.channels.cache.get(voiceChannelId)
      ?? await guild.channels.fetch(voiceChannelId).catch(() => null);
    if (!targetChannel || (targetChannel.type !== ChannelType.GuildVoice && targetChannel.type !== ChannelType.GuildStageVoice)) {
      this.pendingResumePanels.delete(guildId);
      return false;
    }

    const componentCheck = checkCanSendComponents(targetChannel);
    if (!componentCheck.ok) {
      this.pendingResumePanels.set(guildId, {
        guildId,
        userId,
        voiceChannelId,
        alerted: this.pendingResumePanels.get(guildId)?.alerted ?? false,
      });
      if (options.notifyOnPermissionIssue) {
        await this.notifyResumePermissionIssue(guildId, userId, voiceChannelId, componentCheck.missing);
      }
      return false;
    }

    this.resumePanelCooldowns.set(cooldownKey, Date.now());
    const memberMention = member.toString() ?? `<@${userId}>`;
    const accentColor = member ? await this.resolveAccentColor(member) : null;
    const panel = await buildLetsPlayPanel({
      guildId,
      memberMention,
      playCommand: await formatSlashCommandMention(this.app, "play"),
      accentColor,
      resumeVoiceChannelId: voiceChannelId,
    });
    const sent = await targetChannel.send({
      components: [panel],
      flags: MessageFlags.IsComponentsV2,
      allowedMentions: NO_PING_ALLOWED_MENTIONS,
    }).catch(() => null);
    if (!sent) return false;
    this.pendingResumePanels.delete(guildId);
    await this.sendTemporaryResumeMention(targetChannel, memberMention);
    return true;
  }

  private async notifyResumePermissionIssue(guildId: string, userId: string, voiceChannelId: string, missing: PermissionKey[]) {
    const pending = this.pendingResumePanels.get(guildId);
    if (pending?.alerted) return;

    const guild = this.app.guilds.cache.get(guildId) ?? await this.app.guilds.fetch(guildId).catch(() => null);
    if (!guild) return;
    const state = await this.repository.getOrCreate(guildId);
    const preferredChannelId = state.lastTextChannelId ?? state.textChannelId;
    const preferredChannel = preferredChannelId
      ? await this.app.channels.fetch(preferredChannelId).catch(() => null)
      : null;
    const fallbackChannel = preferredChannel && "guild" in preferredChannel && "send" in preferredChannel && checkCanSendText(preferredChannel as Parameters<typeof checkCanSendText>[0]).ok
      ? preferredChannel
      : await findFirstPublicWritableTextChannel(guild);
    if (!fallbackChannel) return;

    const messages = await getGuildMessages(guildId);
    const content = messages.music.resumePendingPermissions
      .replace("{member}", `<@${userId}>`)
      .replace("{channel}", `<#${voiceChannelId}>`)
      .replace("{permissions}", formatDiscordPermissionInline(missing));
    await fallbackChannel.send({ content }).catch(() => null);

    const next = this.pendingResumePanels.get(guildId);
    if (next) {
      next.alerted = true;
    }
  }

  private async sendTemporaryResumeMention(targetChannel: VoiceBasedChannel, memberMention: string) {
    const pingMessage = await targetChannel.send({ content: memberMention }).catch(() => null);
    if (!pingMessage) return;
    setTimeout(() => void pingMessage.delete().catch(() => undefined), env.privateVoice.panelMentionTtlMs).unref?.();
  }

  private async resolveAccentColor(member: GuildMember) {
    const requesterColor = member.displayColor;
    if (requesterColor && requesterColor !== 0) return requesterColor;
    return null;
  }

  private formatVoiceStatus(track: Track) {
    const stored = trackToStored(track, "unknown");
    const title = stored.title.trim() || "Unknown title";
    const author = stored.author?.trim() || "Unknown artist";
    const status = `${this.VOICE_STATUS_PREFIX} ${title} - ${author}`;
    return status.length > this.VOICE_STATUS_MAX_LENGTH
      ? `${status.slice(0, this.VOICE_STATUS_MAX_LENGTH - 1).trimEnd()}...`
      : status;
  }

  private async syncVoiceChannelStatus(voiceChannelId: string | null | undefined, track: Track | null | undefined) {
    if (!voiceChannelId || !track) return;
    await this.app.rest.put(`/channels/${voiceChannelId}/voice-status`, {
      body: {
        status: this.formatVoiceStatus(track),
      },
    }).catch(() => null);
  }

  private async clearVoiceChannelStatus(voiceChannelId: string | null | undefined) {
    if (!voiceChannelId) return;
    await this.app.rest.put(`/channels/${voiceChannelId}/voice-status`, {
      body: {
        status: "",
      },
    }).catch(() => null);
  }

  private ensureSessionCache(guildId: string, textChannelId: string | null) {
    const existing = this.sessionCache.get(guildId);
    if (existing) {
      if (textChannelId) existing.lastActiveTextChannelId = textChannelId;
      return existing;
    }

    const created: SessionCacheEntry = {
      startedAt: Date.now(),
      tracksPlayed: 0,
      lastActiveTextChannelId: textChannelId,
      afk: false,
    };
    this.sessionCache.set(guildId, created);
    return created;
  }

  private async setPausedVoiceChannelStatus(guildId: string, voiceChannelId: string | null | undefined) {
    if (!voiceChannelId) return;
    const messages = await getGuildMessages(guildId);
    await this.app.rest.put(`/channels/${voiceChannelId}/voice-status`, {
      body: {
        status: `${this.VOICE_STATUS_PREFIX} ${messages.music.voiceStatusPaused}`,
      },
    }).catch(() => null);
  }

  private formatSessionDuration(ms: number) {
    const totalMinutes = Math.max(1, Math.round(ms / 60_000));
    return `${totalMinutes} min`;
  }

  private async finalizeSession(
    guildId: string,
    reason: SessionEndReason,
    options: {
      requestedBy?: string;
      textChannelId?: string | null;
      destroyPlayer: boolean;
      cleanupState: boolean;
    },
  ) {
    if (!this.tryBeginSessionFinalization(guildId)) return;

    const player = this.lavalink.getPlayer(guildId);
    const voiceChannelId = player?.voiceChannelId;
    const textChannelId = options.textChannelId
      ?? player?.textChannelId
      ?? this.sessionCache.get(guildId)?.lastActiveTextChannelId
      ?? (await this.repository.getOrCreate(guildId)).lastTextChannelId;

    this.clearStopTimers(guildId);
    this.energySaving.clear(guildId);
    this.skipVotes.delete(guildId);
    this.previousVotes.delete(guildId);
    await this.musicStats.endTrack(guildId);
    await this.clearVoiceChannelStatus(voiceChannelId);

    if (options.destroyPlayer && player) {
      this.markExpectedVoiceDisconnect(guildId);
      await player.destroy(reason, true).catch(() => null);
    }

    if (options.cleanupState) {
      await this.repository.reset(guildId, false).catch(() => null);
    } else {
      const state = await this.repository.getOrCreate(guildId);
      await this.repository.markStoppedKeepQueue(guildId, state.positionMs).catch(() => null);
      await this.repository.setDisconnected(guildId).catch(() => null);
    }

    await this.sendSessionEndedNotice(guildId, reason, textChannelId, options.requestedBy);
    this.pendingResumePanels.delete(guildId);
    if (reason !== "afk_timeout") {
      this.sessionCache.delete(guildId);
    } else {
      const session = this.sessionCache.get(guildId);
      if (session) {
        session.afk = false;
      }
    }
  }

  private async sendSessionEndedNotice(
    guildId: string,
    reason: SessionEndReason,
    textChannelId: string | null | undefined,
    requestedBy?: string,
  ) {
    if (!textChannelId) return;

    const channel = await this.app.channels.fetch(textChannelId).catch(() => null);
    if (!channel || !("send" in channel)) return;

    const messages = await getGuildMessages(guildId);
    const session = this.sessionCache.get(guildId);
    const sessionDuration = this.formatSessionDuration(Date.now() - (session?.startedAt ?? Date.now()));
    const summary = messages.music.sessionSummary
      .replace("{count}", String(session?.tracksPlayed ?? 0))
      .replace("{duration}", sessionDuration);
    const reasonText = reason === "requested"
      ? messages.music.sessionReasonRequested.replace("{member}", requestedBy ?? messages.common.control)
      : reason === "manual_disconnect"
        ? messages.music.sessionReasonManualDisconnect
        : messages.music.sessionReasonAfk;
    const title = reason === "requested"
      ? messages.music.disconnectingRequested
      : messages.music.sessionLeftTitle;
    const description = `${summary}\n-# ${reasonText}`;

    await (channel as TextChannel).send({
      components: [await buildNeutralNoticePanel(guildId, title, description)],
      flags: MessageFlags.IsComponentsV2,
      allowedMentions: NO_PING_ALLOWED_MENTIONS,
    }).catch(async () => {
      await (channel as TextChannel).send({
        content: `${title}\n${description}`,
        allowedMentions: NO_PING_ALLOWED_MENTIONS,
      }).catch(() => null);
    });
  }

  private isSessionFinalizationCoolingDown(guildId: string) {
    const expiresAt = this.sessionFinalizationCooldowns.get(guildId);
    if (!expiresAt) return false;
    if (expiresAt <= Date.now()) {
      this.sessionFinalizationCooldowns.delete(guildId);
      return false;
    }
    return true;
  }

  private tryBeginSessionFinalization(guildId: string) {
    if (this.isSessionFinalizationCoolingDown(guildId)) return false;
    this.sessionFinalizationCooldowns.set(guildId, Date.now() + 5_000);
    return true;
  }
}

function sameStoredTrack(left: StoredTrack, right: StoredTrack) {
  return getStoredTrackIdentity(left) === getStoredTrackIdentity(right);
}

function getStoredTrackIdentity(track: StoredTrack) {
  return track.identifier || track.encoded || track.url || `${track.author ?? ""}:${track.title}`;
}

function getLiveTrackIdentity(track: Track) {
  return track.encoded || track.info.identifier || track.info.uri || `${track.info.author ?? ""}:${track.info.title}`;
}

export function prependStoredTrackOnce(current: StoredTrack, queue: StoredTrack[]) {
  if (queue[0] && sameStoredTrack(queue[0], current)) return [...queue];
  return [current, ...queue];
}

export function prependLiveTrackOnce(current: Track, queue: Track[]) {
  if (queue[0] && getLiveTrackIdentity(queue[0]) === getLiveTrackIdentity(current)) return [...queue];
  return [current, ...queue];
}
