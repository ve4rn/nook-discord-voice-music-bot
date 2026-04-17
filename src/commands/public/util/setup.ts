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
import { NookBuilder } from "../../../config/NookBuilder.js";
import { privateVoiceManager } from "../../../config/PrivateVoiceManager.js";

const SETUP_PREFIX = "nook_setup";
const PLACEHOLDER_CHANNEL_ID = "000000000";

type SetupLanguage = "fr" | "en" | "es" | "de";
type SetupSection = "menu" | "configuration" | "timing";
type SetupAction = "section" | "toggle" | "language" | "voice_category" | "create_voice" | "access" | "ping" | "cleanup";
type SetupInteraction = ButtonInteraction | StringSelectMenuInteraction | ChannelSelectMenuInteraction;
type GuildVoiceConfig = Awaited<ReturnType<typeof privateVoiceManager.getOrCreateGuildConfig>>;

type Copy = {
    title: string;
    intro: string;
    cats: string;
    current: string;
    notConfigured: string;
    sectionPlaceholder: string;
    menu: string;
    menuDesc: string;
    configuration: string;
    configurationDesc: string;
    timing: string;
    timingDesc: string;
    moduleTitle: string;
    active: string;
    inactive: string;
    enable: string;
    disable: string;
    enableFirst: string;
    languageTitle: string;
    languageDesc: string;
    languagePlaceholder: string;
    categoryTitle: string;
    categoryDesc: string;
    categoryPlaceholder: string;
    voiceTitle: string;
    voiceDesc: string;
    voicePlaceholder: string;
    panelTitle: string;
    panelDesc: string;
    panelPlaceholder: string;
    pingPlaceholder: string;
    cleanupPlaceholder: string;
    serverOnly: string;
    mismatch: string;
    adminOnly: string;
    invalid: string;
};

const languageOptions: Array<{ label: string; value: SetupLanguage }> = [
    { label: "Francais", value: "fr" },
    { label: "English", value: "en" },
    { label: "Espanol", value: "es" },
    { label: "Deutsch", value: "de" },
];

const copy: Record<SetupLanguage, Copy> = {
    fr: {
        title: "Configuration Nook",
        intro: "Configurez les vocaux prives de ce serveur.",
        cats: "**Menu** gere l'activation du module.\n**Configuration** regroupe la langue, la categorie, le salon createur et le panneau proprietaire.\n**Delais** regroupe le ping proprietaire et le nettoyage des salons vides.",
        current: "Actuellement",
        notConfigured: "non configure",
        sectionPlaceholder: "Categorie du setup",
        menu: "Menu",
        menuDesc: "Activation du module",
        configuration: "Configuration",
        configurationDesc: "Parametres de base",
        timing: "Delais",
        timingDesc: "Ping et cleanup",
        moduleTitle: "Module vocaux prives",
        active: "Le module est actif.",
        inactive: "Le module est inactif.",
        enable: "Activer",
        disable: "Desactiver",
        enableFirst: "Vous devez activer le module pour changer les parametres.",
        languageTitle: "Langue",
        languageDesc: "Definit la langue utilisee par les panneaux des vocaux prives.",
        languagePlaceholder: "Langue",
        categoryTitle: "Categorie",
        categoryDesc: "Les salons vocaux prives seront crees dans cette categorie.",
        categoryPlaceholder: "Categorie",
        voiceTitle: "Salon createur",
        voiceDesc: "Quand un membre rejoint ce vocal, Nook cree son salon prive.",
        voicePlaceholder: "Salon createur",
        panelTitle: "Panneau proprietaire",
        panelDesc: "Reglez combien de membres le proprietaire peut selectionner en une seule fois dans le panneau de son salon.",
        panelPlaceholder: "Selection simultanee",
        pingPlaceholder: "Ping proprietaire",
        cleanupPlaceholder: "Cleanup salons vides",
        serverOnly: "Cette commande doit etre utilisee dans un serveur.",
        mismatch: "Ce panneau ne correspond pas a ce serveur.",
        adminOnly: "Seuls les administrateurs peuvent modifier ce setup.",
        invalid: "Parametre invalide.",
    },
    en: {
        title: "Nook Setup",
        intro: "Configure this server's private voice channels.",
        cats: "**Menu** controls module activation.\n**Configuration** groups language, category, creator channel and owner panel settings.\n**Delays** groups owner ping and empty channel cleanup.",
        current: "Current",
        notConfigured: "not configured",
        sectionPlaceholder: "Setup category",
        menu: "Menu",
        menuDesc: "Module activation",
        configuration: "Configuration",
        configurationDesc: "Base settings",
        timing: "Delays",
        timingDesc: "Ping and cleanup",
        moduleTitle: "Private voice module",
        active: "The module is active.",
        inactive: "The module is inactive.",
        enable: "Enable",
        disable: "Disable",
        enableFirst: "You must enable the module before changing settings.",
        languageTitle: "Language",
        languageDesc: "Sets the language used by private voice channel panels.",
        languagePlaceholder: "Language",
        categoryTitle: "Category",
        categoryDesc: "Private voice channels will be created inside this category.",
        categoryPlaceholder: "Category",
        voiceTitle: "Creator channel",
        voiceDesc: "When a member joins this voice channel, Nook creates their private room.",
        voicePlaceholder: "Creator channel",
        panelTitle: "Owner panel",
        panelDesc: "Set how many members the owner can select at once from their room panel.",
        panelPlaceholder: "Simultaneous select",
        pingPlaceholder: "Owner ping",
        cleanupPlaceholder: "Empty cleanup",
        serverOnly: "This command must be used in a server.",
        mismatch: "This panel does not belong to this server.",
        adminOnly: "Only administrators can edit this setup.",
        invalid: "Invalid setting.",
    },
    es: {
        title: "Configuracion de Nook",
        intro: "Configura los canales de voz privados de este servidor.",
        cats: "**Menu** controla la activacion del modulo.\n**Configuracion** agrupa idioma, categoria, canal creador y panel del propietario.\n**Tiempos** agrupa el ping al propietario y la limpieza de canales vacios.",
        current: "Actual",
        notConfigured: "sin configurar",
        sectionPlaceholder: "Categoria del setup",
        menu: "Menu",
        menuDesc: "Activacion del modulo",
        configuration: "Configuracion",
        configurationDesc: "Parametros base",
        timing: "Tiempos",
        timingDesc: "Ping y limpieza",
        moduleTitle: "Modulo de voz privada",
        active: "El modulo esta activo.",
        inactive: "El modulo esta inactivo.",
        enable: "Activar",
        disable: "Desactivar",
        enableFirst: "Debes activar el modulo para cambiar los parametros.",
        languageTitle: "Idioma",
        languageDesc: "Define el idioma usado por los paneles de voz privados.",
        languagePlaceholder: "Idioma",
        categoryTitle: "Categoria",
        categoryDesc: "Los canales de voz privados se crearan en esta categoria.",
        categoryPlaceholder: "Categoria",
        voiceTitle: "Canal creador",
        voiceDesc: "Cuando un miembro entra en este canal, Nook crea su sala privada.",
        voicePlaceholder: "Canal creador",
        panelTitle: "Panel del propietario",
        panelDesc: "Define cuantos miembros puede seleccionar el propietario a la vez en el panel de su sala.",
        panelPlaceholder: "Seleccion simultanea",
        pingPlaceholder: "Ping propietario",
        cleanupPlaceholder: "Limpieza vacios",
        serverOnly: "Este comando debe usarse en un servidor.",
        mismatch: "Este panel no corresponde a este servidor.",
        adminOnly: "Solo los administradores pueden modificar este setup.",
        invalid: "Parametro invalido.",
    },
    de: {
        title: "Nook Einrichtung",
        intro: "Richte die privaten Sprachkanaele dieses Servers ein.",
        cats: "**Menu** steuert die Modulaktivierung.\n**Konfiguration** enthaelt Sprache, Kategorie, Ersteller-Kanal und Besitzer-Panel.\n**Zeiten** enthaelt Besitzer-Ping und Cleanup leerer Kanaele.",
        current: "Aktuell",
        notConfigured: "nicht konfiguriert",
        sectionPlaceholder: "Setup-Kategorie",
        menu: "Menu",
        menuDesc: "Modulaktivierung",
        configuration: "Konfiguration",
        configurationDesc: "Basiseinstellungen",
        timing: "Zeiten",
        timingDesc: "Ping und Cleanup",
        moduleTitle: "Privates Sprachmodul",
        active: "Das Modul ist aktiv.",
        inactive: "Das Modul ist inaktiv.",
        enable: "Aktivieren",
        disable: "Deaktivieren",
        enableFirst: "Du musst das Modul aktivieren, bevor du Einstellungen aenderst.",
        languageTitle: "Sprache",
        languageDesc: "Legt die Sprache der privaten Sprachkanal-Panels fest.",
        languagePlaceholder: "Sprache",
        categoryTitle: "Kategorie",
        categoryDesc: "Private Sprachkanaele werden in dieser Kategorie erstellt.",
        categoryPlaceholder: "Kategorie",
        voiceTitle: "Ersteller-Kanal",
        voiceDesc: "Wenn ein Mitglied diesem Sprachkanal beitritt, erstellt Nook seinen privaten Raum.",
        voicePlaceholder: "Ersteller-Kanal",
        panelTitle: "Besitzer-Panel",
        panelDesc: "Legt fest, wie viele Mitglieder der Besitzer im Panel seines Raums gleichzeitig auswaehlen kann.",
        panelPlaceholder: "Gleichzeitige Auswahl",
        pingPlaceholder: "Besitzer-Ping",
        cleanupPlaceholder: "Leere Kanaele",
        serverOnly: "Dieser Befehl muss auf einem Server genutzt werden.",
        mismatch: "Dieses Panel gehoert nicht zu diesem Server.",
        adminOnly: "Nur Administratoren koennen dieses Setup aendern.",
        invalid: "Ungueltiger Parameter.",
    },
};

function cid(action: SetupAction, guildId: string, section: SetupSection) {
    return `${SETUP_PREFIX}:${action}:${guildId}:${section}`;
}

function parseId(raw: string) {
    const [prefix, action, guildId, section] = raw.split(":");
    if (prefix !== SETUP_PREFIX || !action || !guildId) return null;
    return { action: action as SetupAction, guildId, section: parseSection(section) };
}

function parseLanguage(language: string | null | undefined): SetupLanguage {
    return language === "en" || language === "es" || language === "de" || language === "fr" ? language : "fr";
}

function parseSection(section: string | null | undefined): SetupSection {
    return section === "configuration" || section === "timing" || section === "menu" ? section : "menu";
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
    return languageOptions.find(option => option.value === language)?.label ?? language;
}

function ownerOption(t: Copy, count: number) {
    if (t === copy.en) return `${count} member${count > 1 ? "s" : ""}`;
    if (t === copy.es) return `${count} miembro${count > 1 ? "s" : ""}`;
    if (t === copy.de) return `${count} Mitglied${count > 1 ? "er" : ""}`;
    return `${count} membre${count > 1 ? "s" : ""}`;
}

function ownerCurrent(t: Copy, count: number) {
    if (t === copy.en) return `${count} member(s) at once`;
    if (t === copy.es) return `${count} miembro(s) a la vez`;
    if (t === copy.de) return `${count} Mitglied(er) gleichzeitig`;
    return `${count} membre(s) a la fois`;
}

function updateText(t: Copy, key: "enabled" | "language" | "voice_category" | "create_voice" | "access" | "ping" | "cleanup", value: string | number | boolean) {
    if (key === "enabled") {
        if (t === copy.en) return value ? "The module is now active." : "The module is now inactive.";
        if (t === copy.es) return value ? "El modulo esta ahora activo." : "El modulo esta ahora inactivo.";
        if (t === copy.de) return value ? "Das Modul ist jetzt aktiv." : "Das Modul ist jetzt inaktiv.";
        return value ? "Le module est maintenant actif." : "Le module est maintenant inactif.";
    }
    if (key === "language") {
        if (t === copy.en) return `Module language set to **${value}**.`;
        if (t === copy.es) return `Idioma del modulo definido en **${value}**.`;
        if (t === copy.de) return `Modulsprache auf **${value}** gesetzt.`;
        return `Langue du module definie sur **${value}**.`;
    }
    if (key === "voice_category") {
        if (t === copy.en) return `Private voice category set to <#${value}>.`;
        if (t === copy.es) return `Categoria de voces privadas definida en <#${value}>.`;
        if (t === copy.de) return `Kategorie fuer private Sprachkanaele auf <#${value}> gesetzt.`;
        return `Categorie des vocaux prives definie sur <#${value}>.`;
    }
    if (key === "create_voice") {
        if (t === copy.en) return `Private voice creator channel set to <#${value}>.`;
        if (t === copy.es) return `Canal creador de voces privadas definido en <#${value}>.`;
        if (t === copy.de) return `Ersteller-Kanal fuer private Sprachkanaele auf <#${value}> gesetzt.`;
        return `Salon createur des vocaux prives defini sur <#${value}>.`;
    }
    if (key === "access") {
        if (t === copy.en) return `The owner panel now allows **${value}** member(s) to be selected at once.`;
        if (t === copy.es) return `El panel del propietario ahora permite seleccionar **${value}** miembro(s) a la vez.`;
        if (t === copy.de) return `Das Besitzer-Panel erlaubt jetzt **${value}** Mitglied(er) gleichzeitig.`;
        return `Le panneau proprietaire permet maintenant de selectionner **${value}** membre(s) a la fois.`;
    }
    if (key === "ping") {
        if (t === copy.en) return `The owner ping will stay visible for **${value}**.`;
        if (t === copy.es) return `El ping al propietario permanecera visible **${value}**.`;
        if (t === copy.de) return `Der Besitzer-Ping bleibt **${value}** sichtbar.`;
        return `Le ping proprietaire restera visible **${value}**.`;
    }
    if (t === copy.en) return `Empty channel cleanup is now **${value}**.`;
    if (t === copy.es) return `La limpieza de canales vacios pasa a **${value}**.`;
    if (t === copy.de) return `Cleanup leerer Kanaele ist jetzt **${value}**.`;
    return `Le cleanup des salons vides passe a **${value}**.`;
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
    const config = await privateVoiceManager.getOrCreateGuildConfig(guildId);
    return copy[parseLanguage(config.lang)];
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
        .addOptions(languageOptions.map(option => ({ ...option, default: option.value === config.lang })));
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
        .addOptions(["3s", "10s", "30s"].map(value => ({ label: `Ping ${value}`, value: `p${value.replace("s", "")}` })));
}

function cleanupSelect(guild: Guild, section: SetupSection, t: Copy) {
    return new StringSelectMenuBuilder()
        .setCustomId(cid("cleanup", guild.id, section))
        .setPlaceholder(t.cleanupPlaceholder)
        .setMinValues(1)
        .setMaxValues(1)
        .addOptions(["1m", "5m", "10m"].map(value => ({ label: `Cleanup ${value}`, value: `c${value.replace("m", "")}` })));
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
    const state = config.enabled ? t.active : t.inactive;
    return state.replace(/^Le module est /, "").replace(/^The module is /, "").replace(/^El modulo esta /, "").replace(/^Das Modul ist /, "");
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
    const t = copy[parseLanguage(config.lang)];
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
        await interaction.reply({ content: copy.fr.serverOnly, flags: MessageFlags.Ephemeral });
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
    const t = interaction.guild ? await getCopy(interaction.guild.id) : copy.fr;
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
    const t = interaction.guild ? await getCopy(interaction.guild.id) : copy.fr;
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
        const language = languageOptions.some(option => option.value === value) ? value as SetupLanguage : "fr";
        await privateVoiceManager.updateGuildConfig(interaction.guild.id, { lang: language });
        const nextCopy = copy[language];
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
    const t = interaction.guild ? await getCopy(interaction.guild.id) : copy.fr;
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
        return interaction.reply({ content: copy.fr.serverOnly, flags: MessageFlags.Ephemeral });
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
