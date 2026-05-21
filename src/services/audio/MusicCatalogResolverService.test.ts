import { MusicMetadataSource } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import {
  MusicCatalogResolverService,
  bucketDurationMs,
  createFallbackCanonicalKey,
  extractReliableSourceIdentities,
  normalizeCatalogText,
  normalizeIsrc,
} from "./MusicCatalogResolverService.js";

const spotifyTrack = {
  title: "Muscle Museum",
  url: "https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC",
  duration: 262973,
  requestedBy: "user-1",
  source: "spotify",
  metadataSource: "spotify",
  audioSource: "youtube",
  author: "Muse",
  identifier: "dQw4w9WgXcQ",
  isrc: " gb-aaa-99-00001 ",
};

describe("MusicCatalogResolverService helpers", () => {
  it("normalizes ISRC, title and artist consistently", () => {
    expect(normalizeIsrc(" gb-aaa-99-00001 ")).toBe("GBAAA9900001");
    expect(normalizeCatalogText(" Bébé, Muse!!!  ")).toBe("bebe muse");
  });

  it("uses 5-second duration buckets and versioned fallback keys", () => {
    expect(bucketDurationMs(262973)).toBe(265000);
    expect(createFallbackCanonicalKey({
      normalizedTitle: "muscle museum",
      normalizedArtist: "muse",
      durationMs: 262973,
    }).startsWith("fallback:v1:")).toBe(true);
  });

  it("extracts reliable metadata and playback identities separately", () => {
    expect(extractReliableSourceIdentities(spotifyTrack)).toEqual([
      expect.objectContaining({
        source: MusicMetadataSource.SPOTIFY,
        sourceId: "4uLU6hMCjMI75M1A2tKUQC",
        role: "metadata",
      }),
      expect.objectContaining({
        source: MusicMetadataSource.YOUTUBE,
        sourceId: "dQw4w9WgXcQ",
        role: "playback",
      }),
    ]);
  });
});

describe("MusicCatalogResolverService", () => {
  it("prefers normalized ISRC over source identity", async () => {
    const catalogRepository = {
      findByNormalizedIsrc: vi.fn(async () => ({
        id: "catalog-isrc",
        canonicalKey: "isrc:GBAAA9900001",
      })),
      findByCanonicalKey: vi.fn(async () => null),
      createCanonicalTrack: vi.fn(async () => {
        throw new Error("should not create");
      }),
      updateCanonicalFields: vi.fn(async () => undefined),
      findById: vi.fn(async () => ({
        id: "catalog-isrc",
        canonicalKey: "isrc:GBAAA9900001",
      })),
    };
    const sourceRepository = {
      findBySourceIdentity: vi.fn(async (source: MusicMetadataSource) => (
        source === MusicMetadataSource.SPOTIFY
          ? {
              trackId: "catalog-source",
              track: { id: "catalog-source", canonicalKey: "source:spotify:4uLU6hMCjMI75M1A2tKUQC" },
            }
          : null
      )),
      upsertSourceIdentity: vi.fn(async () => undefined),
    };
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const resolver = new MusicCatalogResolverService({ catalogRepository, sourceRepository });
    const trackId = await resolver.resolveCatalogTrack(spotifyTrack);

    expect(trackId).toBe("catalog-isrc");
    expect(catalogRepository.findByNormalizedIsrc).toHaveBeenCalledWith("GBAAA9900001");
    expect(warnSpy).toHaveBeenCalledOnce();
    warnSpy.mockRestore();
  });

  it("falls back to source identity when ISRC is missing", async () => {
    const catalogRepository = {
      findByNormalizedIsrc: vi.fn(async () => null),
      findByCanonicalKey: vi.fn(async () => null),
      createCanonicalTrack: vi.fn(async () => {
        throw new Error("should not create");
      }),
      updateCanonicalFields: vi.fn(async () => undefined),
      findById: vi.fn(async () => null),
    };
    const sourceRepository = {
      findBySourceIdentity: vi.fn(async () => ({
        trackId: "catalog-spotify",
        track: { id: "catalog-spotify", canonicalKey: "source:spotify:4uLU6hMCjMI75M1A2tKUQC" },
      })),
      upsertSourceIdentity: vi.fn(async () => undefined),
    };

    const resolver = new MusicCatalogResolverService({ catalogRepository, sourceRepository });
    const trackId = await resolver.resolveCatalogTrack({
      ...spotifyTrack,
      isrc: undefined,
    });

    expect(trackId).toBe("catalog-spotify");
    expect(sourceRepository.findBySourceIdentity).toHaveBeenCalledWith(MusicMetadataSource.SPOTIFY, "4uLU6hMCjMI75M1A2tKUQC");
  });

  it("creates a fallback canonical track when no strong identity exists", async () => {
    const catalogRepository = {
      findByNormalizedIsrc: vi.fn(async () => null),
      findByCanonicalKey: vi.fn(async () => null),
      createCanonicalTrack: vi.fn(async input => ({
        id: "catalog-fallback",
        ...input,
      })),
      updateCanonicalFields: vi.fn(async () => undefined),
      findById: vi.fn(async () => null),
    };
    const sourceRepository = {
      findBySourceIdentity: vi.fn(async () => null),
      upsertSourceIdentity: vi.fn(async () => undefined),
    };

    const resolver = new MusicCatalogResolverService({ catalogRepository, sourceRepository });
    const trackId = await resolver.resolveCatalogTrack({
      title: "Muscle Museum!!!",
      url: "https://example.com/random",
      duration: 262973,
      requestedBy: "user-1",
      source: "unknown",
      author: "Muse",
    });

    expect(trackId).toBe("catalog-fallback");
    expect(catalogRepository.createCanonicalTrack).toHaveBeenCalledWith(expect.objectContaining({
      canonicalKey: expect.stringMatching(/^fallback:v1:/),
      normalizedTitle: "muscle museum",
      normalizedArtist: "muse",
    }));
    expect(sourceRepository.upsertSourceIdentity).not.toHaveBeenCalled();
  });
});
