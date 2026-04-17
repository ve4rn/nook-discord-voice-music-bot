import { App, AppManager, Intents } from './dist/main.js';
import { env } from './dist/config/env.js';

const app = new App({
    intents: [
        Intents.All

    ],
})

new AppManager(env.discord.clientId, env.discord.guildId ?? undefined, app)
