import { createHash } from "node:crypto";
import { MusicMetadataSource, type MusicCatalogTrack } from "@prisma/client";
import {
  MusicCatalogTrackRepository,
  type CreateCanonicalTrackInput,
  type UpdateCanonicalTrackFieldsInput,
} from "../../repositories/MusicCatalogTrackRepository.js";
import {
  MusicCatalogTrackSourceRepository,
  type UpsertMusicCatalogTrackSourceInput,
} from "../../repositories/MusicCatalogTrackSourceRepository.js";
import type { StoredTrack } from "../../types/audio.js";

const SPOTIFY_TRACK_ID_RE = /open\.spotify\.com\/(?:intl-[a-z]{2}\/)?track\/([A-Za-z0-9]{22})/i;
const DEEZER_TRACK_ID_RE = /deezer\.com\/(?:[a-z]{2}\/)?track\/(\d+)/i;
const SPOTIFY_ID_SHAPE_RE = /^[A-Za-z0-9]{22}$/;
const DEEZER_ID_SHAPE_RE = /^\d+$/;
const DURATION_BUCKET_MS = 5_000;

type ResolvedSourceIdentity = {
  source: MusicMetadataSource;
  sourceId: string;
  url: string | null;
  title: string | null;
  artistName: string | null;
  durationMs: number | null;
  role: "metadata" | "playback";
};

type MusicCatalogResolverServiceOptions = {
  catalogRepository?: Pick<MusicCatalogTrackRepository, "findByNormalizedIsrc" | "findByCanonicalKey" | "createCanonicalTrack" | "updateCanonicalFields" | "findById">;
  sourceRepository?: Pick<MusicCatalogTrackSourceRepository, "findBySourceIdentity" | "upsertSourceIdentity">;
};

export function normalizeCatalogText(value: string | null | undefined) {
  return (value ?? "")
    .normalize("NFKD")
    .replace(/\p{Mark}+/gu, "")
    .replace(/[^\p{Letter}\p{Number}\s]/gu, " ")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

export function normalizeIsrc(value: string | null | undefined) {
  const normalized = (value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").trim();
  return normalized || null;
}

export function bucketDurationMs(durationMs: number | null | undefined) {
  if (!Number.isFinite(durationMs) || durationMs == null || durationMs <= 0) return 0;
  return Math.round(durationMs / DURATION_BUCKET_MS) * DURATION_BUCKET_MS;
}

export function createFallbackCanonicalKey(input: {
  normalizedTitle: string;
  normalizedArtist: string | null;
  durationMs: number | null;
}) {
  const durationBucket = String(bucketDurationMs(input.durationMs));
  const digest = createHash("sha1")
    .update(`${input.normalizedTitle}\u0000${input.normalizedArtist ?? ""}\u0000${durationBucket}`, "utf8")
    .digest("hex");
  return `fallback:v1:${digest}`;
}

export function parseMusicMetadataSource(raw: string | null | undefined): MusicMetadataSource | null {
  const normalized = (raw ?? "").trim().toLowerCase();
  if (!normalized) return null;
  if (normalized.includes("spotify")) return MusicMetadataSource.SPOTIFY;
  if (normalized.includes("deezer")) return MusicMetadataSource.DEEZER;
  if (normalized.includes("youtube") || normalized.includes("ytmsearch") || normalized.includes("ytsearch")) return MusicMetadataSource.YOUTUBE;
  if (normalized.includes("soundcloud") || normalized.includes("scsearch")) return MusicMetadataSource.SOUNDCLOUD;
  if (normalized.includes("unknown")) return MusicMetadataSource.UNKNOWN;
  return null;
}

function parseSpotifyTrackId(url: string | null | undefined) {
  return SPOTIFY_TRACK_ID_RE.exec(url ?? "")?.[1] ?? null;
}

function parseDeezerTrackId(url: string | null | undefined) {
  return DEEZER_TRACK_ID_RE.exec(url ?? "")?.[1] ?? null;
}

function extractSourceId(track: StoredTrack, source: MusicMetadataSource, role: "metadata" | "playback") {
  if (source === MusicMetadataSource.SPOTIFY) {
    return parseSpotifyTrackId(track.url) ?? (role === "metadata" && SPOTIFY_ID_SHAPE_RE.test(track.identifier ?? "") ? track.identifier ?? null : null);
  }
  if (source === MusicMetadataSource.DEEZER) {
    return parseDeezerTrackId(track.url) ?? (role === "metadata" && DEEZER_ID_SHAPE_RE.test(track.identifier ?? "") ? track.identifier ?? null : null);
  }
  if (source === MusicMetadataSource.YOUTUBE || source === MusicMetadataSource.SOUNDCLOUD) {
    return track.identifier?.trim() || null;
  }
  return null;
}

export function extractReliableSourceIdentities(track: StoredTrack): ResolvedSourceIdentity[] {
  const identities: ResolvedSourceIdentity[] = [];
  const candidates: Array<{ source: MusicMetadataSource | null; role: "metadata" | "playback" }> = [
    { source: parseMusicMetadataSource(track.metadataSource ?? track.source), role: "metadata" },
    { source: parseMusicMetadataSource(track.audioSource), role: "playback" },
  ];

  for (const candidate of candidates) {
    if (!candidate.source || candidate.source === MusicMetadataSource.UNKNOWN) continue;
    const sourceId = extractSourceId(track, candidate.source, candidate.role);
    if (!sourceId) continue;

    const dedupKey = `${candidate.source}:${sourceId}`;
    if (identities.some(identity => `${identity.source}:${identity.sourceId}` === dedupKey)) continue;

    identities.push({
      source: candidate.source,
      sourceId,
      url: track.url?.trim() || null,
      title: track.title.trim() || null,
      artistName: track.author?.trim() || null,
      durationMs: Number.isFinite(track.duration) ? Math.max(0, Math.floor(track.duration)) : null,
      role: candidate.role,
    });
  }

  return identities;
}

function buildCanonicalTrackInput(track: StoredTrack, canonicalKey: string): CreateCanonicalTrackInput {
  const normalizedTitle = normalizeCatalogText(track.title) || "unknown title";
  const normalizedArtist = normalizeCatalogText(track.author);
  return {
    canonicalKey,
    isrc: track.isrc?.trim() || null,
    normalizedIsrc: normalizeIsrc(track.isrc),
    title: track.title.trim() || "Unknown title",
    normalizedTitle,
    artistName: track.author?.trim() || null,
    normalizedArtist: normalizedArtist || null,
    durationMs: Number.isFinite(track.duration) ? Math.max(0, Math.floor(track.duration)) : null,
  };
}

function toUpdateInput(track: StoredTrack): UpdateCanonicalTrackFieldsInput {
  const normalizedTitle = normalizeCatalogText(track.title) || "unknown title";
  const normalizedArtist = normalizeCatalogText(track.author);
  return {
    isrc: track.isrc?.trim() || null,
    normalizedIsrc: normalizeIsrc(track.isrc),
    title: track.title.trim() || "Unknown title",
    normalizedTitle,
    artistName: track.author?.trim() || null,
    normalizedArtist: normalizedArtist || null,
    durationMs: Number.isFinite(track.duration) ? Math.max(0, Math.floor(track.duration)) : null,
  };
}

function mergeCanonicalFields(existing: MusicCatalogTrack, track: StoredTrack): UpdateCanonicalTrackFieldsInput {
  const next = toUpdateInput(track);
  return {
    isrc: next.isrc ?? existing.isrc ?? null,
    normalizedIsrc: next.normalizedIsrc ?? existing.normalizedIsrc ?? null,
    title: next.title || existing.title,
    normalizedTitle: next.normalizedTitle || existing.normalizedTitle,
    artistName: next.artistName ?? existing.artistName ?? null,
    normalizedArtist: next.normalizedArtist ?? existing.normalizedArtist ?? null,
    durationMs: next.durationMs ?? existing.durationMs ?? null,
  };
}

function chooseCanonicalKey(track: StoredTrack, identities: ResolvedSourceIdentity[]) {
  const normalizedIsrc = normalizeIsrc(track.isrc);
  if (normalizedIsrc) return `isrc:${normalizedIsrc}`;

  const strongestIdentity = identities.find(identity => identity.role === "metadata") ?? identities[0];
  if (strongestIdentity) return `source:${strongestIdentity.source.toLowerCase()}:${strongestIdentity.sourceId}`;

  return createFallbackCanonicalKey({
    normalizedTitle: normalizeCatalogText(track.title) || "unknown title",
    normalizedArtist: normalizeCatalogText(track.author) || null,
    durationMs: Number.isFinite(track.duration) ? Math.max(0, Math.floor(track.duration)) : null,
  });
}

export class MusicCatalogResolverService {
  private readonly catalogRepository: Pick<MusicCatalogTrackRepository, "findByNormalizedIsrc" | "findByCanonicalKey" | "createCanonicalTrack" | "updateCanonicalFields" | "findById">;
  private readonly sourceRepository: Pick<MusicCatalogTrackSourceRepository, "findBySourceIdentity" | "upsertSourceIdentity">;

  constructor(options: MusicCatalogResolverServiceOptions = {}) {
    this.catalogRepository = options.catalogRepository ?? new MusicCatalogTrackRepository();
    this.sourceRepository = options.sourceRepository ?? new MusicCatalogTrackSourceRepository();
  }

  async resolveCatalogTrack(track: StoredTrack) {
    const normalizedTrackIsrc = normalizeIsrc(track.isrc);
    const reliableIdentities = extractReliableSourceIdentities(track);
    let resolvedTrack: MusicCatalogTrack | null = null;

    if (normalizedTrackIsrc) {
      resolvedTrack = await this.catalogRepository.findByNormalizedIsrc(normalizedTrackIsrc);
    }

    if (!resolvedTrack) {
      for (const identity of reliableIdentities) {
        const mapped = await this.sourceRepository.findBySourceIdentity(identity.source, identity.sourceId);
        if (mapped?.track) {
          resolvedTrack = mapped.track;
          break;
        }
      }
    }

    if (!resolvedTrack) {
      resolvedTrack = await this.catalogRepository.findByCanonicalKey(chooseCanonicalKey(track, reliableIdentities));
    }

    if (!resolvedTrack) {
      resolvedTrack = await this.catalogRepository.createCanonicalTrack(
        buildCanonicalTrackInput(track, chooseCanonicalKey(track, reliableIdentities)),
      );
    } else {
      await this.catalogRepository.updateCanonicalFields(resolvedTrack.id, mergeCanonicalFields(resolvedTrack, track));
      resolvedTrack = await this.catalogRepository.findById(resolvedTrack.id) ?? resolvedTrack;
    }

    for (const identity of reliableIdentities) {
      const existing = await this.sourceRepository.findBySourceIdentity(identity.source, identity.sourceId);
      if (existing && existing.trackId !== resolvedTrack.id) {
        console.warn(
          `[MusicCatalog] Source identity conflict for ${identity.source}:${identity.sourceId}. Keeping track ${resolvedTrack.id}, existing mapping points to ${existing.trackId}.`,
        );
        continue;
      }

      await this.sourceRepository.upsertSourceIdentity({
        trackId: resolvedTrack.id,
        source: identity.source,
        sourceId: identity.sourceId,
        url: identity.url,
        title: identity.title,
        artistName: identity.artistName,
        durationMs: identity.durationMs,
      } satisfies UpsertMusicCatalogTrackSourceInput);
    }

    return resolvedTrack.id;
  }
}
