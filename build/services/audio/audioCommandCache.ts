import { privateVoiceManager } from "../../config/PrivateVoiceManager.js";
import { audioCommandCopies, defaultAudioCommandCopy } from "./types.js";
import type { AudioCommandCopy, BotLanguage } from "./types.js";

export { defaultAudioCommandCopy } from "./types.js";

function parseLanguage(raw: string | null | undefined): BotLanguage {
    if (raw === "fr" || raw === "es" || raw === "de" || raw === "en") return raw;
    return "en";
}

async function resolveGuildLanguage(guildId: string): Promise<BotLanguage> {
    const hasCachedConfig = privateVoiceManager.guildConfigCache.has(guildId);
    const config = hasCachedConfig
        ? privateVoiceManager.guildConfigCache.get(guildId)
        : await privateVoiceManager.getOrCreateGuildConfig(guildId).catch(() => null);
    return parseLanguage(config?.lang);
}

export async function getAudioLanguage(guildId: string): Promise<BotLanguage> {
    return await resolveGuildLanguage(guildId).catch(() => "en" as BotLanguage);
}

export async function getAudioCommandCopy(guildId: string): Promise<AudioCommandCopy> {
    const language = await getAudioLanguage(guildId);
    return audioCommandCopies[language] ?? defaultAudioCommandCopy;
}

export function getPlayErrorMessage(copy: AudioCommandCopy, error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    if (message === "LAVALINK_NOT_READY") return copy.errors.lavalinkNotReady;
    if (message === "LAVALINK_TIMEOUT") return copy.errors.lavalinkTimeout;
    if (message === "TRACK_NOT_FOUND") return copy.errors.trackNotFound;
    if (message === "QUEUE_LIMIT_REACHED") return copy.errors.queueLimit;
    return copy.errors.genericPlay;
}
