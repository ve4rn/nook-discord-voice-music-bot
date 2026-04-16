import { ButtonInteraction, MessageFlags } from "discord.js";
import type App from "../../config/App.js";
import { buildAudioPanel } from "./audioPanel.js";
import { defaultAudioCommandCopy, getAudioCommandCopy } from "./audioCommandCache.js";
import { requireControlVoice } from "./voiceGuards.js";

export async function handleAudioButton(interaction: ButtonInteraction) {
    const [prefix, action, guildId] = interaction.customId.split(":");
    if (prefix !== "audio") return false;

    const app = interaction.client as App;
    const copy = interaction.guildId
        ? await getAudioCommandCopy(interaction.guildId)
        : defaultAudioCommandCopy;

    if (!interaction.guildId || interaction.guildId !== guildId) {
        await interaction.reply({
            content: copy.controls.guildMismatch,
            flags: MessageFlags.Ephemeral,
        });
        return true;
    }

    if (!app.audio) {
        await interaction.reply({
            content: copy.controls.playerNotReady,
            flags: MessageFlags.Ephemeral,
        });
        return true;
    }

    if (!await requireControlVoice(interaction, app)) return true;

    if (action === "toggle") {
        await app.audio.pauseToggle(guildId);
    } else if (action === "skip") {
        const vote = await app.audio.voteSkip(guildId, interaction.user.id);
        if (!vote.skipped) {
            await interaction.reply({
                content: vote.reason === "no_next"
                    ? copy.controls.noNextTrack
                    : vote.needed > 0
                    ? copy.voteSkip(vote.votes, vote.needed)
                    : copy.noCurrentTrack,
                flags: MessageFlags.Ephemeral,
            });
            return true;
        }
    } else if (action === "loop") {
        await app.audio.toggleLoop(guildId);
    } else if (action === "shuffle") {
        const result = await app.audio.shuffleQueue(guildId);
        if (!result.shuffled) {
            await interaction.reply({
                content: copy.controls.shuffleTooSmall,
                flags: MessageFlags.Ephemeral,
            });
            return true;
        }
    } else if (action === "remove") {
        const [, , , rawIndex, expectedKey] = interaction.customId.split(":");
        const queueIndex = Number.parseInt(rawIndex ?? "", 10);
        const result = await app.audio.removeQueuedTrack(guildId, queueIndex, interaction.user.id, expectedKey);
        if (!result.removed) {
            await interaction.reply({
                content: result.reason === "forbidden"
                    ? copy.controls.removeForbidden
                    : copy.controls.removeMissing,
                flags: MessageFlags.Ephemeral,
            });
            return true;
        }
    } else if (action !== "refresh") {
        return false;
    }

    const state = await app.audio.getQueue(guildId);
    await interaction.update({
        components: [await buildAudioPanel(state, guildId)],
        flags: MessageFlags.IsComponentsV2,
    });
    return true;
}
