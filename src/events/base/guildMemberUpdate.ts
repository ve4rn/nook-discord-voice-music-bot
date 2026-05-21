import { EventBuilder } from "../../config/EventBuilder.js";
import type App from "../../config/App.js";

export default EventBuilder({
  name: "guildMemberUpdate",
  description: "Retry pending resume panels when the bot permissions change",
}, async (_oldMember, newMember) => {
  if (newMember.user.id !== newMember.client.user?.id) return;
  await (newMember.client as App).audio?.handleBotGuildMemberPermissionsUpdate(newMember.guild.id);
});
