import { EventBuilder } from "../../config/EventBuilder.js";
import { handleAudioButton, handleAudioModal, handleAudioSelect } from "../../services/audio/audioInteractions.js";
import { handleGuildWelcomeLanguageSelect } from "./guildCreate.js";
import { handleSetupButton, handleSetupChannelSelect, handleSetupStringSelect } from "../../commands/public/util/setup.js";
import { handleImportedPlaylistPageButton, handleImportedPlaylistSelect } from "../../commands/public/music/play.js";
import { handleTestErrorSelect } from "../../commands/private/base/test.js";

export default EventBuilder({
    name: "interactionCreate",
    description: "Handle interactions related to private voice channels",
}, async (interaction) => {
    if (interaction.isButton()) {
        if (await handleImportedPlaylistPageButton(interaction)) return;
        if (await handleAudioButton(interaction)) return;
        if (await handleSetupButton(interaction)) return;
    } else if (interaction.isStringSelectMenu()) {
        if (await handleAudioSelect(interaction)) return;
        if (await handleImportedPlaylistSelect(interaction)) return;
        if (await handleGuildWelcomeLanguageSelect(interaction)) return;
        if (await handleSetupStringSelect(interaction)) return;
        if (await handleTestErrorSelect(interaction)) return;
    } else if (interaction.isChannelSelectMenu()) {
        await handleSetupChannelSelect(interaction);
    } else if (interaction.isModalSubmit()) {
        if (await handleAudioModal(interaction)) return;
    }
});
