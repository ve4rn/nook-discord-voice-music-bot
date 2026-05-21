import { ContainerBuilder, Guild, MessageFlags, SeparatorSpacingSize, TextChannel } from "discord.js";
import { NO_PING_ALLOWED_MENTIONS } from "../../config/DiscordMentions.js";
import { EventBuilder } from "../../config/EventBuilder.js";
import ConsoleMessage from "../../config/ConsoleMessage.js";
import { env } from "../../config/env.js";
import { privateVoiceManager } from "../../config/PrivateVoiceManager.js";

type GuildLifecycleContext = {
    source?: "emit";
};

async function sendPrivateGuildDeleteLog(
    guild: Guild,
    result: Awaited<ReturnType<typeof privateVoiceManager.deleteGuildData>> | null,
    context?: GuildLifecycleContext,
) {
    const channelId = env.logs.privateLogsChannelId;
    if (!channelId) return;

    const channel = await guild.client.channels.fetch(channelId).catch(() => null);
    if (!channel || !("send" in channel)) return;

    const accentColor = context?.source === "emit" ? 0xF59E0B : 0xEF4444;
    const titleSuffix = context?.source === "emit" ? " (emit)" : "";
    const ownerLabel = guild.ownerId ? `<@${guild.ownerId}>` : "Unknown";
    const iconUrl = guild.iconURL({ extension: "png", size: 256 }) ?? "https://cdn.discordapp.com/embed/avatars/0.png";

    const panel = new ContainerBuilder()
        .setAccentColor(accentColor)
        .addTextDisplayComponents(text => text.setContent(`### Nook just left ${guild.name}${titleSuffix}`))
        .addSeparatorComponents(separator => separator.setDivider(true).setSpacing(SeparatorSpacingSize.Large))
        .addSectionComponents(section =>
            section
                .addTextDisplayComponents(text =>
                    text.setContent(
                        [
                            `- Members : ${guild.memberCount}`,
                            `- Owner : ${ownerLabel}`,
                            result ? `- Cleanup : audioTracks=${result.audioTracks}, audioStates=${result.audioStates}, privateChannels=${result.privateChannels}, privateConfig=${result.privateConfig}` : "- Cleanup : failed",
                        ].join("\n"),
                    ),
                )
                .setThumbnailAccessory(thumbnail =>
                    thumbnail
                        .setURL(iconUrl)
                        .setDescription(guild.name),
                ),
        );

    await (channel as TextChannel).send({
        components: [panel],
        flags: MessageFlags.IsComponentsV2,
        allowedMentions: NO_PING_ALLOWED_MENTIONS,
    }).catch(() => undefined);
}

export default EventBuilder({
    name: "guildDelete",
    description: "Clean up private voice channel data when the guild is deleted",
}, async (guild: Guild, context?: GuildLifecycleContext) => {
    let result: Awaited<ReturnType<typeof privateVoiceManager.deleteGuildData>> | null = null;
    try {
        result = await privateVoiceManager.deleteGuildData(guild.id);
        ConsoleMessage.success(
            `Cleaned DB data for ${guild.name} (${guild.id}) | audioTracks=${result.audioTracks}, audioStates=${result.audioStates}, privateChannels=${result.privateChannels}, privateConfig=${result.privateConfig}.`,
            "GuildDelete",
        );
    } catch (error) {
        ConsoleMessage.error(`Failed to clean DB data for ${guild.name} (${guild.id}).`, "GuildDelete", error);
    }

    await sendPrivateGuildDeleteLog(guild, result, context);
});
