import type { Track } from "lavalink-client";
import { getTrackEmojiMention } from "../config/DiscordEmojis.js";

export const MAX_AUDIO_QUEUE_SIZE = 10;
export const PLAYLIST_LAUNCH_LIMIT = 10;

export type AudioSessionState = "idle" | "active" | "stopped";

export function getAudioQueueSize(state: { current?: unknown | null; currentTrack?: unknown | null; queue: unknown[] }) {
  return state.queue.length + (state.current || state.currentTrack ? 1 : 0);
}

export function getAudioQueueAvailableSlots(state: { current?: unknown | null; currentTrack?: unknown | null; queue: unknown[] }) {
  return Math.max(0, MAX_AUDIO_QUEUE_SIZE - getAudioQueueSize(state));
}

export type StoredTrack = {
  title: string;
  url: string;
  duration: number;
  requestedBy: string;
  source?: string;
  metadataSource?: string;
  audioSource?: string;
  author?: string;
  encoded?: string;
  identifier?: string;
  isrc?: string;
  artworkUrl?: string | null;
  isStream?: boolean;
};

export type TrackRequest = {
  guildId: string;
  voiceChannelId: string;
  textChannelId: string;
  query: string;
  requestedBy: string;
};

export type PlaybackContext = {
  guildId: string;
  voiceChannelId: string;
  textChannelId: string;
  requestedBy: string;
};

export type QueueSnapshot = {
  current: StoredTrack | null;
  previous: StoredTrack | null;
  queue: StoredTrack[];
  isPaused: boolean;
  isPlaying: boolean;
  positionMs: number;
  sessionState: AudioSessionState;
  voiceChannelId: string | null;
  textChannelId: string | null;
  lastVoiceChannelId: string | null;
  lastTextChannelId: string | null;
};

export type TrackSearchChoice = {
  token: string;
  label: string;
  track: StoredTrack;
  lavalinkTrack?: Track;
};

type NookDisplayTrackData = Partial<StoredTrack> & {
  audioSource?: string;
};

export function trackToStored(track: Track, requestedBy: string): StoredTrack {
  const display = (track as Track & { __nookDisplay?: NookDisplayTrackData }).__nookDisplay;
  return {
    title: display?.title ?? track.info.title,
    url: display?.url ?? track.info.uri,
    duration: display?.duration ?? track.info.duration,
    requestedBy,
    source: display?.source ?? track.info.sourceName,
    metadataSource: display?.metadataSource,
    audioSource: display?.audioSource ?? track.info.sourceName,
    author: display?.author ?? track.info.author,
    encoded: track.encoded,
    identifier: display?.identifier ?? track.info.identifier,
    isrc: display?.isrc,
    artworkUrl: display?.artworkUrl ?? track.info.artworkUrl,
    isStream: display?.isStream ?? track.info.isStream,
  };
}

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "live";
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function getTrackDisplayAuthor(track: StoredTrack, fallback: string) {
  return track.author?.trim() || fallback;
}

export function formatTrackSummary(track: StoredTrack, unknownAuthor: string) {
  const author = getTrackDisplayAuthor(track, unknownAuthor);
  return `**${track.title}**\n> ${author}\n> ${formatDuration(track.duration)}`;
}

export function getStoredTrackKey(track: StoredTrack): string {
  const rawKey = track.identifier || track.encoded || track.url || track.title;
  return rawKey.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 48) || "track";
}

export function formatProgress(positionMs: number, durationMs: number): string {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return "live";

  const safePosition = Math.min(Math.max(0, positionMs), durationMs);
  const rawSegment = durationMs === 0 ? 0 : Math.min(6, Math.floor((safePosition / durationMs) * 7));

  const segments = Array.from({ length: 7 }, (_, index) => {
    if (index === 0) return rawSegment === 0 ? getTrackEmojiMention("track1") : getTrackEmojiMention("track6");
    if (index === 6) return rawSegment === 6 ? getTrackEmojiMention("track3") : getTrackEmojiMention("track5");
    if (index < rawSegment) return getTrackEmojiMention("track7");
    if (index === rawSegment) return getTrackEmojiMention("track2");
    return getTrackEmojiMention("track4");
  });

  return segments.join("");
}
