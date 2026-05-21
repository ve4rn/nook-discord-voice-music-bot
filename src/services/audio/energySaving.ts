import type { Player } from "lavalink-client";
import { MessageFlags, type Message, type TextChannel } from "discord.js";
import type App from "../../config/App.js";
import { NO_PING_ALLOWED_MENTIONS } from "../../config/DiscordMentions.js";
import { checkCanSendComponents, checkCanSendText } from "../../config/PermissionChecks.js";
import { env } from "../../config/env.js";
import { getGuildMessages, tp } from "../../config/i18n.js";
import { buildListenerPresencePanel, buildListenerPresencePanelState } from "./audioPanel.js";

type EnergySavingPrompt = {
  listenerCount: number;
  message: Message;
  usesComponents: boolean;
};

type EnergySavingCallbacks = {
  getPlayer: (guildId: string) => Player | null;
  getNonBotListenerIds: (guildId: string, voiceChannelId: string | null) => string[];
  onTimeout: (guildId: string, textChannelId: string | null) => Promise<void>;
};

export class AudioEnergySaving {
  private readonly checkTimers = new Map<string, NodeJS.Timeout>();
  private readonly responseTimers = new Map<string, NodeJS.Timeout>();
  private readonly prompts = new Map<string, EnergySavingPrompt>();
  private readonly RESPONSE_TIMEOUT_MS = 3 * 60 * 1000;

  constructor(
    private readonly app: App,
    private readonly callbacks: EnergySavingCallbacks,
  ) {}

  refresh(guildId: string, voiceChannelId: string | null, textChannelId: string | null) {
    this.clear(guildId);
    if (!voiceChannelId || !textChannelId) return;

    const listeners = this.callbacks.getNonBotListenerIds(guildId, voiceChannelId);
    if (listeners.length === 0) return;
    this.scheduleCheck(guildId, textChannelId);
  }

  clear(guildId: string) {
    const checkTimer = this.checkTimers.get(guildId);
    if (checkTimer) clearTimeout(checkTimer);
    this.checkTimers.delete(guildId);

    const responseTimer = this.responseTimers.get(guildId);
    if (responseTimer) clearTimeout(responseTimer);
    this.responseTimers.delete(guildId);
  }

  async confirm(guildId: string, userId: string) {
    const player = this.callbacks.getPlayer(guildId);
    if (!player?.voiceChannelId) return false;

    const listeners = this.callbacks.getNonBotListenerIds(guildId, player.voiceChannelId);
    if (!listeners.includes(userId)) return false;

    this.clearResponseTimer(guildId);
    this.prompts.delete(guildId);
    this.scheduleCheck(guildId, player.textChannelId ?? null);
    return { listenerCount: listeners.length };
  }

  private scheduleCheck(guildId: string, textChannelId: string | null) {
    if (!textChannelId) return;

    const existing = this.checkTimers.get(guildId);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
      void this.sendPrompt(guildId, textChannelId);
    }, env.audio.energySavingIdleMs);
    timer.unref?.();
    this.checkTimers.set(guildId, timer);
  }

  private async sendPrompt(guildId: string, textChannelId: string) {
    this.clear(guildId);

    const player = this.callbacks.getPlayer(guildId);
    if (!player?.voiceChannelId || player.paused || !player.queue.current) return;

    const listeners = this.callbacks.getNonBotListenerIds(guildId, player.voiceChannelId);
    if (listeners.length === 0) return;

    const channel = await this.app.channels.fetch(textChannelId).catch(() => null);
    if (!channel || !("send" in channel) || !("guild" in channel)) return;
    const sendChannel = channel as TextChannel;

    if (checkCanSendComponents(sendChannel).ok) {
      const promptMessage = await sendChannel.send({
        components: [await buildListenerPresencePanel(guildId, listeners.length)],
        flags: MessageFlags.IsComponentsV2,
      }).catch(() => null);
      if (promptMessage) {
        this.prompts.set(guildId, { message: promptMessage, listenerCount: listeners.length, usesComponents: true });
      }
    } else if (checkCanSendText(sendChannel).ok) {
      const messages = await getGuildMessages(guildId);
      const promptMessage = await sendChannel.send({
        content: `${messages.music.listenerPresenceTitle}\n${tp(messages.music.listenerPresenceDescription, listeners.length)}\n${messages.music.listenerPresenceFooter}`,
      }).catch(() => null);
      if (promptMessage) {
        this.prompts.set(guildId, { message: promptMessage, listenerCount: listeners.length, usesComponents: false });
      }
    }

    const responseTimer = setTimeout(() => {
      void this.handleTimeout(guildId);
    }, this.RESPONSE_TIMEOUT_MS);
    responseTimer.unref?.();
    this.responseTimers.set(guildId, responseTimer);
  }

  private async handleTimeout(guildId: string) {
    this.clearResponseTimer(guildId);

    const player = this.callbacks.getPlayer(guildId);
    if (!player?.voiceChannelId || player.paused || !player.queue.current) return;

    const listeners = this.callbacks.getNonBotListenerIds(guildId, player.voiceChannelId);
    if (listeners.length === 0) return;

    await this.updatePrompt(guildId, "expired");
    await this.callbacks.onTimeout(guildId, player.textChannelId ?? null);
  }

  private clearResponseTimer(guildId: string) {
    const responseTimer = this.responseTimers.get(guildId);
    if (responseTimer) clearTimeout(responseTimer);
    this.responseTimers.delete(guildId);
  }

  async updatePrompt(guildId: string, state: "confirmed" | "expired") {
    const prompt = this.prompts.get(guildId);
    if (!prompt) return;

    if (prompt.usesComponents) {
      await prompt.message.edit({
        components: [await buildListenerPresencePanelState(guildId, prompt.listenerCount, state)],
        flags: MessageFlags.IsComponentsV2,
        allowedMentions: NO_PING_ALLOWED_MENTIONS,
      }).catch(() => null);
      return;
    }

    const messages = await getGuildMessages(guildId);
    const trailingLine = state === "confirmed"
      ? messages.music.listenerPresenceButtonConfirmed
      : messages.music.listenerPresenceButtonExpired;
    await prompt.message.edit({
      content: `${messages.music.listenerPresenceTitle}\n${tp(messages.music.listenerPresenceDescription, prompt.listenerCount)}\n${messages.music.listenerPresenceFooter}\n${trailingLine}`,
      allowedMentions: NO_PING_ALLOWED_MENTIONS,
    }).catch(() => null);
  }
}
