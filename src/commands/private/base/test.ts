import { ActionRowBuilder, MessageFlags, PermissionFlagsBits, StringSelectMenuBuilder, type StringSelectMenuInteraction } from "discord.js";
import { CommandBuilder } from "../../../config/CommandBuilder.js";
import { NO_PING_ALLOWED_MENTIONS } from "../../../config/DiscordMentions.js";
import { requireComponentReplyPermissions, requireTextReplyPermissions } from "../../../config/CommandPermissionGuards.js";
import { getGuildMessages, getMessages } from "../../../config/i18n.js";
import { NookBuilder } from "../../../config/NookBuilder.js";
import { getAudioCommandCopy } from "../../../services/audio/audioCommandCache.js";
import { buildNeutralNoticePanel } from "../../../services/audio/audioPanel.js";
import { buildPermissionIssuePanel } from "../../../services/audio/permissionPanels.js";

const TEST_ERROR_PREFIX = "test:error";

type TestErrorKey =
    | "permission_text"
    | "permission_components"
    | "permission_voice"
    | "audio_lavalink_not_ready"
    | "audio_lavalink_timeout"
    | "audio_track_not_found"
    | "audio_queue_limit"
    | "audio_generic";

function testErrorCustomId(guildId: string, userId: string) {
    return `${TEST_ERROR_PREFIX}:${guildId}:${userId}`;
}

function parseTestErrorCustomId(customId: string) {
    const [prefix, action, guildId, userId] = customId.split(":");
    if (`${prefix}:${action}` !== TEST_ERROR_PREFIX || !guildId || !userId) return null;
    return { guildId, userId };
}

async function buildTestErrorPanel(guildId: string, key: TestErrorKey) {
    const copy = await getAudioCommandCopy(guildId);

    switch (key) {
        case "permission_text":
            return buildPermissionIssuePanel(guildId, ["ViewChannel", "SendMessages"]);
        case "permission_components":
            return buildPermissionIssuePanel(guildId, ["ViewChannel", "SendMessages", "EmbedLinks"]);
        case "permission_voice":
            return buildPermissionIssuePanel(guildId, ["Connect", "Speak"], true);
        case "audio_lavalink_not_ready":
            return buildNeutralNoticePanel(guildId, copy.errors.lavalinkNotReady);
        case "audio_lavalink_timeout":
            return buildNeutralNoticePanel(guildId, copy.errors.lavalinkTimeout);
        case "audio_track_not_found":
            return buildNeutralNoticePanel(guildId, copy.errors.trackNotFound);
        case "audio_queue_limit":
            return buildNeutralNoticePanel(guildId, copy.errors.queueLimit);
        case "audio_generic":
        default:
            return buildNeutralNoticePanel(guildId, copy.errors.genericPlay);
    }
}

async function buildTestErrorSelect(guildId: string, userId: string, selected: TestErrorKey) {
    const messages = await getGuildMessages(guildId);
    return new StringSelectMenuBuilder()
        .setCustomId(testErrorCustomId(guildId, userId))
        .setPlaceholder("Choisis un container d'erreur")
        .setMinValues(1)
        .setMaxValues(1)
        .addOptions([
            { label: "Permissions texte", value: "permission_text", default: selected === "permission_text", description: "Absence des permissions pour envoyer du texte" },
            { label: "Permissions composants", value: "permission_components", default: selected === "permission_components", description: "Absence des permissions pour envoyer des composants" },
            { label: "Permissions vocales", value: "permission_voice", default: selected === "permission_voice", description: "Absence des permissions audio dans un salon vocal" },
            { label: "Lavalink indisponible", value: "audio_lavalink_not_ready", default: selected === "audio_lavalink_not_ready", description: messages.music.lavalinkNotReady.slice(0, 100) },
            { label: "Timeout Lavalink", value: "audio_lavalink_timeout", default: selected === "audio_lavalink_timeout", description: messages.music.lavalinkTimeout.slice(0, 100) },
            { label: "Track introuvable", value: "audio_track_not_found", default: selected === "audio_track_not_found", description: messages.music.trackNotFound.slice(0, 100) },
            { label: "Queue pleine", value: "audio_queue_limit", default: selected === "audio_queue_limit", description: messages.music.queueLimit.slice(0, 100) },
            { label: "Erreur generique", value: "audio_generic", default: selected === "audio_generic", description: messages.music.genericPlayError.slice(0, 100) },
        ]);
}

async function buildTestErrorComponents(guildId: string, userId: string, selected: TestErrorKey) {
    const panel = await buildTestErrorPanel(guildId, selected);
    const select = await buildTestErrorSelect(guildId, userId, selected);
    return [
        panel,
        new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select),
    ];
}

export async function handleTestErrorSelect(interaction: StringSelectMenuInteraction) {
    const parsed = parseTestErrorCustomId(interaction.customId);
    if (!parsed) return false;

    if (!interaction.guildId || interaction.guildId !== parsed.guildId) {
        await interaction.reply({
            content: getMessages("en").common.menuMismatch,
            flags: MessageFlags.Ephemeral,
        });
        return true;
    }

    if (interaction.user.id !== parsed.userId) {
        await interaction.reply({
            content: getMessages("en").common.ownerOnly,
            flags: MessageFlags.Ephemeral,
        });
        return true;
    }

    if (!await requireTextReplyPermissions(interaction)) return true;
    if (!await requireComponentReplyPermissions(interaction)) return true;

    const selected = interaction.values[0] as TestErrorKey;
    await interaction.update({
        components: await buildTestErrorComponents(interaction.guildId, interaction.user.id, selected),
        flags: MessageFlags.IsComponentsV2,
        allowedMentions: NO_PING_ALLOWED_MENTIONS,
    });
    return true;
}

export default CommandBuilder({
    name: "test",
    description: "Trigger internal guild lifecycle events for the current server",
    description_localizations: {
        fr: "Declenche les evenements internes de cycle de vie de la guilde courante",
        de: "Loest interne Guild-Lifecycle-Events fuer diesen Server aus",
        "es-ES": "Dispara eventos internos del ciclo de vida del servidor actual",
    },
    permissions: [PermissionFlagsBits.Administrator],
    cooldown: 2,
    args: [
        {
            name: "guildcreate",
            description: "Emit guildCreate for this guild",
            type: "Subcommand",
        },
        {
            name: "guilddelete",
            description: "Emit guildDelete for this guild",
            type: "Subcommand",
        },
        {
            name: "errors",
            description: "Preview error containers with a select menu",
            type: "Subcommand",
        },
    ],
}, async (interaction, app) => {
    if (!interaction.guild) {
        await interaction.reply({
            content: "This command can only be used in a server.",
            flags: MessageFlags.Ephemeral,
        });
        return;
    }
    const guild = interaction.guild;

    if (!await requireTextReplyPermissions(interaction)) return;
    if (!await requireComponentReplyPermissions(interaction)) return;

    const subcommand = interaction.options.getSubcommand(true);
    if (subcommand === "errors") {
        await interaction.reply({
            components: await buildTestErrorComponents(guild.id, interaction.user.id, "permission_text"),
            flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
            allowedMentions: NO_PING_ALLOWED_MENTIONS,
        });
        return;
    }

    const eventName = subcommand === "guilddelete" ? "guildDelete" : "guildCreate";

    (app.emit as (event: string, ...args: unknown[]) => boolean)(eventName, guild, { source: "emit" });

    const panel = new NookBuilder()
        .addTextDisplayComponents(text =>
            text.setContent("## Test Event"),
        )
        .addTextDisplayComponents(text =>
            text.setContent(
                [
                    `**Event**: \`${eventName}\``,
                    `**Guild**: ${guild.name} (\`${guild.id}\`)`,
                    `**Triggered by**: ${interaction.user}`,
                ].join("\n"),
            ),
        );

    await interaction.reply({
        components: [panel],
        flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
        allowedMentions: NO_PING_ALLOWED_MENTIONS,
    });
});
