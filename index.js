import { App, AppManager, Intents } from './src/main.js';
import dotenv from 'dotenv';
dotenv.config();

const app = new App({
    intents: [
        Intents.All

    ],
})

new AppManager(process.env.CLIENT_ID, process.env.GUILD_ID, app)
