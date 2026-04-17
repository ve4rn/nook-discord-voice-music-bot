import { Guild } from "discord.js";
import { EventBuilder } from "../../config/EventBuilder.js";
import ConsoleMessage from "../../config/ConsoleMessage.js";
import { privateVoiceManager } from "../../config/PrivateVoiceManager.js";

export default EventBuilder({
    name: "guildDelete",
    description: "Clean up private voice channel data when the guild is deleted",
}, async (guild: Guild) => {
    try {
        const result = await privateVoiceManager.deleteGuildData(guild.id);
        ConsoleMessage.success(
            `Cleaned DB data for ${guild.name} (${guild.id}) | audioTracks=${result.audioTracks}, audioStates=${result.audioStates}, privateChannels=${result.privateChannels}, privateConfig=${result.privateConfig}.`,
            "GuildDelete",
        );
    } catch (error) {
        ConsoleMessage.error(`Failed to clean DB data for ${guild.name} (${guild.id}).`, "GuildDelete", error);
    }
});
