import type { LavalinkManager, SearchPlatform, Track } from "lavalink-client";
import { formatDuration, StoredTrack, TrackSearchChoice, trackToStored } from "./types.js";
import { similarity } from "./levenshtein.js";

type CachedTrack = {
    expiresAt: number;
    track: StoredTrack;
    lavalinkTrack?: Track;
};

type ExternalTrackMetadata = {
    title: string;
    author?: string;
    duration?: number;
};

const CACHE_TTL_MS = 5 * 60 * 1000;
const AUTOCOMPLETE_TIMEOUT_MS = 2_000;
const SEARCH_SOURCES: SearchPlatform[] = ["scsearch", "ytsearch"];
const SPOTIFY_URL_RE = /^https?:\/\/open\.spotify\.com\/(intl-[a-z]{2}\/)?(track|album|playlist|episode|show)\/[A-Za-z0-9]+/i;
const SPOTIFY_URL_PARTS_RE = /^https?:\/\/open\.spotify\.com\/(?:intl-[a-z]{2}\/)?(?<type>track|album|playlist|episode|show)\/(?<id>[A-Za-z0-9]+)/i;

export class TrackSearchService {
    private readonly cache = new Map<string, CachedTrack>();

    constructor(private readonly manager: LavalinkManager) { }

    async autocomplete(query: string, requestedBy: string): Promise<TrackSearchChoice[]> {
        return this.withTimeout(this.autocompleteInner(query, requestedBy), AUTOCOMPLETE_TIMEOUT_MS, []);
    }

    private async autocompleteInner(query: string, requestedBy: string): Promise<TrackSearchChoice[]> {
        if (!query.trim() || !this.manager.useable) return [];
        const search = await this.search(query, requestedBy);
        return this.rank(search.rankQuery, search.tracks, requestedBy, search.metadata)
            .slice(0, 25)
            .map((track, index) => this.toChoice(track, requestedBy, index));
    }

    async resolve(input: string, requestedBy: string): Promise<TrackSearchChoice | null> {
        this.pruneCache();
        const cached = this.cache.get(input);
        if (cached) {
            return {
                token: input,
                label: cached.track.title,
                track: cached.track,
                lavalinkTrack: cached.lavalinkTrack,
            };
        }

        if (!this.manager.useable) return null;
        const search = await this.search(input, requestedBy);
        const best = this.rank(search.rankQuery, search.tracks, requestedBy, search.metadata)[0];
        return best ? this.toChoice(best, requestedBy, 0) : null;
    }

    private async search(query: string, requestedBy: string) {
        if (!this.isSpotifyUrl(query)) {
            return { rankQuery: query, tracks: await this.searchRaw(query, requestedBy), metadata: null };
        }

        const metadata = await this.fetchSpotifyMetadata(query) ?? await this.fetchSpotifyOEmbedMetadata(query);
        if (!metadata) {
            return { rankQuery: query, tracks: [], metadata: null };
        }

        const rankQuery = [metadata.author, metadata.title].filter(Boolean).join(" ");
        return { rankQuery, tracks: await this.searchRaw(rankQuery, requestedBy), metadata };
    }

    private async searchRaw(query: string, requestedBy: string, sources: SearchPlatform[] = SEARCH_SOURCES): Promise<Track[]> {
        const node = this.manager.nodeManager.leastUsedNodes("memory")[0];
        if (!node) return [];

        const results = await Promise.allSettled(
            sources.map(source => node.search({ query, source }, { id: requestedBy })),
        );

        const tracks: Track[] = [];
        const seen = new Set<string>();
        for (const result of results) {
            if (result.status !== "fulfilled") continue;
            for (const track of result.value.tracks ?? []) {
                if (!this.isPlayableTrack(track)) continue;
                const key = track.encoded ?? track.info.uri;
                if (!key || seen.has(key)) continue;
                seen.add(key);
                tracks.push(track);
            }
        }
        return tracks;
    }

    private isPlayableTrack(track: Track) {
        if (track.info.sourceName !== "soundcloud") return true;

        const identifier = track.info.identifier?.toLowerCase() ?? "";
        const uri = track.info.uri?.toLowerCase() ?? "";
        return !identifier.includes("/preview/") && !uri.includes("/preview/");
    }

    private isSpotifyUrl(input: string) {
        return SPOTIFY_URL_RE.test(input.trim());
    }

    private async fetchSpotifyMetadata(url: string): Promise<ExternalTrackMetadata | null> {
        const parts = SPOTIFY_URL_PARTS_RE.exec(url)?.groups;
        if (!parts || parts.type !== "track") return null;

        const token = await this.getSpotifyToken();
        if (!token) return null;

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 3500);
        timeout.unref?.();

        try {
            const response = await fetch(`https://api.spotify.com/v1/tracks/${parts.id}`, {
                headers: { Authorization: `Bearer ${token}` },
                signal: controller.signal,
            });
            if (!response.ok) return null;
            const data = await response.json() as {
                name?: string;
                duration_ms?: number;
                artists?: Array<{ name?: string }>;
            };
            if (!data.name) return null;
            return {
                title: data.name,
                author: data.artists?.map(artist => artist.name).filter(Boolean).join(", "),
                duration: data.duration_ms,
            };
        } catch {
            return null;
        } finally {
            clearTimeout(timeout);
        }
    }

    private async getSpotifyToken() {
        const clientId = process.env.SPOTIFY_CLIENT_ID?.trim();
        const clientSecret = process.env.SPOTIFY_CLIENT_SECRET?.trim();
        if (!clientId || !clientSecret) return null;

        const body = new URLSearchParams();
        body.set("grant_type", "client_credentials");

        const response = await fetch("https://accounts.spotify.com/api/token", {
            method: "POST",
            headers: {
                Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
                "Content-Type": "application/x-www-form-urlencoded",
            },
            body,
        }).catch(() => null);

        if (!response?.ok) return null;
        const data = await response.json() as { access_token?: string };
        return data.access_token ?? null;
    }

    private async fetchSpotifyOEmbedMetadata(url: string): Promise<ExternalTrackMetadata | null> {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 3500);
        timeout.unref?.();

        try {
            const response = await fetch(`https://open.spotify.com/oembed?url=${encodeURIComponent(url)}`, {
                signal: controller.signal,
            });
            if (!response.ok) return null;
            const data = await response.json() as { title?: string };
            if (typeof data.title !== "string" || !data.title.trim()) return null;
            return this.parseSpotifyOEmbedTitle(data.title);
        } catch {
            return null;
        } finally {
            clearTimeout(timeout);
        }
    }

    private parseSpotifyOEmbedTitle(title: string): ExternalTrackMetadata {
        const normalized = title.trim();
        const parts = normalized.split(" - ");
        if (parts.length >= 2) {
            const [trackTitle, ...authorParts] = parts;
            return {
                title: trackTitle.trim(),
                author: authorParts.join(" - ").trim(),
            };
        }
        return { title: normalized };
    }

    private rank(query: string, tracks: Track[], requestedBy: string, metadata: ExternalTrackMetadata | null = null) {
        return tracks
            .map((track, index) => {
                const title = `${track.info.title} ${track.info.author}`;
                const fuzzy = similarity(query, title);
                const authorScore = metadata?.author && title.toLowerCase().includes(metadata.author.toLowerCase()) ? 0.2 : 0;
                const exactTitleScore = metadata?.title && track.info.title.toLowerCase().includes(metadata.title.toLowerCase()) ? 0.2 : 0;
                const durationDiff = metadata?.duration ? Math.abs(track.info.duration - metadata.duration) : null;
                const durationScore = durationDiff == null
                    ? (track.info.duration > 30_000 && track.info.duration < 15 * 60_000 ? 0.08 : 0)
                    : Math.max(0, 0.25 - durationDiff / 120_000);
                const popularityScore = Math.max(0, 0.25 - index * 0.01);
                return {
                    track,
                    stored: trackToStored(track, requestedBy),
                    score: fuzzy + authorScore + exactTitleScore + durationScore + popularityScore,
                };
            })
            .sort((a, b) => b.score - a.score)
            .map(item => item.track);
    }

    private toChoice(track: Track, requestedBy: string, index: number): TrackSearchChoice {
        const stored = trackToStored(track, requestedBy);
        const token = `trk:${Date.now().toString(36)}:${index}:${Math.random().toString(36).slice(2, 8)}`;
        this.cache.set(token, {
            expiresAt: Date.now() + CACHE_TTL_MS,
            track: stored,
            lavalinkTrack: track,
        });
        return {
            token,
            label: this.formatLabel(stored),
            track: stored,
            lavalinkTrack: track,
        };
    }

    private formatLabel(track: StoredTrack) {
        const text = `${track.title}${track.author ? ` - ${track.author}` : ""} (${formatDuration(track.duration)})`;
        return text.length > 100 ? `${text.slice(0, 97)}...` : text;
    }

    private pruneCache() {
        const now = Date.now();
        for (const [key, value] of this.cache) {
            if (value.expiresAt <= now) this.cache.delete(key);
        }
    }

    private withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
        return new Promise(resolve => {
            const timer = setTimeout(() => resolve(fallback), ms);
            timer.unref?.();
            promise
                .then(value => {
                    clearTimeout(timer);
                    resolve(value);
                })
                .catch(() => {
                    clearTimeout(timer);
                    resolve(fallback);
                });
        });
    }
}
