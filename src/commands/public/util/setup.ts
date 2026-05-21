import {
    ButtonInteraction,
    ButtonStyle,
    ChannelSelectMenuBuilder,
    ChannelSelectMenuInteraction,
    ChannelType,
    Guild,
    GuildMember,
    MessageFlags,
    PermissionFlagsBits,
    SeparatorSpacingSize,
    StringSelectMenuBuilder,
    StringSelectMenuInteraction,
} from "discord.js";
import { CommandBuilder } from "../../../config/CommandBuilder.js";
import { requireComponentReplyPermissions, requireTextReplyPermissions } from "../../../config/CommandPermissionGuards.js";
import { getGuildMessages, getLanguageDisplayName, getMessages, type MessageTree } from "../../../config/i18n.js";
import { NookBuilder } from "../../../config/NookBuilder.js";
import { privateVoiceManager } from "../../../config/PrivateVoiceManager.js";
import { SetupValidator } from "../../../services/setup/SetupValidator.js";

const SETUP_PREFIX = "nook_setup";
const PLACEHOLDER_CHANNEL_ID = "000000000";
const setupValidator = new SetupValidator(SETUP_PREFIX);

type SetupLanguage = "fr" | "en" | "es" | "de";
type SetupSection = "menu" | "configuration" | "timing";
type SetupAction = "section" | "toggle" | "language" | "voice_category" | "create_voice" | "access" | "ping" | "cleanup";
type SetupInteraction = ButtonInteraction | StringSelectMenuInteraction | ChannelSelectMenuInteraction;
type GuildVoiceConfig = Awaited<ReturnType<typeof privateVoiceManager.getOrCreateGuildConfig>>;

type Copy = MessageTree["setup"];

const languageOptions: SetupLanguage[] = ["fr", "en", "es", "de"];

function cid(action: SetupAction, guildId: string, section: SetupSection) {
    return `${SETUP_PREFIX}:${action}:${guildId}:${section}`;
}

function parseId(raw: string) {
    const parsed = setupValidator.parseCustomId(raw);
    return parsed ? { ...parsed, action: parsed.action as SetupAction } : null;
}

function parseSection(section: string | null | undefined): SetupSection {
    return setupValidator.parseSection(section);
}

function channelLabel(id: string | null | undefined, t: Copy) {
    return id && id !== PLACEHOLDER_CHANNEL_ID ? `<#${id}>` : `\`${t.notConfigured}\``;
}

function ms(value: number) {
    if (value < 1000) return `${value} ms`;
    const seconds = Math.round(value / 1000);
    if (seconds < 60) return `${seconds}s`;
    return `${Math.round(seconds / 60)}m`;
}

function languageLabel(language: string) {
    return getLanguageDisplayName(language, language);
}

function ownerOption(t: Copy, count: number) {
    return t.ownerOption.replace("{count}", String(count));
}

function ownerCurrent(t: Copy, count: number) {
    return t.ownerCurrent.replace("{count}", String(count));
}

function updateText(t: Copy, key: "enabled" | "language" | "voice_category" | "create_voice" | "access" | "ping" | "cleanup", value: string | number | boolean) {
    if (key === "enabled") {
        return value ? t.moduleEnabledUpdate : t.moduleDisabledUpdate;
    }
    if (key === "language") {
        return t.languageUpdated.replace("{value}", String(value));
    }
    if (key === "voice_category") {
        return t.categoryUpdated.replace("{value}", String(value));
    }
    if (key === "create_voice") {
        return t.creatorChannelUpdated.replace("{value}", String(value));
    }
    if (key === "access") {
        return t.ownerPanelUpdated.replace("{value}", String(value));
    }
    if (key === "ping") {
        return t.pingUpdated.replace("{value}", String(value));
    }
    return t.cleanupUpdated.replace("{value}", String(value));
}

async function adminMember(interaction: SetupInteraction) {
    if (!interaction.guild) return null;
    return interaction.member instanceof GuildMember
        ? interaction.member
        : await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
}

async function canManage(interaction: SetupInteraction) {
    const member = await adminMember(interaction);
    return Boolean(member?.permissions.has(PermissionFlagsBits.Administrator));
}

async function getCopy(guildId: string) {
    return (await getGuildMessages(guildId)).setup;
}

function sectionSelect(guild: Guild, section: SetupSection, t: Copy) {
    return new StringSelectMenuBuilder()
        .setCustomId(cid("section", guild.id, section))
        .setPlaceholder(t.sectionPlaceholder)
        .setMinValues(1)
        .setMaxValues(1)
        .addOptions([
            { label: t.menu, value: "menu", description: t.menuDesc, default: section === "menu" },
            { label: t.configuration, value: "configuration", description: t.configurationDesc, default: section === "configuration" },
            { label: t.timing, value: "timing", description: t.timingDesc, default: section === "timing" },
        ]);
}

function lockedSectionSelect(guild: Guild, section: SetupSection, t: Copy) {
    return sectionSelect(guild, section, t)
        .setPlaceholder(t.enableFirst)
        .setDisabled(true);
}

function languageSelect(guild: Guild, config: GuildVoiceConfig, section: SetupSection, t: Copy) {
    return new StringSelectMenuBuilder()
        .setCustomId(cid("language", guild.id, section))
        .setPlaceholder(t.languagePlaceholder)
        .setMinValues(1)
        .setMaxValues(1)
        .addOptions(languageOptions.map(option => ({
            label: getLanguageDisplayName(option, config.lang),
            value: option,
            default: option === config.lang,
        })));
}

function categorySelect(guild: Guild, config: GuildVoiceConfig, section: SetupSection, t: Copy) {
    const select = new ChannelSelectMenuBuilder()
        .setCustomId(cid("voice_category", guild.id, section))
        .setPlaceholder(t.categoryPlaceholder)
        .setMinValues(1)
        .setMaxValues(1)
        .addChannelTypes(ChannelType.GuildCategory);
    if (config.categoryId !== PLACEHOLDER_CHANNEL_ID) select.setDefaultChannels(config.categoryId);
    return select;
}

function voiceSelect(guild: Guild, config: GuildVoiceConfig, section: SetupSection, t: Copy) {
    const select = new ChannelSelectMenuBuilder()
        .setCustomId(cid("create_voice", guild.id, section))
        .setPlaceholder(t.voicePlaceholder)
        .setMinValues(1)
        .setMaxValues(1)
        .addChannelTypes(ChannelType.GuildVoice);
    if (config.createChannelId !== PLACEHOLDER_CHANNEL_ID) select.setDefaultChannels(config.createChannelId);
    return select;
}

function accessSelect(guild: Guild, section: SetupSection, t: Copy) {
    return new StringSelectMenuBuilder()
        .setCustomId(cid("access", guild.id, section))
        .setPlaceholder(t.panelPlaceholder)
        .setMinValues(1)
        .setMaxValues(1)
        .addOptions([1, 5, 10, 15, 25].map(count => ({ label: ownerOption(t, count), value: `u${count}` })));
}

function pingSelect(guild: Guild, section: SetupSection, t: Copy) {
    return new StringSelectMenuBuilder()
        .setCustomId(cid("ping", guild.id, section))
        .setPlaceholder(t.pingPlaceholder)
        .setMinValues(1)
        .setMaxValues(1)
        .addOptions(["3s", "10s", "30s"].map(value => ({ label: `${t.pingLabel} ${value}`, value: `p${value.replace("s", "")}` })));
}

function cleanupSelect(guild: Guild, section: SetupSection, t: Copy) {
    return new StringSelectMenuBuilder()
        .setCustomId(cid("cleanup", guild.id, section))
        .setPlaceholder(t.cleanupPlaceholder)
        .setMinValues(1)
        .setMaxValues(1)
        .addOptions(["1m", "5m", "10m"].map(value => ({ label: `${t.cleanupLabel} ${value}`, value: `c${value.replace("m", "")}` })));
}

function block(panel: NookBuilder, title: string, description: string, current: string, addMenu: (panel: NookBuilder) => NookBuilder) {
    addMenu(
        panel
            .addSeparatorComponents(separator => separator.setDivider(true).setSpacing(SeparatorSpacingSize.Small))
            .addTextDisplayComponents(text => text.setContent(`**${title}**\n${description}\n${current}`)),
    );
}

function sectionIntro(section: SetupSection, t: Copy) {
    if (section === "configuration") {
        return `## ${t.configuration}\n${t.configurationDesc}`;
    }
    if (section === "timing") {
        return `## ${t.timing}\n${t.timingDesc}`;
    }
    return `## ${t.menu}\n${t.menuDesc}`;
}

function moduleStateLine(config: GuildVoiceConfig, t: Copy) {
    return config.enabled ? t.active : t.inactive;
}

function shell(guild: Guild, config: GuildVoiceConfig, section: SetupSection, t: Copy) {
    const panel = new NookBuilder();
    if (section === "menu") {
        panel.addSectionComponents(component =>
            component
                .addTextDisplayComponents(text =>
                    text.setContent(`## ${t.menu}\n${t.menuDesc}\n**${t.current}**: ${moduleStateLine(config, t)}`),
                )
                .setButtonAccessory(button =>
                    button
                        .setCustomId(cid("toggle", guild.id, section))
                        .setLabel(config.enabled ? t.disable : t.enable)
                        .setStyle(config.enabled ? ButtonStyle.Success : ButtonStyle.Danger),
                ),
        );
        return panel;
    }

    return panel.addTextDisplayComponents(text =>
        text.setContent(sectionIntro(section, t)),
    );
}

function appendConfiguration(panel: NookBuilder, guild: Guild, config: GuildVoiceConfig, section: SetupSection, t: Copy) {
    block(
        panel,
        t.languageTitle,
        t.languageDesc,
        `**${t.current}**: \`${languageLabel(config.lang)}\``,
        builder => builder.addActionRowComponents(row => row.addComponents(languageSelect(guild, config, section, t))),
    );
    block(
        panel,
        t.categoryTitle,
        t.categoryDesc,
        `**${t.current}**: ${channelLabel(config.categoryId, t)}`,
        builder => builder.addActionRowComponents(row => row.addComponents(categorySelect(guild, config, section, t))),
    );
    block(
        panel,
        t.voiceTitle,
        t.voiceDesc,
        `**${t.current}**: ${channelLabel(config.createChannelId, t)}`,
        builder => builder.addActionRowComponents(row => row.addComponents(voiceSelect(guild, config, section, t))),
    );
    block(
        panel,
        t.panelTitle,
        t.panelDesc,
        `**${t.current}**: \`${ownerCurrent(t, config.maxAllowedUsers)}\``,
        builder => builder.addActionRowComponents(row => row.addComponents(accessSelect(guild, section, t))),
    );
}

function appendTiming(panel: NookBuilder, guild: Guild, config: GuildVoiceConfig, section: SetupSection, t: Copy) {
    panel
        .addSeparatorComponents(separator => separator.setDivider(true).setSpacing(SeparatorSpacingSize.Small))
        .addTextDisplayComponents(text => text.setContent(`**${t.current}**: \`Ping ${ms(config.panelMentionTtlMs)}\``))
        .addActionRowComponents(row => row.addComponents(pingSelect(guild, section, t)))
        .addSeparatorComponents(separator => separator.setDivider(true).setSpacing(SeparatorSpacingSize.Small))
        .addTextDisplayComponents(text => text.setContent(`**${t.current}**: \`Cleanup ${ms(config.emptyChannelSweepMs)}\``))
        .addActionRowComponents(row => row.addComponents(cleanupSelect(guild, section, t)));
}

function appendSectionNavigation(panel: NookBuilder, guild: Guild, config: GuildVoiceConfig, section: SetupSection, t: Copy) {
    panel
        .addSeparatorComponents(separator => separator.setDivider(true).setSpacing(SeparatorSpacingSize.Large))
        .addActionRowComponents(row =>
            row.addComponents(config.enabled ? sectionSelect(guild, section, t) : lockedSectionSelect(guild, section, t)),
        );
}

async function setupComponents(guild: Guild, section: SetupSection = "menu") {
    const config = await privateVoiceManager.getOrCreateGuildConfig(guild.id);
    const t = (await getGuildMessages(guild.id)).setup;
    const panel = shell(guild, config, section, t);

    if (!config.enabled && section !== "menu") {
        panel
            .addSeparatorComponents(separator => separator.setDivider(true).setSpacing(SeparatorSpacingSize.Small))
            .addTextDisplayComponents(text => text.setContent(t.enableFirst));
        appendSectionNavigation(panel, guild, config, section, t);
        return [panel];
    }

    if (section === "configuration") {
        appendConfiguration(panel, guild, config, section, t);
    } else if (section === "timing") {
        appendTiming(panel, guild, config, section, t);
    }

    appendSectionNavigation(panel, guild, config, section, t);
    return [panel];
}

async function updatePanel(interaction: SetupInteraction, section: SetupSection, content: string) {
    if (!interaction.guild) {
        await interaction.reply({ content: getMessages("en").setup.serverOnly, flags: MessageFlags.Ephemeral });
        return;
    }
    if (!await requireTextReplyPermissions(interaction)) return;
    if (!await requireComponentReplyPermissions(interaction)) return;

    await interaction.update({
        components: await setupComponents(interaction.guild, section),
        flags: MessageFlags.IsComponentsV2,
    });
    if (content) await interaction.followUp({ content, flags: MessageFlags.Ephemeral });
}

async function applySetting(guildId: string, value: string, t: Copy) {
    if (value.startsWith("u")) {
        const maxAllowedUsers = Math.min(Math.max(Number.parseInt(value.slice(1), 10), 1), 25);
        await privateVoiceManager.updateGuildConfig(guildId, { maxAllowedUsers });
        return updateText(t, "access", maxAllowedUsers);
    }
    const timing: Record<string, { key: "panelMentionTtlMs" | "emptyChannelSweepMs"; value: number; message: "ping" | "cleanup" }> = {
        p3: { key: "panelMentionTtlMs", value: 3_000, message: "ping" },
        p10: { key: "panelMentionTtlMs", value: 10_000, message: "ping" },
        p30: { key: "panelMentionTtlMs", value: 30_000, message: "ping" },
        c1: { key: "emptyChannelSweepMs", value: 60_000, message: "cleanup" },
        c5: { key: "emptyChannelSweepMs", value: 300_000, message: "cleanup" },
        c10: { key: "emptyChannelSweepMs", value: 600_000, message: "cleanup" },
    };
    const selected = timing[value];
    if (!selected) return t.invalid;
    await privateVoiceManager.updateGuildConfig(guildId, { [selected.key]: selected.value });
    return updateText(t, selected.message, ms(selected.value));
}

export async function handleSetupButton(interaction: ButtonInteraction) {
    const parsed = parseId(interaction.customId);
    if (!parsed || parsed.action !== "toggle") return false;
    const t = interaction.guild ? await getCopy(interaction.guild.id) : getMessages("en").setup;
    if (!interaction.guild || interaction.guild.id !== parsed.guildId) {
        await interaction.reply({ content: t.mismatch, flags: MessageFlags.Ephemeral });
        return true;
    }
    if (!await requireTextReplyPermissions(interaction)) return true;

    if (!await canManage(interaction)) {
        await interaction.reply({ content: t.adminOnly, flags: MessageFlags.Ephemeral });
        return true;
    }
    const config = await privateVoiceManager.getOrCreateGuildConfig(interaction.guild.id);
    const enabled = !config.enabled;
    await privateVoiceManager.updateGuildConfig(interaction.guild.id, { enabled });
    await updatePanel(interaction, "menu", updateText(t, "enabled", enabled));
    return true;
}

export async function handleSetupStringSelect(interaction: StringSelectMenuInteraction) {
    const parsed = parseId(interaction.customId);
    if (!parsed || !["section", "language", "access", "ping", "cleanup"].includes(parsed.action)) return false;
    const t = interaction.guild ? await getCopy(interaction.guild.id) : getMessages("en").setup;
    if (!interaction.guild || interaction.guild.id !== parsed.guildId) {
        await interaction.reply({ content: t.mismatch, flags: MessageFlags.Ephemeral });
        return true;
    }
    if (!await requireTextReplyPermissions(interaction)) return true;

    if (!await canManage(interaction)) {
        await interaction.reply({ content: t.adminOnly, flags: MessageFlags.Ephemeral });
        return true;
    }
    const value = interaction.values[0];
    if (parsed.action === "section") {
        await updatePanel(interaction, parseSection(value), "");
        return true;
    }
    const config = await privateVoiceManager.getOrCreateGuildConfig(interaction.guild.id);
    if (!config.enabled) {
        await updatePanel(interaction, parsed.section, t.enableFirst);
        return true;
    }
    if (parsed.action === "language") {
        const language = languageOptions.includes(value as SetupLanguage) ? value as SetupLanguage : "fr";
        await privateVoiceManager.updateGuildConfig(interaction.guild.id, { lang: language });
        const nextCopy = getMessages(language).setup;
        await updatePanel(interaction, parsed.section, updateText(nextCopy, "language", languageLabel(language)));
        return true;
    }
    const message = await applySetting(interaction.guild.id, value, t);
    await updatePanel(interaction, parsed.section, message);
    return true;
}

export async function handleSetupChannelSelect(interaction: ChannelSelectMenuInteraction) {
    const parsed = parseId(interaction.customId);
    if (!parsed || !["voice_category", "create_voice"].includes(parsed.action)) return false;
    const t = interaction.guild ? await getCopy(interaction.guild.id) : getMessages("en").setup;
    if (!interaction.guild || interaction.guild.id !== parsed.guildId) {
        await interaction.reply({ content: t.mismatch, flags: MessageFlags.Ephemeral });
        return true;
    }
    if (!await requireTextReplyPermissions(interaction)) return true;

    if (!await canManage(interaction)) {
        await interaction.reply({ content: t.adminOnly, flags: MessageFlags.Ephemeral });
        return true;
    }
    const config = await privateVoiceManager.getOrCreateGuildConfig(interaction.guild.id);
    if (!config.enabled) {
        await updatePanel(interaction, parsed.section, t.enableFirst);
        return true;
    }
    const channelId = interaction.values[0];
    if (parsed.action === "voice_category") {
        await privateVoiceManager.updateGuildConfig(interaction.guild.id, { categoryId: channelId });
        await updatePanel(interaction, parsed.section, updateText(t, "voice_category", channelId));
        return true;
    }
    await privateVoiceManager.updateGuildConfig(interaction.guild.id, { createChannelId: channelId });
    await updatePanel(interaction, parsed.section, updateText(t, "create_voice", channelId));
    return true;
}

export default CommandBuilder({
    name: "setup",
    description: "Configure Nook on this server",
    description_localizations: {
        fr: "Configurer Nook sur ce serveur",
        de: "Nook auf diesem Server einrichten",
        "es-ES": "Configurar Nook en este servidor",
    },
    permissions: [PermissionFlagsBits.Administrator],
    cooldown: 5,
}, async (interaction) => {
    if (!interaction.guild) {
        return interaction.reply({ content: getMessages("en").setup.serverOnly, flags: MessageFlags.Ephemeral });
    }
    if (!await requireTextReplyPermissions(interaction)) return;

    const t = await getCopy(interaction.guild.id);
    const member = interaction.member instanceof GuildMember
        ? interaction.member
        : await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
    if (!member?.permissions.has(PermissionFlagsBits.Administrator)) {
        return interaction.reply({ content: t.adminOnly, flags: MessageFlags.Ephemeral });
    }
    if (!await requireComponentReplyPermissions(interaction)) return;

    return interaction.reply({
        components: await setupComponents(interaction.guild, "menu"),
        flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
    });
});
