import { ButtonInteraction, ChannelType, ChatInputCommandInteraction, GuildMember, MessageFlags, StringSelectMenuInteraction } from "discord.js";
import type App from "../../config/App.js";
import { privateVoiceManager } from "../../config/PrivateVoiceManager.js";
import { checkCanUseVoiceForAudio, formatPermissionList, type PermissionLanguage } from "../../config/PermissionChecks.js";
import { defaultAudioCommandCopy, getAudioCommandCopy } from "./audioCommandCache.js";
import type { AudioCommandCopy } from "./types.js";

type MusicInteraction = ChatInputCommandInteraction | ButtonInteraction | StringSelectMenuInteraction;

function getMemberVoiceChannelId(interaction: MusicInteraction) {
    const cachedMember = interaction.guild?.members.cache.get(interaction.user.id);
    if (cachedMember) return cachedMember.voice.channelId;

    const member = interaction.member;
    if (member instanceof GuildMember) return member.voice.channelId;

    return null;
}

function getActiveBotVoiceChannelId(interaction: MusicInteraction, app: App) {
    if (!interaction.guildId) return null;

    const playerVoiceChannelId = app.audio?.getPlayerVoiceChannelId(interaction.guildId) ?? null;
    const botVoiceChannelId = interaction.guild?.members.me?.voice.channelId ?? null;
    if (!playerVoiceChannelId || !botVoiceChannelId) return null;

    return playerVoiceChannelId === botVoiceChannelId ? botVoiceChannelId : null;
}

async function replyBlocked(interaction: MusicInteraction, content: string) {
    await interaction.reply({
        content,
        flags: MessageFlags.Ephemeral,
    });
}

function parsePermissionLanguage(language: string | null | undefined): PermissionLanguage {
    if (language === "fr" || language === "es" || language === "de" || language === "en") return language;
    return "fr";
}

function missingAudioVoicePermissionsMessage(language: PermissionLanguage, permissions: string) {
    if (language === "en") {
        return `I cannot join your voice channel because I am missing permissions:\n${permissions}`;
    }
    if (language === "es") {
        return `No puedo unirme a tu canal de voz porque me faltan permisos:\n${permissions}`;
    }
    if (language === "de") {
        return `Ich kann deinem Sprachkanal nicht beitreten, weil mir Berechtigungen fehlen:\n${permissions}`;
    }
    return `Je ne peux pas rejoindre votre salon vocal car il me manque des permissions:\n${permissions}`;
}

async function ensureBotCanUseVoice(interaction: MusicInteraction, voiceChannelId: string) {
    if (!interaction.guildId || !interaction.guild) return true;

    const channel = interaction.guild.channels.cache.get(voiceChannelId)
        ?? await interaction.guild.channels.fetch(voiceChannelId).catch(() => null);
    if (!channel || (channel.type !== ChannelType.GuildVoice && channel.type !== ChannelType.GuildStageVoice)) return true;

    const check = checkCanUseVoiceForAudio(channel);
    if (check.ok) return true;

    const config = await privateVoiceManager.getOrCreateGuildConfig(interaction.guildId).catch(() => null);
    const language = parsePermissionLanguage(config?.lang);
    await replyBlocked(interaction, missingAudioVoicePermissionsMessage(language, formatPermissionList(language, check.missing)));
    return false;
}

async function getCopy(interaction: MusicInteraction): Promise<AudioCommandCopy> {
    if (!interaction.guildId) return defaultAudioCommandCopy;
    return await getAudioCommandCopy(interaction.guildId).catch(() => defaultAudioCommandCopy);
}

export async function requireJoinVoice(interaction: MusicInteraction, app: App) {
    const copy = await getCopy(interaction);
    const userVoiceChannelId = getMemberVoiceChannelId(interaction);
    if (!userVoiceChannelId) {
        await replyBlocked(interaction, copy.voice.joinVoice);
        return null;
    }

    const botVoiceChannelId = interaction.guildId ? app.audio?.getPlayerVoiceChannelId(interaction.guildId) : null;
    if (botVoiceChannelId) {
        await replyBlocked(interaction, copy.voice.botAlreadyConnected);
        return null;
    }

    if (!await ensureBotCanUseVoice(interaction, userVoiceChannelId)) return null;
    return userVoiceChannelId;
}

export async function requirePlayableVoice(interaction: MusicInteraction, app: App) {
    const copy = await getCopy(interaction);
    const userVoiceChannelId = getMemberVoiceChannelId(interaction);
    if (!userVoiceChannelId) {
        await replyBlocked(interaction, copy.voice.joinVoiceForMusic);
        return null;
    }

    const botVoiceChannelId = interaction.guildId ? app.audio?.getPlayerVoiceChannelId(interaction.guildId) : null;
    if (botVoiceChannelId && botVoiceChannelId !== userVoiceChannelId) {
        await replyBlocked(interaction, copy.voice.mustBeInBotVoiceForMusic);
        return null;
    }

    if (!botVoiceChannelId && !await ensureBotCanUseVoice(interaction, userVoiceChannelId)) return null;
    return userVoiceChannelId;
}

export async function requireControlVoice(interaction: MusicInteraction, app: App) {
    const copy = await getCopy(interaction);
    const userVoiceChannelId = getMemberVoiceChannelId(interaction);
    if (!userVoiceChannelId) {
        await replyBlocked(interaction, copy.voice.joinBotVoiceForControl);
        return null;
    }

    const botVoiceChannelId = getActiveBotVoiceChannelId(interaction, app);
    if (!botVoiceChannelId) {
        await replyBlocked(interaction, copy.voice.noActivePlayer);
        return null;
    }

    if (botVoiceChannelId !== userVoiceChannelId) {
        await replyBlocked(interaction, copy.voice.mustBeInBotVoiceForControl);
        return null;
    }

    return userVoiceChannelId;
}
