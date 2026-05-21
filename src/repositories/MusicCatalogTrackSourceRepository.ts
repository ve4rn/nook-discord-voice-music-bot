import type { MusicCatalogTrackSource, MusicMetadataSource, Prisma } from "@prisma/client";
import { prisma, withDbLimit } from "../config/Prisma.js";

export type UpsertMusicCatalogTrackSourceInput = {
  trackId: string;
  source: MusicMetadataSource;
  sourceId: string;
  url: string | null;
  title: string | null;
  artistName: string | null;
  durationMs: number | null;
};

export class MusicCatalogTrackSourceRepository {
  async findBySourceIdentity(source: MusicMetadataSource, sourceId: string) {
    return withDbLimit(() =>
      prisma.musicCatalogTrackSource.findUnique({
        where: {
          source_sourceId: {
            source,
            sourceId,
          },
        },
        include: { track: true },
      }),
    );
  }

  async upsertSourceIdentity(input: UpsertMusicCatalogTrackSourceInput) {
    return withDbLimit(() =>
      prisma.musicCatalogTrackSource.upsert({
        where: {
          source_sourceId: {
            source: input.source,
            sourceId: input.sourceId,
          },
        },
        update: {
          trackId: input.trackId,
          url: input.url,
          title: input.title,
          artistName: input.artistName,
          durationMs: input.durationMs,
        },
        create: {
          trackId: input.trackId,
          source: input.source,
          sourceId: input.sourceId,
          url: input.url,
          title: input.title,
          artistName: input.artistName,
          durationMs: input.durationMs,
        } satisfies Prisma.MusicCatalogTrackSourceUncheckedCreateInput,
      }),
    );
  }
}
