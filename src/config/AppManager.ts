import App from "./App.js";
import { pathToFileURL } from 'url';
import fs, { readdirSync } from 'fs';
import { ActivityType, RESTPostAPIChatInputApplicationCommandsJSONBody, REST, Routes, MessageFlags } from 'discord.js'
import ConsoleMessage from "./ConsoleMessage.js";
import { Command, Event } from "./main.js";
import path from 'path';
import { buildCommand, cleanText } from '../utils/main.js'
import dotenv from 'dotenv';
import { AudioManager } from "../services/audio/AudioManager.js";
import { privateVoiceManager } from "./PrivateVoiceManager.js";
import { prismaHealthcheck } from "./Prisma.js";

dotenv.config();
type Cooldown = {
    endAt: number;
    timer: NodeJS.Timeout | null;
};

type CommandVisibility = "public" | "private";

type BootStats = {
    commandsPrivate: number;
    commandsPublic: number;
    events: number;
    startedAt: number;
};

export default class AppManager {
    clientId: string;
    guildId: string | null;
    app: App;
    token: string;
    publicSlashCommands: RESTPostAPIChatInputApplicationCommandsJSONBody[];
    privateSlashCommands: RESTPostAPIChatInputApplicationCommandsJSONBody[];
    cooldown: Map<string, Cooldown>;
    private readonly scope = "AppManager";
    private readonly bootStats: BootStats = {
        commandsPrivate: 0,
        commandsPublic: 0,
        events: 0,
        startedAt: Date.now(),
    };

    constructor(clientId: string, guildId: string | undefined, app: App) {
        this.clientId = clientId;
        this.guildId = guildId?.trim() || null;
        this.app = app;
        this.token = process.env.TOKEN as string;
        this.publicSlashCommands = [];
        this.privateSlashCommands = [];
        this.cooldown = new Map<string, Cooldown>();
        ConsoleMessage.info("Boot sequence started.", this.scope);
        void this.verifyEnvironment().catch(error => {
            ConsoleMessage.error("Environment validation crashed.", "Env", error);
        });
        this.app.audio = new AudioManager(this.app);
        this.app.on('raw', (payload) => {
            void this.app.audio?.sendRaw(payload);
        });
        void this.app.login(this.token).catch(error => {
            ConsoleMessage.error("Discord login failed.", "Discord", error);
        });
        this.app.on('clientReady', async (client) => {
            try {
                ConsoleMessage.success(`Logged in as ${client.user.tag}.`, "Discord");
                this.setVersionPresence();

                const startupGuild = await this.fetchStartupGuild();
                await this.init();
                await privateVoiceManager.init(this.app, startupGuild?.id ?? null);
                ConsoleMessage.success("Private Voice Manager initialized.", "Voice");
                await this.app.audio?.init(client.user.id, client.user.username);
                await this.app.audio?.restoreStates();
                ConsoleMessage.success("Audio manager initialized.", "Audio");
                await this.registerCommands(startupGuild?.id ?? null);
                await this.printBootStats(client.user.tag, startupGuild?.name ?? "not configured");
            } catch (error) {
                ConsoleMessage.error("Client ready bootstrap failed.", "Bootstrap", error);
            }
        })

        this.app.on('interactionCreate', async (interaction) => {
            if (interaction.isAutocomplete()) {
                const command = this.app.commands.get(interaction.commandName);
                if (command?.autocomplete) {
                    try {
                        await command.autocomplete(interaction, this.app);
                    } catch (error) {
                        if (this.isUnknownInteractionError(error)) {
                            ConsoleMessage.warn(`Autocomplete expired for /${command.options.name}.`, "Interactions");
                            return;
                        }
                        ConsoleMessage.error(`Autocomplete failed for /${command.options.name}.`, "Interactions", error);
                    }
                }
                return;
            }

            if (!interaction.isChatInputCommand()) return;

            const command = this.app.commands.get(interaction.commandName);
            if (!command) return;

            const cooldownSec = Math.max(0, command.options.cooldown ?? 5);
            const cooldownMs = cooldownSec * 1000;

            if (cooldownMs === 0) {
                try {
                    await command.execute(interaction, this.app);
                } catch (error) {
                    ConsoleMessage.error(`Command /${command.options.name} failed.`, "Interactions", error);
       
                    const text = cleanText("Oops... it seems there was a problem executing your command. I'll take a closer look!");
                    try {
                        if (interaction.deferred || interaction.replied) await interaction.editReply(text);
                        else await interaction.reply({
                            content: text,
                            flags: MessageFlags.Ephemeral
                        });
                    } catch {
                        try {
                            await interaction.followUp({
                                content: text,
                                flags: MessageFlags.Ephemeral
                            });
                        } catch { }
                    }
                }
                return;
            }

            const cooldownCode = `${interaction.user.id}:${command.options.name}`;
            const now = Date.now();

            const entry = this.cooldown.get(cooldownCode);
            if (entry && entry.endAt > now) {
                const timeRemaining = Math.max(0, Math.ceil((entry.endAt - now) / 1000));
                return interaction.reply({
                    content: `Please wait **${timeRemaining > 1 ? timeRemaining + ' seconds' : timeRemaining + ' second'}** before using the command \`${command.options.name}\`.`,
                    flags: MessageFlags.Ephemeral
                });
            }

            if (entry?.timer) {
                try { clearTimeout(entry.timer); } catch { }
            }
            const endAt = now + cooldownMs;
            const timer = setTimeout(() => {
                this.cooldown.delete(cooldownCode);
            }, cooldownMs);
            // @ts-ignore
            timer.unref?.();

            this.cooldown.set(cooldownCode, { endAt, timer });

            try {
                await command.execute(interaction, this.app);
            } catch (error) {
                ConsoleMessage.error(`Command /${command.options.name} failed.`, "Interactions", error);

                const text = cleanText("Oops... it seems there was a problem executing your command. I'll take a closer look!");

                try {
                    if (interaction.deferred || interaction.replied) await interaction.editReply(text);
                    else await interaction.reply({
                        content: text,
                        flags: MessageFlags.Ephemeral
                    });
                } catch {
                    try {
                        await interaction.followUp({
                            flags: MessageFlags.Ephemeral,
                            content: text
                        });
                    } catch { }
                }
            }
        });

    }
    private async init(): Promise<void> {
        ConsoleMessage.info("Loading commands and events.", "Bootstrap");
        await this.loadCommands();
        await this.loadEvents();
    }
    private async loadCommands(): Promise<void> {
        const commandsFolder: CommandVisibility[] = ["public", "private"];
        const loadedByVisibility = new Map<CommandVisibility, number>([
            ["public", 0],
            ["private", 0],
        ]);

        for (const folder of commandsFolder) {
            const commandPath = path.resolve(process.cwd(), `./dist/commands/${folder}`);
            if (!fs.existsSync(commandPath)) {
                ConsoleMessage.warn(`Commands folder does not exist: ${commandPath}`, "Commands");
                continue;
            }
            const directories = readdirSync(commandPath);

            for (const dir of directories) {
                const commandDirPath = path.resolve(commandPath, dir);
                if (!fs.statSync(commandDirPath).isDirectory()) continue;
                const commandFiles = readdirSync(commandDirPath).filter((file) => file.endsWith(".ts") || file.endsWith(".js"));

                for (const file of commandFiles) {
                    try {
                        const fileCommand = await import(pathToFileURL(path.resolve(commandDirPath, file)).href);
                        const command = fileCommand.default as Command;
                        if (!command?.options.name) {
                            ConsoleMessage.warn(`Command file is missing a name: ${folder}/${dir}/${file}`, "Commands");
                            continue;
                        }

                        command.visibility = folder;
                        command.category = dir;
                        this.app.commands.set(command.options.name, command);

                        const { type, ...cleanOptions } = command.options;
                        const cmd = await buildCommand(cleanOptions);
                        if (folder === "public") this.publicSlashCommands.push(cmd);
                        else this.privateSlashCommands.push(cmd);
                        if (folder === "public") this.bootStats.commandsPublic++;
                        else this.bootStats.commandsPrivate++;
                        loadedByVisibility.set(folder, (loadedByVisibility.get(folder) ?? 0) + 1);
                        ConsoleMessage.debug(`Loaded /${command.options.name} from ${folder}/${dir}/${file}.`, "Commands");
                    } catch (error) {
                        ConsoleMessage.error(`Failed to load command ${folder}/${dir}/${file}.`, "Commands", error);
                    }
                }
            }
        }

        ConsoleMessage.success(
            `Loaded ${this.bootStats.commandsPublic + this.bootStats.commandsPrivate} commands (${loadedByVisibility.get("public")} public, ${loadedByVisibility.get("private")} private).`,
            "Commands",
        );
    }
    public async loadEvents(): Promise<void> {
        const eventPath = path.resolve(process.cwd(), './dist/events');
        if (!fs.existsSync(eventPath)) {
            ConsoleMessage.warn(`Events folder does not exist: ${eventPath}`, "Events");
            return;
        }
        const folders = readdirSync(eventPath);
        let loadedEvents = 0;
        for (const folder of folders) {
            const folderPath = path.join(eventPath, folder);
            if (!fs.statSync(folderPath).isDirectory()) continue;
            const files = fs.readdirSync(folderPath).filter(file => file.endsWith('.ts') || file.endsWith('.js'));

            for (const file of files) {
                const filePath = path.join(folderPath, file);
                const fileURL = pathToFileURL(filePath).href;
                try {
                    const eventModule = await import(fileURL);
                    const event = eventModule.default as Event<'messageCreate'>;
                    if (!event?.options?.name) {
                        ConsoleMessage.warn(`Event file is missing a name: ${folder}/${file}`, "Events");
                        continue;
                    }
                    this.app.on(event.options.name, (...args) => event.execute(...args));
                    loadedEvents++;
                    this.bootStats.events++;
                    ConsoleMessage.debug(`Bound ${event.options.name} from ${folder}/${file}.`, "Events");
                } catch (error) {
                    ConsoleMessage.error(`Failed to load event ${folder}/${file}.`, "Events", error);
                }
            }
        }
        ConsoleMessage.success(`Bound ${loadedEvents} events.`, "Events");
    }
    private async verifyEnvironment(): Promise<any> {
        const token = process.env.TOKEN;
        ConsoleMessage.info("Validating environment variables.", "Env");
        if (!token) return ConsoleMessage.error("'TOKEN' environment variable is missing.", "Env");
        if (!await this.isValidToken(token)) return ConsoleMessage.error("'TOKEN' environment variable is invalid.", "Env");
        this.token = token;
        if (!this.clientId) return ConsoleMessage.error("Client ID is missing.", "Env");
        if (!await this.isValidClient(this.clientId)) return ConsoleMessage.error("Invalid client ID.", "Env");
        if (!this.guildId) {
            ConsoleMessage.warn("GUILD_ID is not configured. Startup guild bootstrap will be skipped.", "Env");
        }
        ConsoleMessage.success("Environment validation completed.", "Env");
    }
    private async isValidToken(token: string): Promise<boolean> {
        try {
            const response = await fetch('https://discord.com/api/v10/users/@me', {
                headers: {
                    Authorization: `Bot ${token}`,
                },
            });
            return response.ok;
        } catch (error) {
            return false;
        }
    }
    private async isValidClient(id: string): Promise<boolean> {
        try {
            const response = await fetch(`https://discord.com/api/v10/oauth2/applications/${id}/rpc`);
            return response.ok;
        } catch (error) {
            return false;
        }
    }
    private async measureDiscordApiLatency() {
        const startedAt = performance.now();
        try {
            const response = await fetch("https://discord.com/api/v10/users/@me", {
                headers: {
                    Authorization: `Bot ${this.token}`,
                },
            });
            return {
                ms: Math.round(performance.now() - startedAt),
                ok: response.ok,
                status: response.status,
            };
        } catch {
            return {
                ms: null,
                ok: false,
                status: "ERR",
            };
        }
    }

    private formatMemory(mb: number) {
        return `${mb.toFixed(1)} MB`;
    }

    private isUnknownInteractionError(error: unknown) {
        return (error as { code?: number })?.code === 10062;
    }

    private getPackageVersion() {
        try {
            const packagePath = path.resolve(process.cwd(), "package.json");
            const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf8")) as { version?: string };
            return packageJson.version?.trim() || "unknown";
        } catch (error) {
            ConsoleMessage.warn("Unable to read package.json version.", "Discord", error);
            return "unknown";
        }
    }

    private setVersionPresence() {
        const version = this.getPackageVersion();
        this.app.user?.setPresence({
            activities: [{ name: `v${version}`, type: ActivityType.Playing }],
            status: "online",
        });
    }

    private async fetchStartupGuild() {
        if (!this.guildId) return null;

        try {
            return await this.app.guilds.fetch(this.guildId);
        } catch (error) {
            ConsoleMessage.warn(
                `Configured GUILD_ID ${this.guildId} is not accessible. Startup guild bootstrap skipped.`,
                "Discord",
                error,
            );
            return null;
        }
    }

    private async printBootStats(botTag: string, guildName: string) {
        const memory = process.memoryUsage();
        const apiLatency = await this.measureDiscordApiLatency();
        const prismaHealthy = await prismaHealthcheck();
        const uptimeMs = Date.now() - this.bootStats.startedAt;

        ConsoleMessage.info("Boot statistics", "Stats");
        console.table([
            { Metric: "Bot", Value: botTag },
            { Metric: "Guild", Value: guildName },
            { Metric: "Commands public", Value: this.bootStats.commandsPublic },
            { Metric: "Commands private", Value: this.bootStats.commandsPrivate },
            { Metric: "Commands total", Value: this.bootStats.commandsPublic + this.bootStats.commandsPrivate },
            { Metric: "Events", Value: this.bootStats.events },
            { Metric: "Discord WS ping", Value: `${Math.round(this.app.ws.ping)} ms` },
            { Metric: "Discord API ping", Value: apiLatency.ms === null ? `failed (${apiLatency.status})` : `${apiLatency.ms} ms (${apiLatency.status})` },
            { Metric: "Prisma health", Value: prismaHealthy ? "ok" : "failed" },
            { Metric: "Memory RSS", Value: this.formatMemory(memory.rss / 1024 / 1024) },
            { Metric: "Memory heap", Value: `${this.formatMemory(memory.heapUsed / 1024 / 1024)} / ${this.formatMemory(memory.heapTotal / 1024 / 1024)}` },
            { Metric: "Node", Value: process.version },
            { Metric: "Boot time", Value: `${uptimeMs} ms` },
        ]);
    }

    private async registerCommands(privateGuildId: string | null): Promise<void> {
        const rest = new REST({ version: '10' }).setToken(this.token as string);
        try {
            ConsoleMessage.info(`Registering ${this.publicSlashCommands.length} public commands.`, "Commands");
            await rest.put(Routes.applicationCommands(this.clientId), {
                body: this.publicSlashCommands,
            });
            ConsoleMessage.success("Public commands registered.", "Commands");

            if (!privateGuildId) {
                ConsoleMessage.warn("Private command registration skipped because GUILD_ID is not accessible.", "Commands");
                return;
            }

            ConsoleMessage.info(`Registering ${this.privateSlashCommands.length} private commands in guild ${privateGuildId}.`, "Commands");
            await rest.put(Routes.applicationGuildCommands(this.clientId, privateGuildId), {
                body: this.privateSlashCommands,
            });
            ConsoleMessage.success("Private guild commands registered.", "Commands");

        } catch (error) {
            ConsoleMessage.error("Failed to register application commands.", "Commands", error);
        }
    }
}    
