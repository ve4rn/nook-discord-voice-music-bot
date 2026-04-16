import { MessageFlags, PermissionFlagsBits, SeparatorSpacingSize } from "discord.js";
import { CommandBuilder } from "../../../config/CommandBuilder.js";
import { NookBuilder } from "../../../config/NookBuilder.js";

function formatBytes(bytes: number) {
    const mb = bytes / 1024 / 1024;
    return `${mb.toFixed(1)} MB`;
}

function formatUptime(ms: number) {
    const totalSeconds = Math.floor(ms / 1000);
    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    return [
        days ? `${days}d` : null,
        hours ? `${hours}h` : null,
        minutes ? `${minutes}m` : null,
        `${seconds}s`,
    ].filter(Boolean).join(" ");
}

export default CommandBuilder({
    name: "stats",
    name_localizations: {
        fr: "stats",
        de: "statistiken",
        "es-ES": "estadísticas",
    },
    description: "Display the bot statistics",
    description_localizations: {
        fr: "Affiche les statistiques du bot",
        de: "Zeigt die Statistiken des Bots an",
        "es-ES": "Muestra las estadísticas del bot",
    },
    permissions: [PermissionFlagsBits.SendMessages],
    cooldown: 5,
}, async (interaction, app) => {
    const memory = process.memoryUsage();
    const publicCommands = Array.from(app.commands.values()).filter(command => command.visibility !== "private").length;
    const privateCommands = Array.from(app.commands.values()).filter(command => command.visibility === "private").length;
    const guildCount = app.guilds.cache.size;
    const cachedUsers = app.users.cache.size;
    const cachedChannels = app.channels.cache.size;
    const wsPing = Math.round(app.ws.ping);
    const audioPlayers = app.audio?.lavalink.players.size ?? 0;

    const panel = new NookBuilder()
        .addTextDisplayComponents(text =>
            text.setContent("## Bot Stats"),
        )
        .addSeparatorComponents(separator =>
            separator.setDivider(true).setSpacing(SeparatorSpacingSize.Small),
        )
        .addTextDisplayComponents(text =>
            text.setContent([
                `**Serveurs**: ${guildCount}`,
                `**Utilisateurs en cache**: ${cachedUsers}`,
                `**Salons en cache**: ${cachedChannels}`,
                `**Commandes publiques**: ${publicCommands}`,
                `**Commandes privees**: ${privateCommands}`,
                `**Players audio**: ${audioPlayers}`,
            ].join("\n")),
        )
        .addSeparatorComponents(separator =>
            separator.setDivider(true).setSpacing(SeparatorSpacingSize.Small),
        )
        .addTextDisplayComponents(text =>
            text.setContent([
                `**Ping WS**: ${wsPing} ms`,
                `**Uptime**: ${formatUptime(process.uptime() * 1000)}`,
                `**Memoire RSS**: ${formatBytes(memory.rss)}`,
                `**Heap**: ${formatBytes(memory.heapUsed)} / ${formatBytes(memory.heapTotal)}`,
                `**Node**: ${process.version}`,
            ].join("\n")),
        );

    return interaction.reply({
        components: [panel],
        flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
    });
});
