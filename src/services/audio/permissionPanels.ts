import { ContainerBuilder, MessageFlags } from "discord.js";
import { getGuildMessages, type BotLanguage, getMessages } from "../../config/i18n.js";
import { formatDiscordPermissionInline, type PermissionKey } from "../../config/PermissionChecks.js";

export async function buildPermissionIssuePanel(guildId: string | null | undefined, missing: PermissionKey[], voice = false) {
  const messages = guildId ? await getGuildMessages(guildId) : getMessages("en");
  const permissionsInline = formatDiscordPermissionInline(missing);
  const description = voice
    ? messages.common.missingVoicePermissionsDescription.replace("{permissions}", permissionsInline)
    : messages.common.missingPermissionsDescription.replace("{permissions}", permissionsInline);

  return new ContainerBuilder()
    .addTextDisplayComponents(td =>
      td.setContent(
        `### ${messages.common.missingPermissionsTitle}\n${description}`,
      ),
    )
    .addTextDisplayComponents(td =>
      td.setContent(`-# ${messages.common.missingPermissionsListLabel}`),
    );
}

export async function buildPermissionIssuePayload(guildId: string | null | undefined, missing: PermissionKey[], voice = false) {
  return {
    components: [await buildPermissionIssuePanel(guildId, missing, voice)],
    flags: MessageFlags.IsComponentsV2,
  } as const;
}
