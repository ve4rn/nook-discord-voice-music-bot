import { env } from "../../config/env.js";
import { MusicMonthlyUserTrackStatRepository } from "../../repositories/MusicMonthlyUserTrackStatRepository.js";
import type { StoredTrack } from "../../types/audio.js";
import { MusicCatalogResolverService } from "./MusicCatalogResolverService.js";
import {
  MusicStatsRedisBufferService,
  type PersistedMusicStatsEntry,
} from "./MusicStatsRedisBufferService.js";

type ActiveTrackStatsEntry = {
  guildId: string;
  userId: string;
  trackId: string;
  monthKey: string;
  segmentStartedAt: number | null;
  playedMsDelta: number;
  playCountDelta: number;
};

type TrackStatsInput = {
  guildId: string;
  track: StoredTrack;
  accentColor?: number | null;
};

type MusicStatsServiceOptions = {
  enabled?: boolean;
  flushIntervalMs?: number;
  now?: () => number;
  monthlyRepository?: Pick<MusicMonthlyUserTrackStatRepository, "applyDelta">;
  catalogResolver?: Pick<MusicCatalogResolverService, "resolveCatalogTrack">;
  bufferService?: Pick<MusicStatsRedisBufferService, "init" | "disconnect" | "saveEntry" | "deleteEntry" | "listEntries" | "enabled" | "ping">;
};

export type MusicStatsBufferHealthSnapshot = {
  configured: boolean;
  connected: boolean;
  restoredEntries: number;
};

export function createMonthKey(date: Date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

export class MusicStatsService {
  private readonly enabled: boolean;
  private readonly flushIntervalMs: number;
  private readonly now: () => number;
  private readonly monthlyRepository: Pick<MusicMonthlyUserTrackStatRepository, "applyDelta">;
  private readonly catalogResolver: Pick<MusicCatalogResolverService, "resolveCatalogTrack">;
  private readonly bufferService: Pick<MusicStatsRedisBufferService, "init" | "disconnect" | "saveEntry" | "deleteEntry" | "listEntries" | "enabled" | "ping">;
  private readonly activeByGuild = new Map<string, ActiveTrackStatsEntry>();
  private readonly guildLocks = new Map<string, Promise<void>>();
  private readonly nextTrackStartWithoutPlayCount = new Set<string>();
  private readonly flushTimer: NodeJS.Timeout | null;
  private initPromise: Promise<void> | null = null;
  private readonly bufferHealth: MusicStatsBufferHealthSnapshot = {
    configured: false,
    connected: false,
    restoredEntries: 0,
  };

  constructor(options: MusicStatsServiceOptions = {}) {
    this.enabled = options.enabled ?? env.audio.statsEnabled;
    this.flushIntervalMs = options.flushIntervalMs ?? env.audio.statsFlushIntervalMs;
    this.now = options.now ?? Date.now;
    this.monthlyRepository = options.monthlyRepository ?? new MusicMonthlyUserTrackStatRepository();
    this.catalogResolver = options.catalogResolver ?? new MusicCatalogResolverService();
    this.bufferService = options.bufferService ?? new MusicStatsRedisBufferService();

    if (this.enabled && this.flushIntervalMs > 0) {
      this.flushTimer = setInterval(() => {
        void this.flushAll().catch(error => {
          console.error("[MusicStats] Periodic flush failed", error);
        });
      }, this.flushIntervalMs);
      this.flushTimer.unref?.();
    } else {
      this.flushTimer = null;
    }
  }

  async init() {
    if (!this.enabled) return;
    if (this.initPromise) {
      await this.initPromise;
      return;
    }

    this.initPromise = (async () => {
      this.bufferHealth.configured = this.bufferService.enabled;
      if (!this.bufferService.enabled) return;
      await this.bufferService.init();
      this.bufferHealth.connected = await this.bufferService.ping().catch(() => false);
      this.bufferHealth.restoredEntries = await this.restoreBufferedDeltas();
    })().finally(() => {
      this.initPromise = null;
    });

    await this.initPromise;
  }

  async beginTrack(input: TrackStatsInput) {
    if (!this.enabled || !input.track.requestedBy || input.track.requestedBy === "unknown") return;

    await this.runExclusive(input.guildId, async () => {
      await this.endTrackInternal(input.guildId);

      const trackId = await this.catalogResolver.resolveCatalogTrack(input.track);
      const countPlay = !this.nextTrackStartWithoutPlayCount.delete(input.guildId);
      this.activeByGuild.set(input.guildId, {
        guildId: input.guildId,
        userId: input.track.requestedBy,
        trackId,
        monthKey: createMonthKey(new Date(this.now())),
        segmentStartedAt: this.now(),
        playedMsDelta: 0,
        playCountDelta: countPlay ? 1 : 0,
      });
      await this.syncBufferEntry(this.activeByGuild.get(input.guildId) ?? null);
    });
  }

  async pauseTrack(guildId: string) {
    if (!this.enabled) return;
    await this.runExclusive(guildId, async () => {
      const entry = this.activeByGuild.get(guildId);
      if (!entry) return;
      this.closeSegment(entry);
      await this.syncBufferEntry(entry);
      await this.flushEntry(entry, false);
    });
  }

  async resumeTrack(input: TrackStatsInput) {
    if (!this.enabled || !input.track.requestedBy || input.track.requestedBy === "unknown") return;

    await this.runExclusive(input.guildId, async () => {
      const existing = this.activeByGuild.get(input.guildId);
      if (existing) {
        if (existing.segmentStartedAt == null) existing.segmentStartedAt = this.now();
        await this.syncBufferEntry(existing);
        return;
      }

      const trackId = await this.catalogResolver.resolveCatalogTrack(input.track);
      this.activeByGuild.set(input.guildId, {
        guildId: input.guildId,
        userId: input.track.requestedBy,
        trackId,
        monthKey: createMonthKey(new Date(this.now())),
        segmentStartedAt: this.now(),
        playedMsDelta: 0,
        playCountDelta: 0,
      });
      await this.syncBufferEntry(this.activeByGuild.get(input.guildId) ?? null);
    });
  }

  async endTrack(guildId: string) {
    if (!this.enabled) return;
    await this.runExclusive(guildId, async () => {
      await this.endTrackInternal(guildId);
    });
  }

  async flushGuild(guildId: string) {
    if (!this.enabled) return;
    await this.runExclusive(guildId, async () => {
      const entry = this.activeByGuild.get(guildId);
      if (!entry) return;
      await this.persistCheckpoint(entry, true);
      await this.flushEntry(entry, true);
    });
  }

  async flushAll() {
    if (!this.enabled) return;
    await Promise.all([...this.activeByGuild.keys()].map(guildId => this.flushGuild(guildId)));
  }

  markNextTrackStartAsResume(guildId: string) {
    if (!this.enabled) return;
    this.nextTrackStartWithoutPlayCount.add(guildId);
  }

  clearNextTrackStartMarker(guildId: string) {
    this.nextTrackStartWithoutPlayCount.delete(guildId);
  }

  async shutdownFlushAll() {
    if (this.flushTimer) clearInterval(this.flushTimer);
    await this.flushAll();
    await this.bufferService.disconnect().catch(() => undefined);
    this.bufferHealth.connected = false;
  }

  getBufferHealthSnapshot(): MusicStatsBufferHealthSnapshot {
    return { ...this.bufferHealth };
  }

  private async endTrackInternal(guildId: string) {
    const entry = this.activeByGuild.get(guildId);
    if (!entry) return;
    this.closeSegment(entry);
    await this.syncBufferEntry(entry);
    await this.flushEntry(entry, false);
    this.activeByGuild.delete(guildId);
    await this.syncBufferEntry(null, guildId);
  }

  private closeSegment(entry: ActiveTrackStatsEntry) {
    if (entry.segmentStartedAt == null) return;
    const elapsed = Math.max(0, this.now() - entry.segmentStartedAt);
    entry.playedMsDelta += elapsed;
    entry.segmentStartedAt = null;
  }

  private async flushEntry(entry: ActiveTrackStatsEntry, keepSegmentOpen: boolean) {
    const snapshot = this.snapshotDirtyState(entry, keepSegmentOpen);
    if (!snapshot) return;

    try {
      await this.monthlyRepository.applyDelta({
        userId: snapshot.userId,
        monthKey: snapshot.monthKey,
        trackId: snapshot.trackId,
        playCountDelta: snapshot.playCountDelta,
        playedMsDelta: snapshot.playedMsDelta,
      });
      entry.playCountDelta = 0;
      entry.playedMsDelta = 0;
      entry.segmentStartedAt = snapshot.nextSegmentStartedAt;
      await this.syncBufferEntry(entry);
    } catch (error) {
      if (keepSegmentOpen && entry.segmentStartedAt == null && snapshot.nextSegmentStartedAt != null) {
        entry.segmentStartedAt = snapshot.originalSegmentStartedAt;
      }
      console.error(`[MusicStats] Failed to flush stats for guild ${entry.guildId}`, error);
    }
  }

  private snapshotDirtyState(entry: ActiveTrackStatsEntry, keepSegmentOpen: boolean) {
    const hadOpenSegment = entry.segmentStartedAt != null;
    const originalSegmentStartedAt = entry.segmentStartedAt;
    let playedMsDelta = entry.playedMsDelta;
    let nextSegmentStartedAt = entry.segmentStartedAt;

    if (hadOpenSegment && entry.segmentStartedAt != null) {
      const now = this.now();
      playedMsDelta += Math.max(0, now - entry.segmentStartedAt);
      nextSegmentStartedAt = keepSegmentOpen ? now : null;
    }

    if (entry.playCountDelta <= 0 && playedMsDelta <= 0) return null;

    return {
      userId: entry.userId,
      monthKey: entry.monthKey,
      trackId: entry.trackId,
      playCountDelta: entry.playCountDelta,
      playedMsDelta,
      nextSegmentStartedAt,
      originalSegmentStartedAt,
    };
  }

  private createBufferedSnapshot(entry: ActiveTrackStatsEntry, checkpointOpenSegment: boolean): PersistedMusicStatsEntry {
    let playedMsDelta = entry.playedMsDelta;
    let segmentStartedAt = entry.segmentStartedAt;

    if (checkpointOpenSegment && entry.segmentStartedAt != null) {
      const now = this.now();
      playedMsDelta += Math.max(0, now - entry.segmentStartedAt);
      segmentStartedAt = now;
    }

    return {
      guildId: entry.guildId,
      userId: entry.userId,
      trackId: entry.trackId,
      monthKey: entry.monthKey,
      segmentStartedAt,
      playedMsDelta,
      playCountDelta: entry.playCountDelta,
      persistedAt: this.now(),
    };
  }

  private async persistCheckpoint(entry: ActiveTrackStatsEntry, checkpointOpenSegment: boolean) {
    if (!this.bufferService.enabled) return;
    await this.bufferService.saveEntry(this.createBufferedSnapshot(entry, checkpointOpenSegment)).catch(error => {
      console.error(`[MusicStats] Failed to persist Redis checkpoint for guild ${entry.guildId}`, error);
    });
  }

  private async syncBufferEntry(entry: ActiveTrackStatsEntry | null, guildId = entry?.guildId ?? null) {
    if (!this.bufferService.enabled || !guildId) return;

    if (!entry) {
      await this.bufferService.deleteEntry(guildId).catch(error => {
        console.error(`[MusicStats] Failed to clear Redis checkpoint for guild ${guildId}`, error);
      });
      return;
    }

    const hasMeaningfulState = entry.segmentStartedAt != null || entry.playCountDelta > 0 || entry.playedMsDelta > 0;
    if (!hasMeaningfulState) {
      await this.bufferService.deleteEntry(guildId).catch(error => {
        console.error(`[MusicStats] Failed to clear Redis checkpoint for guild ${guildId}`, error);
      });
      return;
    }

    await this.persistCheckpoint(entry, false);
  }

  private async restoreBufferedDeltas() {
    const entries = await this.bufferService.listEntries().catch(error => {
      console.error("[MusicStats] Failed to list Redis buffered stats", error);
      return [] as PersistedMusicStatsEntry[];
    });
    let restoredEntries = 0;

    for (const entry of entries) {
      try {
        if (entry.playCountDelta > 0 || entry.playedMsDelta > 0) {
          await this.monthlyRepository.applyDelta({
            userId: entry.userId,
            monthKey: entry.monthKey,
            trackId: entry.trackId,
            playCountDelta: entry.playCountDelta,
            playedMsDelta: entry.playedMsDelta,
          });
        }

        await this.bufferService.deleteEntry(entry.guildId).catch(() => undefined);
        restoredEntries += 1;
      } catch (error) {
        console.error(`[MusicStats] Failed to restore buffered stats for guild ${entry.guildId}`, error);
      }
    }

    return restoredEntries;
  }

  private async runExclusive(guildId: string, task: () => Promise<void>) {
    const previous = this.guildLocks.get(guildId) ?? Promise.resolve();
    const current = previous
      .catch(() => undefined)
      .then(task)
      .finally(() => {
        if (this.guildLocks.get(guildId) === current) {
          this.guildLocks.delete(guildId);
        }
      });
    this.guildLocks.set(guildId, current);
    await current;
  }
}
