import { Prisma, type Track as DbTrack } from "@prisma/client";
import { prisma } from "../config/Prisma.js";
import { QueueLimitReachedError } from "../domain/errors/index.js";
import { getAudioQueueAvailableSlots, MAX_AUDIO_QUEUE_SIZE, type StoredTrack } from "../types/audio.js";

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
        author: track.author ?? undefined,
        encoded: track.encoded ?? undefined,
        identifier: track.identifier ?? undefined,
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
        author: track.author,
        encoded: track.encoded,
        identifier: track.identifier,
        artworkUrl: track.artworkUrl,
        isStream: track.isStream ?? false,
        queuePosition,
        queuedIn: queuedInId ? { connect: { id: queuedInId } } : undefined,
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

    async setChannels(guildId: string, voiceChannelId: string | null, textChannelId: string | null) {
        await this.getOrCreate(guildId);
        return prisma.guildAudioState.update({
            where: { guildId },
            data: { voiceChannelId, textChannelId },
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
                },
            });
            if (state.currentTrackId) await prisma.track.deleteMany({ where: { id: state.currentTrackId } });
            return this.getOrCreate(guildId);
        }

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

    async setLoop(guildId: string, loop: boolean) {
        await this.getOrCreate(guildId);
        return prisma.guildAudioState.update({
            where: { guildId },
            data: { loop },
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

    async dequeue(guildId: string) {
        const state = await this.getOrCreate(guildId);
        const next = state.queue[0] ?? null;
        if (!next) return null;

        await prisma.track.deleteMany({ where: { id: next.id } });
        await this.normalizeQueuePositions(state.id);
        return toStoredTrack(next);
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
                author: track.author,
                encoded: track.encoded,
                identifier: track.identifier,
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
                isPlaying: false,
                isPaused: false,
                positionMs: 0,
                positionUpdatedAt: null,
                currentTrackId: null,
            },
        });
        if (state.currentTrackId) await prisma.track.deleteMany({ where: { id: state.currentTrackId } });
        if (!keepQueue) await prisma.track.deleteMany({ where: { queuedInId: state.id } });
        return this.getOrCreate(guildId);
    }

    async markStoppedKeepQueue(guildId: string) {
        const state = await this.getOrCreate(guildId);
        await prisma.guildAudioState.update({
            where: { guildId },
            data: {
                isPlaying: false,
                isPaused: false,
                positionMs: 0,
                positionUpdatedAt: null,
                currentTrackId: null,
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
