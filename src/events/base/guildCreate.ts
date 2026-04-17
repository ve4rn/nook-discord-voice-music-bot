import {
    AuditLogEvent,
    Guild,
    GuildMember,
    MessageFlags,
    PermissionFlagsBits,
    SeparatorSpacingSize,
    StringSelectMenuBuilder,
    StringSelectMenuInteraction,
} from "discord.js";
import { EventBuilder } from "../../config/EventBuilder.js";
import { NookBuilder } from "../../config/NookBuilder.js";
import ConsoleMessage from "../../config/ConsoleMessage.js";
import { requireComponentReplyPermissions, requireTextReplyPermissions } from "../../config/CommandPermissionGuards.js";
import { privateVoiceManager } from "../../config/PrivateVoiceManager.js";
import {
    checkCanSendComponents,
    findFirstPublicWritableTextChannel,
    formatPermissionList,
    type PermissionLanguage,
} from "../../config/PermissionChecks.js";

const DELETE_AFTER_MS = 5 * 60 * 1000;
const CUSTOM_ID_PREFIX = "nook_setup_language";
const AUDIT_LOG_LOOKBACK_MS = 5 * 60 * 1000;
const AUDIT_LOG_RETRIES = 3;
const AUDIT_LOG_RETRY_DELAY_MS = 1_000;

type WelcomeLanguage = "fr" | "en" | "es" | "de";

type WelcomeCopy = {
    flag: string;
    label: string;
    title: string;
    message: (language: string, deleteAtUnix: number, addedByMention: string | null) => string;
    missingComponentPermissions: (permissions: string) => string;
    adminOnly: string;
    selectPlaceholder: string;
    selected: (language: string) => string;
};

const welcomeCopy: Record<WelcomeLanguage, WelcomeCopy> = {
    fr: {
        flag: "🇫🇷",
        label: "Français",
        title: "Bienvenue sur Nook",
        message: (language, deleteAtUnix, addedByMention) => [
            addedByMention
                ? `${addedByMention}, merci de m'avoir ajouté à votre serveur.`
                : "Merci de m'avoir ajouté à votre serveur.",
            `Langue detectée par defaut: **${language}**.`,
            `Ce message sera supprimé automatiquement <t:${deleteAtUnix}:R>.`,
            "Pour terminer la configuration, utilisez la commande **/setup**.",
        ].join("\n"),
        adminOnly: "Seuls les administrateurs peuvent modifier cette langue.",
        missingComponentPermissions: (permissions) => `Je peux envoyer ce message, mais il me manque des permissions pour afficher le panneau interactif:\n${permissions}`,
        selectPlaceholder: "Choisir une langue",
        selected: (language) => `Langue selectionnée: **${language}**. Lancez /setup pour continuer la configuration.`,
    },
    en: {
        flag: "🇬🇧",
        label: "English",
        title: "Welcome to Nook",
        message: (language, deleteAtUnix, addedByMention) => [
            addedByMention
                ? `${addedByMention}, thanks for adding me to your server.`
                : "Thanks for adding me to your server.",
            `Detected default language: **${language}**.`,
            `This message will be deleted automatically <t:${deleteAtUnix}:R>.`,
            "To finish configuration, use the **/setup** command.",
        ].join("\n"),
        missingComponentPermissions: (permissions) => `I can send this message, but I am missing permissions to display the interactive panel:\n${permissions}`,
        adminOnly: "Only administrators can change this language.",
        selectPlaceholder: "Choose a language",
        selected: (language) => `Selected language: **${language}**. Run /setup to continue configuration.`,
    },
    es: {
        flag: "🇪🇸",
        label: "Español",
        title: "Bienvenido a Nook",
        message: (language, deleteAtUnix, addedByMention) => [
            addedByMention
                ? `${addedByMention}, gracias por anadirme a tu servidor.`
                : "Gracias por anadirme a tu servidor.",
            `Idioma detectado por defecto: **${language}**.`,
            `Este mensaje se eliminara automaticamente <t:${deleteAtUnix}:R>.`,
            "Para terminar la configuracion, usa el comando **/setup**.",
        ].join("\n"),
        missingComponentPermissions: (permissions) => `Puedo enviar este mensaje, pero me faltan permisos para mostrar el panel interactivo:\n${permissions}`,
        adminOnly: "Solo los administradores pueden cambiar este idioma.",
        selectPlaceholder: "Elegir un idioma",
        selected: (language) => `Idioma seleccionado: **${language}**. Usa /setup para continuar la configuracion.`,
    },
    de: {
        flag: "🇩🇪",
        label: "Deutsch",
        title: "Willkommen bei Nook",
        message: (language, deleteAtUnix, addedByMention) => [
            addedByMention
                ? `${addedByMention}, danke, dass du mich zu deinem Server hinzugefuegt hast.`
                : "Danke, dass du mich zu deinem Server hinzugefuegt hast.",
            `Automatisch erkannte Standardsprache: **${language}**.`,
            `Diese Nachricht wird automatisch <t:${deleteAtUnix}:R> geloescht.`,
            "Um die Einrichtung abzuschliessen, nutze den Befehl **/setup**.",
        ].join("\n"),
        missingComponentPermissions: (permissions) => `Ich kann diese Nachricht senden, aber mir fehlen Berechtigungen fuer das interaktive Panel:\n${permissions}`,
        adminOnly: "Nur Administratoren koennen diese Sprache aendern.",
        selectPlaceholder: "Sprache auswaehlen",
        selected: (language) => `Ausgewaehlte Sprache: **${language}**. Fuehre /setup aus, um die Einrichtung fortzusetzen.`,
    },
};

function detectLanguage(locale: string | null | undefined): WelcomeLanguage {
    const normalized = locale?.toLowerCase() ?? "";
    if (normalized.startsWith("fr")) return "fr";
    if (normalized.startsWith("es")) return "es";
    if (normalized.startsWith("de")) return "de";
    return "en";
}

async function saveGuildLanguage(guildId: string, language: WelcomeLanguage) {
    await privateVoiceManager.setGuildLanguage(guildId, language);
}

function getLanguageLabel(language: WelcomeLanguage) {
    const copy = welcomeCopy[language];
    return `${copy.flag} ${copy.label}`;
}

function sleep(ms: number) {
    return new Promise<void>(resolve => {
        const timer = setTimeout(resolve, ms);
        timer.unref?.();
    });
}

function isRecentAuditLogEntry(createdTimestamp: number) {
    return Date.now() - createdTimestamp <= AUDIT_LOG_LOOKBACK_MS;
}

function isIntegrationForClient(target: unknown, clientUserId: string) {
    const integration = target as { application?: { bot?: { id?: string | null } | null } | null } | null;
    return integration?.application?.bot?.id === clientUserId;
}

async function fetchBotAdderIdOnce(guild: Guild) {
    const clientUserId = guild.client.user?.id;
    if (!clientUserId) return null;
    if (!guild.members.me?.permissions.has(PermissionFlagsBits.ViewAuditLog)) return null;

    const botAddLogs = await guild.fetchAuditLogs({ type: AuditLogEvent.BotAdd, limit: 5 }).catch(() => null);
    const botAddEntry = botAddLogs?.entries.find(entry =>
        entry.targetId === clientUserId
        && Boolean(entry.executorId)
        && isRecentAuditLogEntry(entry.createdTimestamp),
    );
    if (botAddEntry?.executorId) return botAddEntry.executorId;

    const integrationLogs = await guild.fetchAuditLogs({ type: AuditLogEvent.IntegrationCreate, limit: 5 }).catch(() => null);
    const integrationEntry = integrationLogs?.entries.find(entry =>
        Boolean(entry.executorId)
        && isRecentAuditLogEntry(entry.createdTimestamp)
        && isIntegrationForClient(entry.target, clientUserId),
    ) ?? integrationLogs?.entries.find(entry =>
        Boolean(entry.executorId)
        && isRecentAuditLogEntry(entry.createdTimestamp),
    );

    return integrationEntry?.executorId ?? null;
}

async function fetchBotAdderMention(guild: Guild) {
    for (let attempt = 0; attempt < AUDIT_LOG_RETRIES; attempt++) {
        const userId = await fetchBotAdderIdOnce(guild);
        if (userId) return `<@${userId}>`;
        if (attempt < AUDIT_LOG_RETRIES - 1) await sleep(AUDIT_LOG_RETRY_DELAY_MS);
    }

    return null;
}

function buildWelcomePanel(guild: Guild, language: WelcomeLanguage, deleteAtUnix: number, addedByMention: string | null) {
    const copy = welcomeCopy[language];

    return new NookBuilder()
        .addTextDisplayComponents(text =>
            text.setContent(`## ${copy.title}`),
        )
        .addSeparatorComponents(separator =>
            separator.setDivider(true).setSpacing(SeparatorSpacingSize.Small),
        )
        .addTextDisplayComponents(text =>
            text.setContent(copy.message(getLanguageLabel(language), deleteAtUnix, addedByMention)),
        )
        .addSeparatorComponents(separator =>
            separator.setDivider(true).setSpacing(SeparatorSpacingSize.Small),
        )
        .addActionRowComponents(row =>
            row.addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId(`${CUSTOM_ID_PREFIX}:${guild.id}:${deleteAtUnix}`)
                    .setPlaceholder(copy.selectPlaceholder)
                    .setMinValues(1)
                    .setMaxValues(1)
                    .addOptions(
                        Object.entries(welcomeCopy).map(([value, option]) => ({
                            label: option.label,
                            value,
                            emoji: option.flag,
                            default: value === language,
                        })),
                    ),
            ),
        );
}

export async function handleGuildWelcomeLanguageSelect(interaction: StringSelectMenuInteraction) {
    const [prefix, guildId, rawDeleteAtUnix] = interaction.customId.split(":");
    if (prefix !== CUSTOM_ID_PREFIX) return false;

    const deleteAtUnix = Number.parseInt(rawDeleteAtUnix ?? "", 10);
    const safeDeleteAtUnix = Number.isFinite(deleteAtUnix)
        ? deleteAtUnix
        : Math.floor((Date.now() + DELETE_AFTER_MS) / 1000);
    const language = interaction.values[0] as WelcomeLanguage | undefined;
    const selectedLanguage = language && language in welcomeCopy ? language : "en";
    const copy = welcomeCopy[selectedLanguage];

    if (!interaction.guild || interaction.guild.id !== guildId) {
        await interaction.reply({ content: "This panel does not belong to this server.", flags: MessageFlags.Ephemeral }); // This case should not happen, but we handle it just in case
        return true;
    }

    const member = interaction.member instanceof GuildMember
        ? interaction.member
        : await interaction.guild.members.fetch(interaction.user.id).catch(() => null);

    if (!member?.permissions.has(PermissionFlagsBits.Administrator)) {
        await interaction.reply({ content: copy.adminOnly, flags: MessageFlags.Ephemeral });
        return true;
    }
    if (!await requireTextReplyPermissions(interaction)) return true;
    if (!await requireComponentReplyPermissions(interaction)) return true;

    await saveGuildLanguage(interaction.guild.id, selectedLanguage);

    await interaction.update({
        components: [buildWelcomePanel(interaction.guild, selectedLanguage, safeDeleteAtUnix, null)],
        flags: MessageFlags.IsComponentsV2,
    });
    await interaction.followUp({
        content: copy.selected(getLanguageLabel(selectedLanguage)),
        flags: MessageFlags.Ephemeral,
    });
    return true;
}

export default EventBuilder({
    name: "guildCreate",
    description: "Send the welcome message when the bot joins a server",
}, async (guild) => {
    const language = detectLanguage(guild.preferredLocale);
    const channel = await findFirstPublicWritableTextChannel(guild);
    const deleteAtUnix = Math.floor((Date.now() + DELETE_AFTER_MS) / 1000);

    if (!channel) {
        ConsoleMessage.warn(`No public writable text channel found for ${guild.name} (${guild.id}).`, "GuildCreate");
        return;
    }

    const addedByMention = await fetchBotAdderMention(guild);
    const componentCheck = checkCanSendComponents(channel);
    const copy = welcomeCopy[language];
    const message = componentCheck.ok
        ? await channel.send({
            components: [buildWelcomePanel(guild, language, deleteAtUnix, addedByMention)],
            flags: MessageFlags.IsComponentsV2,
        })
        : await channel.send({
            content: [
                `## ${copy.title}`,
                copy.message(getLanguageLabel(language), deleteAtUnix, addedByMention),
                copy.missingComponentPermissions(formatPermissionList(language as PermissionLanguage, componentCheck.missing)),
            ].join("\n"),
        });

    const timer = setTimeout(() => {
        void message.delete().catch(() => undefined);
    }, DELETE_AFTER_MS);
    timer.unref?.();

    ConsoleMessage.success(`Sent onboarding panel in #${channel.name} for ${guild.name}.`, "GuildCreate");
});
