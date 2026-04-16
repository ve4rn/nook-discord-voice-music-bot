import { Client, Partials } from "discord.js";
import { Intents, Command } from "./main.js";
import ConsoleMessage from "./ConsoleMessage.js";
import type { AudioManager } from "../services/audio/AudioManager.js";

type AppOpts = {
    intents?: Intents.All | Intents[] | undefined;
    partials?: Partials[] | undefined;
}

export default class App extends Client implements AppOpts {
    commands: Map<string, Command>;
    audio?: AudioManager;
    intents?: Intents.All | Intents[] | undefined;
    partials?: Partials[] | undefined;
    constructor(options: AppOpts = {}) {
        const { intents = [] } = options;

        const intentsValue = Array.isArray(intents)
            ? intents.reduce((acc, intent) => {
                if (App.isValidIntent(intent)) {
                    return acc | intent;
                } else {
                    new ConsoleMessage('Error', `Invalid intents value: ${intent}`);
                    return 0;
                }
            }, 0)
            : App.isValidIntent(intents)
                ? intents
                : (() => {
                    new ConsoleMessage('Error', `Invalid intents value: ${intents}`);
                    return 0;
                })();

        super({ intents: [intentsValue] });

        this.intents = intents;
        this.commands = new Map();
        this.partials = options.partials || [Partials.User, Partials.Message, Partials.Reaction, Partials.GuildMember, Partials.Channel, Partials.GuildScheduledEvent, Partials.ThreadMember];

    }
    static isValidIntent(intent: number): boolean {
        return Object.values(Intents).includes(intent);
    }
}
