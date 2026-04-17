import { EventBuilder } from "../../config/EventBuilder.js";
import { privateVoiceManager } from "../../config/PrivateVoiceManager.js";

export default EventBuilder({
    name: "channelDelete",
    description: "Clean up private voice channels when they are deleted",
}, async (channel) => {
    await privateVoiceManager.handleChannelDelete(channel);
});
