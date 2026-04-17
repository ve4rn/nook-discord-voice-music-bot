import { ButtonBuilder, ButtonStyle, MessageFlags, PermissionFlagsBits, SeparatorSpacingSize } from "discord.js";
import { CommandBuilder } from "../../../config/CommandBuilder.js";
import { env } from "../../../config/env.js";
import { requireComponentReplyPermissions, requireTextReplyPermissions } from "../../../config/CommandPermissionGuards.js";
import { NookBuilder } from "../../../config/NookBuilder.js";
import { privateVoiceManager } from "../../../config/PrivateVoiceManager.js";
import type { Command } from "../../../config/main.js";

const DEFAULT_REPOSITORY_URL = "https://github.com/ve4rn/nook-discord-voice-music-bot";
const DEFAULT_SUPPORT_SERVER_URL = "https://discord.gg/mf6993bmQ8";
const CATEGORY_ORDER = ["Music", "Misc"];

type HelpLanguage = "fr" | "en" | "es" | "de";

type HelpCopy = {
    title: string;
    emptyCategory: string;
    addBot: string;
    repository: string;
    supportServer: string;
    categories: Record<string, string>;
};

const helpCopies: Record<HelpLanguage, HelpCopy> = {
    fr: {
        title: "## Menu d'aide",
        emptyCategory: "Aucune commande.",
        addBot: "Ajouter Nook",
        repository: "GitHub",
        supportServer: "Serveur support",
        categories: {
            music: "Musique",
            util: "Divers",
        },
    },
    en: {
        title: "## Help Menu",
        emptyCategory: "No command.",
        addBot: "Add Nook",
        repository: "GitHub",
        supportServer: "Support Server",
        categories: {
            music: "Music",
            util: "Misc",
        },
    },
    es: {
        title: "## Menu de ayuda",
        emptyCategory: "No hay comandos.",
        addBot: "Anadir Nook",
        repository: "GitHub",
        supportServer: "Servidor de soporte",
        categories: {
            music: "Musica",
            util: "Varios",
        },
    },
    de: {
        title: "## Hilfemenue",
        emptyCategory: "Keine Befehle.",
        addBot: "Nook hinzufuegen",
        repository: "GitHub",
        supportServer: "Support-Server",
        categories: {
            music: "Musik",
            util: "Sonstiges",
        },
    },
};

function parseLanguage(raw: string | null | undefined): HelpLanguage {
    if (raw === "fr" || raw === "es" || raw === "de" || raw === "en") return raw;
    return "en";
}

async function getHelpCopy(guildId: string | null | undefined) {
    if (!guildId) return helpCopies.en;

    const hasCachedConfig = privateVoiceManager.guildConfigCache.has(guildId);
    const config = hasCachedConfig
        ? privateVoiceManager.guildConfigCache.get(guildId)
        : await privateVoiceManager.getOrCreateGuildConfig(guildId).catch(() => null);

    return helpCopies[parseLanguage(config?.lang)] ?? helpCopies.en;
}

function titleCase(value: string) {
    return value
        .replace(/[-_]+/g, " ")
        .replace(/\b\w/g, letter => letter.toUpperCase());
}

function getCategoryLabel(category: string, copy: HelpCopy) {
    return copy.categories[category] ?? titleCase(category);
}

function sortCategories(left: string, right: string) {
    const leftIndex = CATEGORY_ORDER.indexOf(left);
    const rightIndex = CATEGORY_ORDER.indexOf(right);
    if (leftIndex !== -1 || rightIndex !== -1) {
        return (leftIndex === -1 ? Number.MAX_SAFE_INTEGER : leftIndex)
            - (rightIndex === -1 ? Number.MAX_SAFE_INTEGER : rightIndex);
    }

    return left.localeCompare(right);
}

function getInviteUrl(clientId: string) {
    const params = new URLSearchParams({
        client_id: clientId,
        permissions: String(PermissionFlagsBits.Administrator),
        integration_type: "0",
        scope: "bot applications.commands",
    });

    return `https://discord.com/oauth2/authorize?${params.toString()}`;
}

function getRepositoryUrl() {
    return env.links.repositoryUrl ?? DEFAULT_REPOSITORY_URL;
}

function getSupportServerUrl() {
    return env.links.supportServerUrl ?? DEFAULT_SUPPORT_SERVER_URL;
}

function formatCommandMention(command: Command, commandIds: Map<string, string>) {
    const commandId = commandIds.get(command.options.name);
    return commandId ? `</${command.options.name}:${commandId}>` : `/${command.options.name}`;
}

function formatCommandList(commands: Command[], commandIds: Map<string, string>, copy: HelpCopy) {
    if (!commands.length) return copy.emptyCategory;
    return commands
        .sort((left, right) => left.options.name.localeCompare(right.options.name))
        .map(command => formatCommandMention(command, commandIds))
        .join(", ");
}

export default CommandBuilder({
    name: "help",
    description: "Get help",
    description_localizations: {
        fr: "Obtenir de l'aide",
        de: "Hilfe erhalten",
        "es-ES": "Obtener ayuda",
    },
    permissions: [PermissionFlagsBits.SendMessages],
}, async (interaction, app) => {
    const copy = await getHelpCopy(interaction.guildId);
    if (!await requireTextReplyPermissions(interaction)) return;
    if (!await requireComponentReplyPermissions(interaction)) return;

    const grouped = new Map<string, Command[]>();
    for (const command of app.commands.values()) {
        const visibility = command.visibility ?? "public";
        if (visibility !== "public") continue;

        const category = command.category ?? "misc";
        const key = getCategoryLabel(category, copy);
        const entries = grouped.get(key) ?? [];
        entries.push(command);
        grouped.set(key, entries);
    }

    const applicationCommands = await interaction.client.application?.commands.fetch().catch(() => null);
    const commandIds = new Map<string, string>();
    for (const command of applicationCommands?.values() ?? []) {
        commandIds.set(command.name, command.id);
    }

    const clientId = interaction.client.application?.id ?? interaction.client.user.id;
    const panel = new NookBuilder()
        .addTextDisplayComponents(td =>
            td.setContent(copy.title),
        )
        .addSeparatorComponents(sp =>
            sp.setDivider(true).setSpacing(SeparatorSpacingSize.Small),
        );

    for (const [category, commands] of Array.from(grouped.entries()).sort(([left], [right]) => sortCategories(left, right))) {
        panel
            .addTextDisplayComponents(td =>
                td.setContent(`### ${category}\n${formatCommandList(commands, commandIds, copy)}`),
            )
            .addSeparatorComponents(sp =>
                sp.setDivider(true).setSpacing(SeparatorSpacingSize.Small),
            );
    }

    panel.addActionRowComponents(row =>
        row.addComponents(
            new ButtonBuilder()
                .setLabel(copy.addBot)
                .setStyle(ButtonStyle.Link)
                .setURL(getInviteUrl(clientId)),
            new ButtonBuilder()
                .setLabel(copy.repository)
                .setStyle(ButtonStyle.Link)
                .setURL(getRepositoryUrl()),
            new ButtonBuilder()
                .setLabel(copy.supportServer)
                .setStyle(ButtonStyle.Link)
                .setURL(getSupportServerUrl()),
        ),
    );

    return interaction.reply({ components: [panel], flags: [MessageFlags.IsComponentsV2]  });
});
