import { EventBuilder } from "../../config/EventBuilder.js";
import { privateVoiceManager } from "../../config/PrivateVoiceManager.js";
import type App from "../../config/App.js";

export default EventBuilder({
    name: "voiceStateUpdate",
    description: "Handle updates to users' voice states for private voice channel management and music control",
}, async (oldState, newState) => {
    await privateVoiceManager.handleVoiceStateUpdate(oldState, newState);
    await (newState.client as App).audio?.handleBotVoiceStateUpdate(oldState, newState);
});
