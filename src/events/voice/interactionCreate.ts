import { EventBuilder } from "../../config/EventBuilder.js";
import { privateVoiceManager } from "../../config/PrivateVoiceManager.js";

export default EventBuilder({
    name: "interactionCreate",
    description: "Handle interactions related to private voice channels",
}, async (interaction) => {
    if (!interaction.isButton() && !interaction.isModalSubmit() && !interaction.isUserSelectMenu()) return;
    await privateVoiceManager.handleInteraction(interaction);
});
