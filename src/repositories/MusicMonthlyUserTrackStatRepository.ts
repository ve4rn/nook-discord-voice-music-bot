import { prisma, withDbLimit } from "../config/Prisma.js";

export type MusicMonthlyUserTrackStatDeltaInput = {
  userId: string;
  monthKey: string;
  trackId: string;
  playCountDelta: number;
  playedMsDelta: number;
};

export class MusicMonthlyUserTrackStatRepository {
  async applyDelta(input: MusicMonthlyUserTrackStatDeltaInput) {
    if (input.playCountDelta <= 0 && input.playedMsDelta <= 0) return null;

    return withDbLimit(() =>
      prisma.musicMonthlyUserTrackStat.upsert({
        where: {
          userId_monthKey_trackId: {
            userId: input.userId,
            monthKey: input.monthKey,
            trackId: input.trackId,
          },
        },
        update: {
          playCount: {
            increment: Math.max(0, Math.floor(input.playCountDelta)),
          },
          playedMs: {
            increment: BigInt(Math.max(0, Math.floor(input.playedMsDelta))),
          },
        },
        create: {
          userId: input.userId,
          monthKey: input.monthKey,
          trackId: input.trackId,
          playCount: Math.max(0, Math.floor(input.playCountDelta)),
          playedMs: BigInt(Math.max(0, Math.floor(input.playedMsDelta))),
        },
      }),
    );
  }
}
