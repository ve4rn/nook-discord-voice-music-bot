import type { LavalinkManager, SearchPlatform, Track } from "lavalink-client";
import { formatDuration, StoredTrack, TrackSearchChoice, trackToStored } from "./types.js";
import type { AudioPlaylistConfig, PlaylistTrackConfig } from "./playlists.js";
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

type SpotifyTokenCache = {
    accessToken: string;
    expiresAt: number;
};

type SpotifyTrackResponse = {
    name?: string;
    duration_ms?: number;
    artists?: Array<{ name?: string }>;
};

type DeezerPlaylistResponse = {
    title?: string;
    tracks?: {
        data?: DeezerTrack[];
        next?: string | null;
    };
    error?: DeezerApiError;
};

type DeezerTrackPageResponse = {
    data?: DeezerTrack[];
    next?: string | null;
    error?: DeezerApiError;
};

type DeezerApiError = {
    type?: string;
    message?: string;
    code?: number;
};

type DeezerTrack = {
    id?: number | string;
    title?: string;
    duration?: number;
    link?: string;
    artist?: {
        name?: string;
    };
    album?: {
        cover_medium?: string;
        cover_big?: string;
    };
};

type DeezerTrackResponse = DeezerTrack & {
    error?: DeezerApiError;
};

const CACHE_TTL_MS = 5 * 60 * 1000;
const AUTOCOMPLETE_TIMEOUT_MS = 2_000;
const SEARCH_SOURCES: SearchPlatform[] = ["scsearch", "ytsearch"];
const SPOTIFY_URL_RE = /^https?:\/\/open\.spotify\.com\/(intl-[a-z]{2}\/)?(track|album|playlist|episode|show)\/[A-Za-z0-9]+/i;
const SPOTIFY_URL_PARTS_RE = /^https?:\/\/open\.spotify\.com\/(?:intl-[a-z]{2}\/)?(?<type>track|album|playlist|episode|show)\/(?<id>[A-Za-z0-9]+)/i;
const YOUTUBE_PLAYLIST_URL_RE = /^https?:\/\/(?:www\.|m\.|music\.)?(?:youtube\.com|youtu\.be)\/(?:playlist\?list=|watch\?.*?[?&]list=|.*?[?&]list=)[A-Za-z0-9_-]+/i;
const SPOTIFY_PLAYLIST_URL_RE = /^https?:\/\/open\.spotify\.com\/(?:intl-[a-z]{2}\/)?(?:user\/[A-Za-z0-9_-]+\/)?playlist\/[A-Za-z0-9]+/i;
const SOUNDCLOUD_PLAYLIST_URL_RE = /^https?:\/\/(?:www\.)?soundcloud\.com\/[^/]+\/sets\/[^/?#]+/i;
const DEEZER_PLAYLIST_URL_RE = /^https?:\/\/(?:www\.)?deezer\.com\/(?:[a-z]{2}\/)?playlist\/\d+/i;
const DEEZER_PLAYLIST_ID_RE = /^https?:\/\/(?:www\.)?deezer\.com\/(?:[a-z]{2}\/)?playlist\/(?<id>\d+)/i;
const DEEZER_TRACK_URL_RE = /^https?:\/\/(?:www\.)?deezer\.com\/(?:[a-z]{2}\/)?track\/\d+/i;
const DEEZER_TRACK_ID_RE = /^https?:\/\/(?:www\.)?deezer\.com\/(?:[a-z]{2}\/)?track\/(?<id>\d+)/i;
const DEEZER_SHORT_LINK_RE = /^https?:\/\/(?:link\.deezer\.com\/s\/|deezer\.page\.link\/)\S+/i;
const DEEZER_API_BASE_URL = "https://api.deezer.com";

export class TrackSearchService {
    private readonly cache = new Map<string, CachedTrack>();
    private deezerAccessTokenInvalid = false;
    private spotifyApiUnavailable = false;
    private spotifyTokenCache: SpotifyTokenCache | null = null;

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

    isSupportedPlaylistUrl(input: string) {
        const url = input.trim();
        return YOUTUBE_PLAYLIST_URL_RE.test(url)
            || SPOTIFY_PLAYLIST_URL_RE.test(url)
            || SOUNDCLOUD_PLAYLIST_URL_RE.test(url)
            || DEEZER_PLAYLIST_URL_RE.test(url);
    }

    isSpotifyPlaylistUrl(input: string) {
        return SPOTIFY_PLAYLIST_URL_RE.test(this.normalizePlaylistUrlForImport(input.trim()));
    }

    async resolvePlaylistImportUrl(input: string): Promise<string | null> {
        const normalizedUrl = this.normalizePlaylistUrlForImport(input.trim());
        if (YOUTUBE_PLAYLIST_URL_RE.test(normalizedUrl)
            || SPOTIFY_PLAYLIST_URL_RE.test(normalizedUrl)
            || SOUNDCLOUD_PLAYLIST_URL_RE.test(normalizedUrl)
            || DEEZER_PLAYLIST_URL_RE.test(normalizedUrl)) {
            return normalizedUrl;
        }

        if (!DEEZER_SHORT_LINK_RE.test(normalizedUrl)) return null;

        const resolvedUrl = await this.resolveDeezerShortUrl(normalizedUrl);
        if (!resolvedUrl) return null;

        const normalizedResolvedUrl = this.normalizePlaylistUrlForImport(resolvedUrl);
        if (DEEZER_PLAYLIST_URL_RE.test(normalizedResolvedUrl)) return normalizedResolvedUrl;

        return null;
    }

    async importPlaylistUrl(input: string, requestedBy: string, limit = 25): Promise<AudioPlaylistConfig | null> {
        const url = input.trim();
        if (!this.manager.useable) return null;
        const normalizedUrl = await this.resolvePlaylistImportUrl(url);
        if (!normalizedUrl) return null;

        if (SPOTIFY_PLAYLIST_URL_RE.test(normalizedUrl)) {
            return null;
        }

        if (DEEZER_PLAYLIST_URL_RE.test(normalizedUrl)) {
            const deezerPlaylist = await this.importDeezerPlaylistUrl(normalizedUrl, limit);
            if (deezerPlaylist) return deezerPlaylist;

            return await this.importLavalinkPlaylistUrl(normalizedUrl, requestedBy, limit, url);
        }

        const lavalinkPlaylist = await this.importLavalinkPlaylistUrl(normalizedUrl, requestedBy, limit, url);
        if (lavalinkPlaylist) return lavalinkPlaylist;

        return null;
    }

    private async importLavalinkPlaylistUrl(url: string, requestedBy: string, limit: number, originalUrl = url): Promise<AudioPlaylistConfig | null> {
        const node = this.manager.nodeManager.leastUsedNodes("memory")[0];
        if (!node) return null;

        const queries = Array.from(new Set([url, originalUrl].filter(Boolean)));
        for (const query of queries) {
            const result = await node.search({ query }, { id: requestedBy }).catch(() => null);
            const tracks = result?.tracks
                ?.filter(track => this.isPlayableTrack(track))
                .slice(0, Math.max(1, limit))
                .map((track, index) => this.toPlaylistTrack(track, requestedBy, index)) ?? [];
            if (tracks.length === 0) continue;

            return {
                id: `import-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
                name: result?.playlist?.name || result?.playlist?.title || this.playlistNameFromUrl(url),
                description: result?.playlist?.author || undefined,
                tracks,
            };
        }

        return null;
    }

    private async search(query: string, requestedBy: string) {
        const deezerMetadata = await this.fetchDeezerTrackMetadata(query);
        if (deezerMetadata) {
            const rankQuery = [deezerMetadata.author, deezerMetadata.title].filter(Boolean).join(" ");
            return { rankQuery, tracks: await this.searchRaw(rankQuery, requestedBy), metadata: deezerMetadata };
        }

        if (!this.isSpotifyUrl(query)) {
            return { rankQuery: query, tracks: await this.searchRaw(query, requestedBy), metadata: null };
        }

        const metadata = await this.fetchSpotifyApiTrackMetadata(query)
            ?? await this.fetchSpotifyOEmbedMetadata(query);
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

    private async fetchSpotifyApiTrackMetadata(url: string): Promise<ExternalTrackMetadata | null> {
        const parts = SPOTIFY_URL_PARTS_RE.exec(url)?.groups;
        if (!parts || parts.type !== "track") return null;

        const token = await this.getSpotifyAccessToken();
        if (!token) return null;

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 3500);
        timeout.unref?.();

        const response = await fetch(`https://api.spotify.com/v1/tracks/${parts.id}`, {
            headers: { Authorization: `Bearer ${token}` },
            signal: controller.signal,
        }).catch(() => null);
        clearTimeout(timeout);

        if (!response) return null;

        if (response.status === 401 || response.status === 403) {
            this.spotifyApiUnavailable = true;
            this.spotifyTokenCache = null;
            return null;
        }

        if (!response.ok) return null;

        const data = await response.json().catch(() => null) as SpotifyTrackResponse | null;
        if (!data?.name) return null;

        return {
            title: data.name,
            author: data.artists?.map(artist => artist.name).filter(Boolean).join(", "),
            duration: data.duration_ms,
        };
    }

    private async getSpotifyAccessToken() {
        if (this.spotifyApiUnavailable) return null;

        const cached = this.spotifyTokenCache;
        if (cached && cached.expiresAt > Date.now()) return cached.accessToken;

        const clientId = process.env.SPOTIFY_CLIENT_ID?.trim();
        const clientSecret = process.env.SPOTIFY_CLIENT_SECRET?.trim();
        if (!clientId || !clientSecret) {
            this.spotifyApiUnavailable = true;
            return null;
        }

        const body = new URLSearchParams();
        body.set("grant_type", "client_credentials");

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 3500);
        timeout.unref?.();

        const response = await fetch("https://accounts.spotify.com/api/token", {
            method: "POST",
            headers: {
                Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
                "Content-Type": "application/x-www-form-urlencoded",
            },
            body,
            signal: controller.signal,
        }).catch(() => null);
        clearTimeout(timeout);

        if (!response) return null;

        if (response.status === 400 || response.status === 401 || response.status === 403) {
            this.spotifyApiUnavailable = true;
            this.spotifyTokenCache = null;
            return null;
        }

        if (!response.ok) return null;

        const data = await response.json().catch(() => null) as { access_token?: string; expires_in?: number } | null;
        if (!data?.access_token) {
            this.spotifyApiUnavailable = true;
            return null;
        }

        const expiresInMs = Math.max(60, data.expires_in ?? 3600) * 1000;
        this.spotifyTokenCache = {
            accessToken: data.access_token,
            expiresAt: Date.now() + expiresInMs - 30_000,
        };
        return data.access_token;
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

    private async fetchDeezerTrackMetadata(input: string): Promise<ExternalTrackMetadata | null> {
        const url = await this.resolveDeezerTrackUrl(input);
        if (!url) return null;

        const trackId = DEEZER_TRACK_ID_RE.exec(url)?.groups?.id;
        if (!trackId) return null;

        const track = await this.fetchDeezerJson<DeezerTrackResponse>(`/track/${trackId}`);
        if (!track?.title) return null;

        return {
            title: track.title,
            author: track.artist?.name,
            duration: track.duration ? track.duration * 1000 : undefined,
        };
    }

    private async resolveDeezerTrackUrl(input: string): Promise<string | null> {
        const normalizedUrl = this.normalizePlaylistUrlForImport(input.trim());
        if (DEEZER_TRACK_URL_RE.test(normalizedUrl)) return normalizedUrl;
        if (!DEEZER_SHORT_LINK_RE.test(normalizedUrl)) return null;

        const resolvedUrl = await this.resolveDeezerShortUrl(normalizedUrl);
        if (!resolvedUrl) return null;

        const normalizedResolvedUrl = this.normalizePlaylistUrlForImport(resolvedUrl);
        return DEEZER_TRACK_URL_RE.test(normalizedResolvedUrl) ? normalizedResolvedUrl : null;
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

    private toPlaylistTrack(track: Track, requestedBy: string, index: number): PlaylistTrackConfig {
        const stored = trackToStored(track, requestedBy);
        const stableKey = (stored.identifier || stored.encoded || stored.url || stored.title)
            .replace(/[^a-zA-Z0-9_-]/g, "")
            .slice(0, 70) || "track";
        return {
            id: `imported-${index + 1}-${stableKey}`,
            title: stored.title,
            author: stored.author || "",
            duration: stored.duration,
            encoded: stored.encoded,
            query: stored.url || [stored.author, stored.title].filter(Boolean).join(" "),
            url: stored.url,
            source: stored.source,
            identifier: stored.identifier,
            artworkUrl: stored.artworkUrl,
            isStream: stored.isStream,
        };
    }

    private async importDeezerPlaylistUrl(url: string, limit: number): Promise<AudioPlaylistConfig | null> {
        const playlistId = await this.resolveDeezerPlaylistId(url);
        if (!playlistId) return null;

        const playlist = await this.fetchDeezerJson<DeezerPlaylistResponse>(`/playlist/${playlistId}`);
        if (!playlist) return null;

        const firstTracks = playlist?.tracks?.data ?? [];
        const tracks = [...firstTracks];
        let nextUrl = playlist?.tracks?.next ?? null;

        while (nextUrl && tracks.length < limit) {
            const page = await this.fetchDeezerJson<DeezerTrackPageResponse>(nextUrl);
            const pageTracks = page?.data ?? [];
            if (pageTracks.length === 0) break;
            tracks.push(...pageTracks);
            nextUrl = page?.next ?? null;
        }

        const mappedTracks = tracks
            .slice(0, Math.max(1, limit))
            .map((track, index) => this.deezerTrackToPlaylistTrack(track, index))
            .filter((track): track is PlaylistTrackConfig => Boolean(track));
        if (mappedTracks.length === 0) return null;

        return {
            id: `import-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
            name: playlist?.title || "Deezer",
            tracks: mappedTracks,
        };
    }

    private async resolveDeezerPlaylistId(url: string): Promise<string | null> {
        const directId = DEEZER_PLAYLIST_ID_RE.exec(url)?.groups?.id;
        if (directId) return directId;

        if (!DEEZER_SHORT_LINK_RE.test(url)) return null;
        const resolvedUrl = await this.resolveDeezerShortUrl(url);
        return resolvedUrl ? DEEZER_PLAYLIST_ID_RE.exec(resolvedUrl)?.groups?.id ?? null : null;
    }

    private async resolveDeezerShortUrl(url: string): Promise<string | null> {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 1800);
        timeout.unref?.();

        try {
            const response = await fetch(url, { signal: controller.signal });
            if (response.url && response.url !== url) {
                return response.url;
            }

            const html = await response.text().catch(() => "");
            const canonicalUrl = this.extractDeezerCanonicalUrl(html);
            if (canonicalUrl) return canonicalUrl;

            return response.url || null;
        } catch {
            return null;
        } finally {
            clearTimeout(timeout);
        }
    }

    private extractDeezerCanonicalUrl(text: string) {
        const normalized = text
            .replace(/\\\//g, "/")
            .replace(/\\u002F/g, "/")
            .replace(/&amp;/g, "&");
        const direct = /https?:\/\/(?:www\.)?deezer\.com\/(?:[a-z]{2}\/)?(?:playlist|track|album)\/\d+/i.exec(normalized)?.[0];
        if (direct) return direct;

        const scheme = /deezer:\/\/(?:www\.)?deezer\.com\/(?:[a-z]{2}\/)?(?<type>playlist|track|album)\/(?<id>\d+)/i.exec(normalized)?.groups;
        return scheme ? `https://www.deezer.com/${scheme.type}/${scheme.id}` : null;
    }

    private deezerTrackToPlaylistTrack(track: DeezerTrack, index: number): PlaylistTrackConfig | null {
        const title = track.title?.trim();
        if (!title) return null;

        const author = track.artist?.name?.trim() ?? "";
        const duration = Math.max(0, Math.floor(track.duration ?? 0) * 1000);
        const query = [author, title].filter(Boolean).join(" ");
        return {
            id: `deezer-${track.id ?? index + 1}`,
            title,
            author,
            duration,
            query,
            url: track.link,
            source: "deezer",
            identifier: track.id ? String(track.id) : undefined,
            artworkUrl: track.album?.cover_big ?? track.album?.cover_medium,
            isStream: false,
        };
    }

    private async fetchDeezerJson<T extends { error?: DeezerApiError }>(pathOrUrl: string): Promise<T | null> {
        const url = this.buildDeezerApiUrl(pathOrUrl);
        const data = await this.fetchJson<T>(url);
        if (!data) return null;

        if (data.error) {
            if (this.isInvalidDeezerAccessTokenError(data.error) && this.hasDeezerAccessToken() && !this.deezerAccessTokenInvalid) {
                this.deezerAccessTokenInvalid = true;

                const publicUrl = this.buildDeezerApiUrl(pathOrUrl, false);
                const publicData = await this.fetchJson<T>(publicUrl);
                if (!publicData) return null;
                if (publicData.error) return null;
                return publicData;
            }
            return null;
        }

        return data;
    }

    private buildDeezerApiUrl(pathOrUrl: string, includeToken = true) {
        const base = DEEZER_API_BASE_URL.replace(/\/+$/g, "");
        const rawUrl = /^https?:\/\//i.test(pathOrUrl)
            ? pathOrUrl
            : `${base}/${pathOrUrl.replace(/^\/+/g, "")}`;
        const url = new URL(rawUrl);
        const token = includeToken && !this.deezerAccessTokenInvalid
            ? process.env.DEEZER_ACCESS_TOKEN?.trim()
            : "";
        if (token && !url.searchParams.has("access_token")) {
            url.searchParams.set("access_token", token);
        }
        return url.toString();
    }

    private hasDeezerAccessToken() {
        return Boolean(process.env.DEEZER_ACCESS_TOKEN?.trim());
    }

    private isInvalidDeezerAccessTokenError(error: DeezerApiError) {
        return error.code === 300 || error.message?.toLowerCase().includes("invalid oauth access token");
    }

    private async fetchJson<T>(url: string, init?: RequestInit): Promise<T | null> {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);
        timeout.unref?.();

        try {
            const response = await fetch(url, { ...init, signal: controller.signal });
            if (!response.ok) return null;
            return await response.json() as T;
        } catch {
            return null;
        } finally {
            clearTimeout(timeout);
        }
    }

    private playlistNameFromUrl(url: string) {
        try {
            const parsed = new URL(url);
            if (parsed.hostname.includes("spotify")) return "Spotify";
            if (parsed.hostname.includes("soundcloud")) return "SoundCloud";
            if (parsed.hostname.includes("youtube") || parsed.hostname.includes("youtu.be")) return "YouTube";
            if (parsed.hostname.includes("deezer")) return "Deezer";
        } catch { }
        return "Playlist importee";
    }

    private normalizePlaylistUrlForImport(input: string) {
        const url = input.trim();
        try {
            const parsed = new URL(url);
            if (parsed.hostname.includes("spotify")) {
                parsed.search = "";
                parsed.hash = "";
                return parsed.toString();
            }

            if (parsed.hostname.includes("soundcloud")) {
                parsed.search = "";
                parsed.hash = "";
                return parsed.toString();
            }

            if (parsed.hostname.includes("deezer") && !DEEZER_SHORT_LINK_RE.test(url)) {
                parsed.search = "";
                parsed.hash = "";
                return parsed.toString();
            }

            if (parsed.hostname.includes("youtube") || parsed.hostname.includes("youtu.be")) {
                const listId = parsed.searchParams.get("list");
                if (!listId) return url;
                return `https://www.youtube.com/playlist?list=${encodeURIComponent(listId)}`;
            }
        } catch { }
        return url;
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
