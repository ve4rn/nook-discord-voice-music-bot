import { Prisma, type Track as DbTrack } from "@prisma/client";
import { prisma } from "../config/Prisma.js";
import { QueueLimitReachedError } from "../domain/errors/index.js";
import {
  type AudioSessionState,
  getAudioQueueAvailableSlots,
  MAX_AUDIO_QUEUE_SIZE,
  type StoredTrack,
} from "../types/audio.js";

const audioStateInclude = {
  currentTrack: true,
  queue: {
    orderBy: {
      queuePosition: "asc",
    },
  },
} satisfies Prisma.GuildAudioStateInclude;

type AudioStateWithTracks = Prisma.GuildAudioStateGetPayload<{
  include: typeof audioStateInclude;
}>;

function toStoredTrack(track: DbTrack): StoredTrack {
  return {
    title: track.title,
    url: track.url,
    duration: track.duration,
    requestedBy: track.requestedBy,
    source: track.source ?? undefined,
    metadataSource: track.metadataSource ?? undefined,
    audioSource: track.audioSource ?? undefined,
    author: track.author ?? undefined,
    encoded: track.encoded ?? undefined,
    identifier: track.identifier ?? undefined,
    isrc: track.isrc ?? undefined,
    artworkUrl: track.artworkUrl,
    isStream: track.isStream,
  };
}

function toTrackCreate(guildId: string, track: StoredTrack, queuePosition?: number, queuedInId?: string): Prisma.TrackCreateInput {
  return {
    guildId,
    title: track.title,
    url: track.url,
    duration: Math.max(0, Math.floor(track.duration)),
    requestedBy: track.requestedBy,
    source: track.source,
    metadataSource: track.metadataSource,
    audioSource: track.audioSource,
    author: track.author,
    encoded: track.encoded,
    identifier: track.identifier,
    isrc: track.isrc,
    artworkUrl: track.artworkUrl,
    isStream: track.isStream ?? false,
    queuePosition,
    queuedIn: queuedInId ? { connect: { id: queuedInId } } : undefined,
  };
}

function serializeStoredTrack(track: StoredTrack | null): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  if (!track) return Prisma.JsonNull;
  return {
    title: track.title,
    url: track.url,
    duration: track.duration,
    requestedBy: track.requestedBy,
    source: track.source ?? null,
    author: track.author ?? null,
    encoded: track.encoded ?? null,
    identifier: track.identifier ?? null,
    metadataSource: track.metadataSource ?? null,
    audioSource: track.audioSource ?? null,
    isrc: track.isrc ?? null,
    artworkUrl: track.artworkUrl ?? null,
    isStream: track.isStream ?? false,
  };
}

function deserializeStoredTrack(value: Prisma.JsonValue | null): StoredTrack | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const track = value as Record<string, unknown>;
  if (typeof track.title !== "string" || typeof track.url !== "string" || typeof track.requestedBy !== "string") {
    return null;
  }

  return {
    title: track.title,
    url: track.url,
    duration: typeof track.duration === "number" ? track.duration : 0,
    requestedBy: track.requestedBy,
    source: typeof track.source === "string" ? track.source : undefined,
    author: typeof track.author === "string" ? track.author : undefined,
    encoded: typeof track.encoded === "string" ? track.encoded : undefined,
    identifier: typeof track.identifier === "string" ? track.identifier : undefined,
    metadataSource: typeof track.metadataSource === "string" ? track.metadataSource : undefined,
    audioSource: typeof track.audioSource === "string" ? track.audioSource : undefined,
    isrc: typeof track.isrc === "string" ? track.isrc : undefined,
    artworkUrl: typeof track.artworkUrl === "string" ? track.artworkUrl : null,
    isStream: typeof track.isStream === "boolean" ? track.isStream : false,
  };
}

export class AudioStateRepository {
  async getOrCreate(guildId: string): Promise<AudioStateWithTracks> {
    return prisma.guildAudioState.upsert({
      where: { guildId },
      update: {},
      create: {
        guildId,
        isPlaying: false,
        isPaused: false,
        sessionState: "idle",
      },
      include: audioStateInclude,
    });
  }

  async listActive() {
    return prisma.guildAudioState.findMany({
      where: {
        OR: [
          { isPlaying: true },
          { isPaused: true },
          { voiceChannelId: { not: null } },
        ],
      },
    });
  }

  async setChannels(guildId: string, voiceChannelId: string | null, textChannelId: string | null, sessionState: AudioSessionState = "active") {
    await this.getOrCreate(guildId);
    return prisma.guildAudioState.update({
      where: { guildId },
      data: {
        voiceChannelId,
        textChannelId,
        lastVoiceChannelId: voiceChannelId ?? undefined,
        lastTextChannelId: textChannelId ?? undefined,
        sessionState,
      },
      include: audioStateInclude,
    });
  }

  async setDisconnected(guildId: string) {
    const state = await this.getOrCreate(guildId);
    const nextSessionState: AudioSessionState = state.currentTrackId || state.queue.length ? "stopped" : "idle";
    return prisma.guildAudioState.update({
      where: { guildId },
      data: {
        voiceChannelId: null,
        textChannelId: null,
        sessionState: nextSessionState,
        stoppedAt: nextSessionState === "stopped" ? new Date() : null,
      },
      include: audioStateInclude,
    });
  }

  async setCurrent(guildId: string, track: StoredTrack | null) {
    const state = await this.getOrCreate(guildId);

    if (!track) {
      await prisma.guildAudioState.update({
        where: { guildId },
        data: {
          currentTrackId: null,
          isPlaying: false,
          isPaused: false,
          positionMs: 0,
          positionUpdatedAt: null,
          stoppedAt: null,
          sessionState: state.queue.length ? "active" : "idle",
        },
      });
      if (state.currentTrackId) await prisma.track.deleteMany({ where: { id: state.currentTrackId } });
      return this.getOrCreate(guildId);
    }

    const currentTrack = state.currentTrack ? toStoredTrack(state.currentTrack) : null;
    const createdTrack = await prisma.track.create({
      data: toTrackCreate(guildId, track),
    });

    await prisma.guildAudioState.update({
      where: { guildId },
      data: {
        currentTrackId: createdTrack.id,
        isPlaying: true,
        isPaused: false,
        positionMs: 0,
        positionUpdatedAt: new Date(),
        stoppedAt: null,
        sessionState: "active",
        previousTrackData: serializeStoredTrack(currentTrack),
      },
    });
    if (state.currentTrackId) await prisma.track.deleteMany({ where: { id: state.currentTrackId } });
    return this.getOrCreate(guildId);
  }

  async setPaused(guildId: string, paused: boolean, positionMs?: number) {
    await this.getOrCreate(guildId);
    return prisma.guildAudioState.update({
      where: { guildId },
      data: {
        isPaused: paused,
        isPlaying: true,
        positionMs: Math.max(0, Math.floor(positionMs ?? 0)),
        positionUpdatedAt: new Date(),
        sessionState: "active",
      },
      include: audioStateInclude,
    });
  }

  async setPosition(guildId: string, positionMs: number) {
    await this.getOrCreate(guildId);
    return prisma.guildAudioState.update({
      where: { guildId },
      data: {
        positionMs: Math.max(0, Math.floor(positionMs)),
        positionUpdatedAt: new Date(),
      },
      include: audioStateInclude,
    });
  }

  async setPreviousTrack(guildId: string, track: StoredTrack | null) {
    await this.getOrCreate(guildId);
    return prisma.guildAudioState.update({
      where: { guildId },
      data: {
        previousTrackData: serializeStoredTrack(track),
      },
      include: audioStateInclude,
    });
  }

  async setSessionState(guildId: string, sessionState: AudioSessionState, positionMs?: number) {
    await this.getOrCreate(guildId);
    return prisma.guildAudioState.update({
      where: { guildId },
      data: {
        isPlaying: sessionState === "active",
        isPaused: false,
        sessionState,
        stoppedAt: sessionState === "stopped" ? new Date() : null,
        positionMs: positionMs == null ? undefined : Math.max(0, Math.floor(positionMs)),
        positionUpdatedAt: positionMs == null ? undefined : new Date(),
      },
      include: audioStateInclude,
    });
  }

  async enqueue(guildId: string, track: StoredTrack) {
    const state = await this.getOrCreate(guildId);
    if (getAudioQueueAvailableSlots(state) <= 0) throw new QueueLimitReachedError();

    const maxPosition = await prisma.track.aggregate({
      where: { queuedInId: state.id },
      _max: { queuePosition: true },
    });
    const queuePosition = (maxPosition._max.queuePosition ?? -1) + 1;

    await prisma.track.create({
      data: toTrackCreate(guildId, track, queuePosition, state.id),
    });
    return this.getOrCreate(guildId);
  }

  async removeQueuedByEncoded(guildId: string, encoded?: string) {
    const state = await this.getOrCreate(guildId);
    if (!encoded) return state;

    const track = state.queue.find(item => item.encoded === encoded);
    if (!track) return state;

    await prisma.track.deleteMany({ where: { id: track.id } });
    await this.normalizeQueuePositions(state.id);
    return this.getOrCreate(guildId);
  }

  async removeQueuedTrack(guildId: string, index: number, encoded?: string) {
    const state = await this.getOrCreate(guildId);
    const target = encoded
      ? state.queue.find(item => item.encoded === encoded) ?? state.queue[index]
      : state.queue[index];
    if (!target) return this.getOrCreate(guildId);

    await prisma.track.deleteMany({ where: { id: target.id } });
    await this.normalizeQueuePositions(state.id);
    return this.getOrCreate(guildId);
  }

  async insertFront(guildId: string, track: StoredTrack) {
    const state = await this.getOrCreate(guildId);
    const queue = this.getQueueFromState(state);
    queue.unshift(track);
    return this.replaceQueue(guildId, queue);
  }

  async replaceQueue(guildId: string, queue: StoredTrack[]) {
    const state = await this.getOrCreate(guildId);
    await prisma.track.deleteMany({ where: { queuedInId: state.id } });
    await prisma.track.createMany({
      data: queue.slice(0, MAX_AUDIO_QUEUE_SIZE).map((track, index) => ({
        guildId,
        title: track.title,
        url: track.url,
        duration: Math.max(0, Math.floor(track.duration)),
        requestedBy: track.requestedBy,
        source: track.source,
        metadataSource: track.metadataSource,
        audioSource: track.audioSource,
        author: track.author,
        encoded: track.encoded,
        identifier: track.identifier,
        isrc: track.isrc,
        artworkUrl: track.artworkUrl,
        isStream: track.isStream ?? false,
        queuePosition: index,
        queuedInId: state.id,
      })),
    });
    return this.getOrCreate(guildId);
  }

  async reset(guildId: string, keepQueue = false) {
    const state = await this.getOrCreate(guildId);
    await prisma.guildAudioState.update({
      where: { guildId },
      data: {
        voiceChannelId: null,
        textChannelId: null,
        lastVoiceChannelId: null,
        lastTextChannelId: null,
        isPlaying: false,
        isPaused: false,
        sessionState: "idle",
        stoppedAt: null,
        positionMs: 0,
        positionUpdatedAt: null,
        previousTrackData: Prisma.JsonNull,
        currentTrackId: null,
      },
    });
    if (state.currentTrackId) await prisma.track.deleteMany({ where: { id: state.currentTrackId } });
    if (!keepQueue) await prisma.track.deleteMany({ where: { queuedInId: state.id } });
    return this.getOrCreate(guildId);
  }

  async markStoppedKeepQueue(guildId: string, positionMs?: number) {
    const state = await this.getOrCreate(guildId);
    return prisma.guildAudioState.update({
      where: { guildId },
      data: {
        isPlaying: false,
        isPaused: false,
        sessionState: state.currentTrackId || state.queue.length ? "stopped" : "idle",
        stoppedAt: state.currentTrackId || state.queue.length ? new Date() : null,
        positionMs: positionMs == null ? state.positionMs : Math.max(0, Math.floor(positionMs)),
        positionUpdatedAt: new Date(),
      },
      include: audioStateInclude,
    });
  }

  async clearCurrentKeepQueue(guildId: string) {
    const state = await this.getOrCreate(guildId);
    await prisma.guildAudioState.update({
      where: { guildId },
      data: {
        currentTrackId: null,
        isPlaying: false,
        isPaused: false,
        positionMs: 0,
        positionUpdatedAt: null,
        sessionState: state.queue.length ? "active" : "idle",
      },
    });
    if (state.currentTrackId) await prisma.track.deleteMany({ where: { id: state.currentTrackId } });
    return this.getOrCreate(guildId);
  }

  getQueueFromState(state: { queue: DbTrack[] }) {
    return state.queue.map(toStoredTrack).slice(0, MAX_AUDIO_QUEUE_SIZE);
  }

  getCurrentFromState(state: { currentTrack: DbTrack | null }) {
    return state.currentTrack ? toStoredTrack(state.currentTrack) : null;
  }

  getPreviousFromState(state: { previousTrackData: Prisma.JsonValue | null }) {
    return deserializeStoredTrack(state.previousTrackData);
  }

  private async normalizeQueuePositions(audioStateId: string) {
    const queue = await prisma.track.findMany({
      where: { queuedInId: audioStateId },
      orderBy: { queuePosition: "asc" },
    });

    await Promise.all(queue.map((track, index) =>
      prisma.track.updateMany({
        where: { id: track.id },
        data: { queuePosition: index },
      }),
    ));
  }
}
