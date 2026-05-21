import type { Prisma } from "@prisma/client";
import { prisma, withDbLimit } from "../config/Prisma.js";

export type CreateCanonicalTrackInput = {
  id?: string;
  canonicalKey: string;
  isrc: string | null;
  normalizedIsrc: string | null;
  title: string;
  normalizedTitle: string;
  artistName: string | null;
  normalizedArtist: string | null;
  durationMs: number | null;
};

export type UpdateCanonicalTrackFieldsInput = Omit<CreateCanonicalTrackInput, "canonicalKey" | "id">;

function toCreateData(input: CreateCanonicalTrackInput): Prisma.MusicCatalogTrackUncheckedCreateInput {
  return {
    id: input.id,
    canonicalKey: input.canonicalKey,
    isrc: input.isrc,
    normalizedIsrc: input.normalizedIsrc,
    title: input.title,
    normalizedTitle: input.normalizedTitle,
    artistName: input.artistName,
    normalizedArtist: input.normalizedArtist,
    durationMs: input.durationMs,
  };
}

export class MusicCatalogTrackRepository {
  async findById(id: string) {
    return withDbLimit(() =>
      prisma.musicCatalogTrack.findUnique({ where: { id } }),
    );
  }

  async findByNormalizedIsrc(normalizedIsrc: string) {
    return withDbLimit(() =>
      prisma.musicCatalogTrack.findFirst({
        where: { normalizedIsrc },
        orderBy: { createdAt: "asc" },
      }),
    );
  }

  async findByCanonicalKey(canonicalKey: string) {
    return withDbLimit(() =>
      prisma.musicCatalogTrack.findUnique({ where: { canonicalKey } }),
    );
  }

  async createCanonicalTrack(input: CreateCanonicalTrackInput) {
    return withDbLimit(() =>
      prisma.musicCatalogTrack.create({
        data: toCreateData(input),
      }),
    );
  }

  async updateCanonicalFields(id: string, input: UpdateCanonicalTrackFieldsInput) {
    return withDbLimit(() =>
      prisma.musicCatalogTrack.update({
        where: { id },
        data: {
          isrc: input.isrc,
          normalizedIsrc: input.normalizedIsrc,
          title: input.title,
          normalizedTitle: input.normalizedTitle,
          artistName: input.artistName,
          normalizedArtist: input.normalizedArtist,
          durationMs: input.durationMs,
        },
      }),
    );
  }
}
