import { ButtonInteraction, ChatInputCommandInteraction, GuildMember, MessageFlags, StringSelectMenuInteraction } from "discord.js";
import type App from "../../config/App.js";
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
