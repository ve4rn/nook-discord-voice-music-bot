import type { Client } from "discord.js";

export async function formatSlashCommandMention(client: Client, commandName: string) {
  const commands = await client.application?.commands.fetch().catch(() => null);
  const command = Array.from(commands?.values() ?? []).find(item => item.name === commandName);
  return command ? `</${commandName}:${command.id}>` : `/${commandName}`;
}
