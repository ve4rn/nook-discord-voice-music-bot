import { privateVoiceManager } from "../../config/PrivateVoiceManager.js";
import { audioCommandCopies, defaultAudioCommandCopy } from "./types.js";
import { getAudioUserErrorMessage } from "./AudioErrorMapper.js";
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
    return getAudioUserErrorMessage(copy, error);
}
