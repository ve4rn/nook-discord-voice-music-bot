import { ChannelType } from "discord.js";
import { EventBuilder } from "../../config/EventBuilder.js";
import type App from "../../config/App.js";

export default EventBuilder({
  name: "channelUpdate",
  description: "Retry pending resume panels when channel permissions change",
}, async (_oldChannel, newChannel) => {
  if (newChannel.type !== ChannelType.GuildVoice && newChannel.type !== ChannelType.GuildStageVoice) return;
  await (newChannel.client as App).audio?.handleChannelPermissionsUpdate(newChannel.id, newChannel.guild.id);
});
