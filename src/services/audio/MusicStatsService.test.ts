import { beforeEach, describe, expect, it, vi } from "vitest";
import { MusicStatsService, createMonthKey } from "./MusicStatsService.js";

const baseTrack = {
  title: " Never  Gonna Give You Up ",
  url: "https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC",
  duration: 212000,
  requestedBy: "user-1",
  author: " Rick  Astley ",
  metadataSource: "spotify",
  audioSource: "youtube",
  identifier: "dQw4w9WgXcQ",
  isrc: "GBARL0600786",
  artworkUrl: "https://example.com/artwork.png",
};

function createService(options?: {
  enabled?: boolean;
  flushIntervalMs?: number;
  nowRef?: { value: number };
}) {
  const monthlyWrites: Array<{
    userId: string;
    monthKey: string;
    trackId: string;
    playCountDelta: number;
    playedMsDelta: bigint;
  }> = [];

  const nowRef = options?.nowRef ?? { value: 0 };
  const service = new MusicStatsService({
    enabled: options?.enabled,
    flushIntervalMs: options?.flushIntervalMs ?? 0,
    now: () => nowRef.value,
    bufferService: {
      enabled: false,
      init: vi.fn(async () => undefined),
      disconnect: vi.fn(async () => undefined),
      ping: vi.fn(async () => false),
      saveEntry: vi.fn(async () => undefined),
      deleteEntry: vi.fn(async () => undefined),
      listEntries: vi.fn(async () => []),
    },
    catalogResolver: {
      resolveCatalogTrack: vi.fn(async track => track.title.includes("Together") ? "catalog-track-2" : "catalog-track-1"),
    },
    monthlyRepository: {
      applyDelta: vi.fn(async input => {
        monthlyWrites.push({
          ...input,
          playedMsDelta: BigInt(input.playedMsDelta),
        });
      }),
    },
  });

  return { service, monthlyWrites, nowRef };
}

describe("MusicStatsService", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it("creates month keys in UTC", () => {
    expect(createMonthKey(new Date("2026-05-31T23:59:59.999Z"))).toBe("2026-05");
    expect(createMonthKey(new Date("2026-06-01T00:00:00.000Z"))).toBe("2026-06");
  });

  it("does nothing when stats are disabled", async () => {
    const { service, monthlyWrites } = createService({ enabled: false });

    await service.beginTrack({ guildId: "guild-1", track: baseTrack });
    await service.pauseTrack("guild-1");
    await service.flushGuild("guild-1");

    expect(monthlyWrites).toHaveLength(0);
  });

  it("flushes play count and listened time on pause", async () => {
    const nowRef = { value: Date.parse("2026-05-20T10:00:00.000Z") };
    const { service, monthlyWrites } = createService({ nowRef });

    await service.beginTrack({ guildId: "guild-1", track: baseTrack });
    nowRef.value += 30_000;
    await service.pauseTrack("guild-1");

    expect(monthlyWrites).toEqual([
      {
        userId: "user-1",
        monthKey: "2026-05",
        trackId: "catalog-track-1",
        playCountDelta: 1,
        playedMsDelta: 30_000n,
      },
    ]);
  });

  it("resumes without incrementing play count twice", async () => {
    const nowRef = { value: Date.parse("2026-05-20T10:00:00.000Z") };
    const { service, monthlyWrites } = createService({ nowRef });

    await service.beginTrack({ guildId: "guild-1", track: baseTrack });
    nowRef.value += 10_000;
    await service.pauseTrack("guild-1");
    nowRef.value += 5_000;
    await service.resumeTrack({ guildId: "guild-1", track: baseTrack });
    nowRef.value += 20_000;
    await service.endTrack("guild-1");

    expect(monthlyWrites).toEqual([
      {
        userId: "user-1",
        monthKey: "2026-05",
        trackId: "catalog-track-1",
        playCountDelta: 1,
        playedMsDelta: 10_000n,
      },
      {
        userId: "user-1",
        monthKey: "2026-05",
        trackId: "catalog-track-1",
        playCountDelta: 0,
        playedMsDelta: 20_000n,
      },
    ]);
  });

  it("flushes the previous track before starting a new one", async () => {
    const nowRef = { value: Date.parse("2026-05-20T10:00:00.000Z") };
    const { service, monthlyWrites } = createService({ nowRef });
    const secondTrack = {
      ...baseTrack,
      title: "Together Forever",
      url: "https://example.com/track-2",
    };

    await service.beginTrack({ guildId: "guild-1", track: baseTrack });
    nowRef.value += 12_000;
    await service.beginTrack({ guildId: "guild-1", track: secondTrack });
    nowRef.value += 8_000;
    await service.endTrack("guild-1");

    expect(monthlyWrites).toEqual([
      {
        userId: "user-1",
        monthKey: "2026-05",
        trackId: "catalog-track-1",
        playCountDelta: 1,
        playedMsDelta: 12_000n,
      },
      {
        userId: "user-1",
        monthKey: "2026-05",
        trackId: "catalog-track-2",
        playCountDelta: 1,
        playedMsDelta: 8_000n,
      },
    ]);
  });

  it("uses periodic flushes only for dirty entries", async () => {
    vi.useFakeTimers();
    const nowRef = { value: Date.parse("2026-05-20T10:00:00.000Z") };
    const { service, monthlyWrites } = createService({ flushIntervalMs: 60_000, nowRef });

    await service.beginTrack({ guildId: "guild-1", track: baseTrack });
    nowRef.value += 60_000;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(monthlyWrites).toHaveLength(1);
    expect(monthlyWrites[0]?.playedMsDelta).toBe(60_000n);

    nowRef.value += 60_000;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(monthlyWrites).toHaveLength(2);
    expect(monthlyWrites[1]?.playCountDelta).toBe(0);
    expect(monthlyWrites[1]?.playedMsDelta).toBe(60_000n);

    await service.pauseTrack("guild-1");
    const writesAfterPause = monthlyWrites.length;

    nowRef.value += 60_000;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(monthlyWrites).toHaveLength(writesAfterPause);

    await service.shutdownFlushAll();
  });
});
