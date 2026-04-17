import { EventBuilder } from "../../config/EventBuilder.js";
import { handleAudioButton } from "../../services/audio/audioInteractions.js";
import { handleGuildWelcomeLanguageSelect } from "./guildCreate.js";
import { handleSetupButton, handleSetupChannelSelect, handleSetupStringSelect } from "../../commands/public/util/setup.js";
import { handlePlaylistSelect } from "../../commands/public/music/playlist.js";
import { handleImportedPlaylistPageButton, handleImportedPlaylistSelect } from "../../commands/public/music/play.js";

export default EventBuilder({
    name: "interactionCreate",
    description: "Handle interactions related to private voice channels",
}, async (interaction) => {
    if (interaction.isButton()) {
        if (await handleImportedPlaylistPageButton(interaction)) return;
        if (await handleAudioButton(interaction)) return;
        if (await handleSetupButton(interaction)) return;
    } else if (interaction.isStringSelectMenu()) {
        if (await handleImportedPlaylistSelect(interaction)) return;
        if (await handlePlaylistSelect(interaction)) return;
        if (await handleGuildWelcomeLanguageSelect(interaction)) return;
        if (await handleSetupStringSelect(interaction)) return;
    } else if (interaction.isChannelSelectMenu()) {
        await handleSetupChannelSelect(interaction);
    }
});
