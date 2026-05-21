import {
  ButtonInteraction,
  ButtonStyle,
  ChannelType,
  DiscordAPIError,
  Guild,
  GuildMember,
  LabelBuilder,
  type MessageCreateOptions,
  MessageFlags,
  ModalBuilder,
  ModalSubmitInteraction,
  PermissionFlagsBits,
  PermissionResolvable,
  SeparatorSpacingSize,
  TextInputBuilder,
  TextInputStyle,
  UserSelectMenuBuilder,
  UserSelectMenuInteraction,
  VoiceChannel,
  type CacheType,
  type ClientEvents,
  type OverwriteResolvable,
  type VoiceState,
} from "discord.js";
import type App from "./App.js";
import { NO_PING_ALLOWED_MENTIONS } from "./DiscordMentions.js";
import { NookBuilder } from "./NookBuilder.js";
import {
  checkCanCreateVoiceInCategory,
  checkCanManageVoiceChannel,
  checkCanMoveMemberToVoice,
  checkCanSendComponents,
  checkCanSendText,
  checkVoiceChannelAccess,
  findFirstPublicWritableTextChannel,
  formatPermissionList,
  type PermissionLanguage,
} from "./PermissionChecks.js";
import { env } from "./env.js";
import { getMessages, parseLanguage as parseI18nLanguage, type MessageTree } from "./i18n.js";
import { BotUserUnavailableError, MissingDiscordPermissionError, PrivateVoiceCategoryNotFoundError } from "../domain/errors/index.js";
import { GuildDataRepository } from "../repositories/GuildDataRepository.js";
import { PrivateVoiceRepository } from "../repositories/PrivateVoiceRepository.js";
import { PrivateVoicePermissionService } from "../services/privateVoice/PrivateVoicePermissionService.js";

type PanelAction = "toggle" | "rename" | "rename_input" | "access";
type PvcInteraction = ButtonInteraction<CacheType> | ModalSubmitInteraction<CacheType> | UserSelectMenuInteraction<CacheType>;
type ParsedCustomId = { action: PanelAction; channelId: string; ownerId: string };
type PanelCreatePayload = { components: NookBuilder[]; flags: typeof MessageFlags.IsComponentsV2 };
type PanelUpdatePayload = { content: null; components: NookBuilder[]; flags: typeof MessageFlags.IsComponentsV2 };
type PermissionContext = "createVoice" | "moveMember" | "managePermissions" | "sendPanel" | "joinVoice";
type PrivateVoiceCopy = MessageTree["privateVoice"];
type PrivateVoiceChannel = {
  id: string;
  guildId: string;
  channelId: string;
  ownerId: string;
  isPrivate: boolean;
  allowedIds: string[];
  createdAt: Date;
  updatedAt: Date;
};

export type PrivateVoiceGuildConfig = {
  id: string;
  guildId: string;
  createChannelId: string;
  categoryId: string;
  enabled: boolean;
  lang: string;
  maxAllowedUsers: number;
  panelMentionTtlMs: number;
  emptyChannelSweepMs: number;
  createdAt: Date;
  updatedAt: Date;
};

type PrivateVoiceGuildConfigUpdate = Partial<Pick<
  PrivateVoiceGuildConfig,
  "createChannelId" | "categoryId" | "enabled" | "lang" | "maxAllowedUsers" | "panelMentionTtlMs" | "emptyChannelSweepMs"
>>;

type PrivateChannelCacheEntry = {
  expiresAt: number;
  value: PrivateVoiceChannel;
};

const UNKNOWN_CHANNEL_ERROR = 10_003;
const PLACEHOLDER_CHANNEL_ID = "000000000";
const DEFAULT_ACCENT_COLOR = 0x5165F7;
const PRIVATE_CHANNEL_CACHE_TTL_MS = 5 * 60 * 1000;
const CHANNEL_RENAME_TIMEOUT_MS = 5_000;

const MEMBER_CHANNEL_PERMISSIONS: PermissionResolvable[] = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.Connect,
  PermissionFlagsBits.Speak,
  PermissionFlagsBits.Stream,
  PermissionFlagsBits.UseVAD,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.ReadMessageHistory,
  PermissionFlagsBits.EmbedLinks,
  PermissionFlagsBits.AttachFiles,
  PermissionFlagsBits.AddReactions,
];

const OWNER_CHANNEL_PERMISSIONS: PermissionResolvable[] = [
  ...MEMBER_CHANNEL_PERMISSIONS,
  PermissionFlagsBits.ManageChannels,
  PermissionFlagsBits.MoveMembers,
  PermissionFlagsBits.MuteMembers,
  PermissionFlagsBits.DeafenMembers,
];

const BOT_CHANNEL_PERMISSIONS: PermissionResolvable[] = [
  ...OWNER_CHANNEL_PERMISSIONS,
  PermissionFlagsBits.ManageMessages,
];

function sanitizeChannelName(input: string): string {
  return input.replace(/\s+/g, " ").trim().slice(0, 100);
}

function parsePanelCustomId(customId: string): ParsedCustomId | null {
  const [prefix, action, ownerId, channelId] = customId.split(":");
  if (prefix !== "pvc" || !action || !ownerId || !channelId) return null;
  if (!["toggle", "rename", "rename_input", "access"].includes(action)) return null;
  return { action: action as PanelAction, channelId, ownerId };
}

function isManagedVoiceChannel(channel: unknown): channel is VoiceChannel {
  return channel instanceof VoiceChannel && channel.type === ChannelType.GuildVoice;
}

function logError(context: string, error: unknown): void {
  console.error(`[private-voice-manager] ${context}`);
  console.error(error);
}

function timeout<T>(ms: number, value: T): Promise<T> {
  return new Promise(resolve => {
    const timer = setTimeout(() => resolve(value), ms);
    timer.unref?.();
  });
}

function createPrivateChannelCacheEntry(value: PrivateVoiceChannel): PrivateChannelCacheEntry {
  return {
    expiresAt: Date.now() + PRIVATE_CHANNEL_CACHE_TTL_MS,
    value,
  };
}

export class PrivateVoiceManager {
  private app: App | null = null;
  private fallbackGuildId: string | null = null;
  private readonly repository = new PrivateVoiceRepository();
  private readonly guildDataRepository = new GuildDataRepository();
  private readonly permissionService = new PrivateVoicePermissionService();
  private readonly memberLocks = new Map<string, Promise<unknown>>();
  private readonly cleanupTimers = new Map<string, NodeJS.Timeout>();
  readonly guildConfigCache = new Map<string, PrivateVoiceGuildConfig | null>();
  private readonly privateChannelCache = new Map<string, PrivateChannelCacheEntry>();
  private readonly unmanagedChannelCache = new Set<string>();

  async init(app: App, fallbackGuildId?: string | null) {
    this.app = app;
    this.fallbackGuildId = fallbackGuildId || null;

    await this.bootstrapFallbackConfig();
    await this.preloadCaches();
    await this.reconcileTrackedChannels();
    await this.runStartupCleanupSweeps();
    await this.refreshCleanupTimers();
  }

  async handleVoiceStateUpdate(oldState: VoiceState, newState: VoiceState) {
    if (oldState.channelId === newState.channelId) return;

    const member = newState.member ?? oldState.member;
    if (!member || member.user.bot) return;

    const config = await this.getGuildConfig(newState.guild.id);
    if (!config?.enabled) return;

    await this.withMemberLock(newState.guild.id, member.id, async () => {
      if (newState.channelId === config.createChannelId) {
        const movedBackToOwnedChannel = await this.handleCreateChannelJoin(newState, oldState, config).catch(error => {
          logError(`failed to handle private voice creator join for member ${member.id}`, error);
          return false;
        });
        if (movedBackToOwnedChannel) return;
      }

      if (newState.channelId) {
        const joinedTrackedChannel = await this.getPrivateChannelRecord(newState.guild.id, newState.channelId);
        if (joinedTrackedChannel?.isPrivate && !this.isMemberAllowed(member, joinedTrackedChannel)) {
          await member.voice.setChannel(null, "User is not allowed in this private voice channel").catch(error => {
            logError(`failed to remove unauthorized member ${member.id} from ${newState.channelId}`, error);
          });
        }
      }

      if (!oldState.channelId) return;

      const previousPvc = await this.getPrivateChannelRecord(oldState.guild.id, oldState.channelId);
      if (!previousPvc) return;

      const oldChannel = await this.fetchVoiceChannelFromGuild(oldState.guild, oldState.channelId);
    if (!oldChannel) {
        await this.repository.deletePrivateChannelByChannelId(oldState.channelId);
        this.privateChannelCache.delete(oldState.channelId);
        this.unmanagedChannelCache.add(oldState.channelId);
        return;
      }

      if (oldChannel.members.size === 0) {
        await this.removeTrackedChannel(oldChannel.id, "Deleting an empty private voice channel");
        return;
      }

      await this.reassignOwnerIfNeeded(oldChannel, previousPvc, member.id, config);
    });
  }

  async handleChannelDelete(channel: ClientEvents["channelDelete"][0]) {
    if (!isManagedVoiceChannel(channel)) return;
    await this.repository.deletePrivateChannelByChannelId(channel.id);
    this.privateChannelCache.delete(channel.id);
    this.unmanagedChannelCache.delete(channel.id);
  }

  async handleInteraction(interaction: PvcInteraction) {
    const parsed = parsePanelCustomId(interaction.customId);
    if (!parsed) return false;

    try {
      if (interaction.isButton()) await this.handleButtonInteraction(interaction, parsed);
      else if (interaction.isModalSubmit()) await this.handleModalInteraction(interaction, parsed);
      else if (interaction.isUserSelectMenu()) await this.handleUserSelectInteraction(interaction, parsed);
    } catch (error) {
      logError("interactionCreate failed", error);
      await this.replyInteractionError(interaction, this.pv(null, "channelNotManaged"));
    }

    return true;
  }

  async setGuildLanguage(guildId: string, language: string) {
    await this.getOrCreateGuildConfig(guildId);
    const config = await this.repository.updateGuildConfig(guildId, { lang: language });

    this.guildConfigCache.set(guildId, config);
    await this.refreshCleanupTimers();
    return config;
  }

  async getOrCreateGuildConfig(guildId: string) {
    const cached = this.guildConfigCache.get(guildId);
    if (cached) return cached;

    const existing = await this.repository.findGuildConfig(guildId);
    if (existing) {
      this.guildConfigCache.set(guildId, existing);
      return existing;
    }

    const config = await this.repository.createGuildConfig(guildId, this.defaultGuildConfigValues());

    this.guildConfigCache.set(guildId, config);
    await this.refreshCleanupTimers();
    return config;
  }

  async updateGuildConfig(guildId: string, data: PrivateVoiceGuildConfigUpdate) {
    await this.getOrCreateGuildConfig(guildId);
    const config = await this.repository.updateGuildConfig(guildId, data);
    this.guildConfigCache.set(guildId, config);
    await this.refreshCleanupTimers();
    return config;
  }

  async deleteGuildData(guildId: string) {
    const timer = this.cleanupTimers.get(guildId);
    if (timer) clearInterval(timer);
    this.cleanupTimers.delete(guildId);
    this.guildConfigCache.delete(guildId);

    for (const [channelId, channel] of this.privateChannelCache) {
      if (channel.value.guildId === guildId) this.privateChannelCache.delete(channelId);
    }

    return this.guildDataRepository.deleteGuildData(guildId);
  }

  private defaultGuildConfigValues() {
    return {
      createChannelId: env.privateVoice.createChannelId ?? PLACEHOLDER_CHANNEL_ID,
      categoryId: env.privateVoice.categoryId ?? PLACEHOLDER_CHANNEL_ID,
      enabled: true,
      lang: env.privateVoice.language,
      maxAllowedUsers: env.privateVoice.maxAllowedUsers,
      panelMentionTtlMs: env.privateVoice.panelMentionTtlMs,
      emptyChannelSweepMs: env.privateVoice.emptyChannelSweepMs,
    };
  }

  private async bootstrapFallbackConfig() {
    if (!this.fallbackGuildId) return;
    const envCreateChannelId = env.privateVoice.createChannelId;
    const envCategoryId = env.privateVoice.categoryId;
    const hasEnvVoiceConfig = Boolean(envCreateChannelId && envCategoryId);
    const createChannelId = envCreateChannelId || PLACEHOLDER_CHANNEL_ID;
    const categoryId = envCategoryId || PLACEHOLDER_CHANNEL_ID;

    const config = await this.repository.upsertGuildConfig(this.fallbackGuildId, {
      createChannelId,
      categoryId,
      enabled: true,
      lang: env.privateVoice.language,
      maxAllowedUsers: env.privateVoice.maxAllowedUsers,
      panelMentionTtlMs: env.privateVoice.panelMentionTtlMs,
      emptyChannelSweepMs: env.privateVoice.emptyChannelSweepMs,
    });
    if (hasEnvVoiceConfig) {
      const updatedConfig = await this.repository.updateGuildConfig(this.fallbackGuildId, {
        createChannelId: envCreateChannelId!,
        categoryId: envCategoryId!,
        enabled: true,
        maxAllowedUsers: env.privateVoice.maxAllowedUsers,
        panelMentionTtlMs: env.privateVoice.panelMentionTtlMs,
        emptyChannelSweepMs: env.privateVoice.emptyChannelSweepMs,
      });
      this.guildConfigCache.set(this.fallbackGuildId, updatedConfig);
      return;
    }
    this.guildConfigCache.set(this.fallbackGuildId, config);
  }

  private async getGuildConfig(guildId: string) {
    if (this.guildConfigCache.has(guildId)) return this.guildConfigCache.get(guildId) ?? null;
    let config = await this.repository.findGuildConfig(guildId);
    if (!config && guildId === this.fallbackGuildId) {
      await this.bootstrapFallbackConfig();
      config = this.guildConfigCache.get(guildId) ?? null;
    }
    this.guildConfigCache.set(guildId, config);
    return config;
  }

  private async preloadCaches() {
    const configs = await this.repository.listGuildConfigs();
    this.guildConfigCache.clear();
    for (const config of configs) this.guildConfigCache.set(config.guildId, config);

    const privateChannels = await this.repository.listPrivateChannels();
    this.privateChannelCache.clear();
    this.unmanagedChannelCache.clear();
    for (const channel of privateChannels) this.cachePrivateChannel(channel);
  }

  private async getPrivateChannelRecord(guildId: string, channelId: string | null) {
    if (!channelId) return null;

    const cached = this.privateChannelCache.get(channelId);
    if (cached && cached.expiresAt > Date.now()) return cached.value.guildId === guildId ? cached.value : null;
    if (cached) this.privateChannelCache.delete(channelId);
    if (this.unmanagedChannelCache.has(channelId)) return null;

    const pvc = await this.repository.findPrivateChannelById(channelId);
    if (!pvc) {
      this.unmanagedChannelCache.add(channelId);
      return null;
    }

    this.cachePrivateChannel(pvc);
    return pvc.guildId === guildId ? pvc : null;
  }

  private async getPrivateChannelRecordById(channelId: string | null) {
    if (!channelId) return null;

    const cached = this.privateChannelCache.get(channelId);
    if (cached && cached.expiresAt > Date.now()) return cached.value;
    if (cached) this.privateChannelCache.delete(channelId);
    if (this.unmanagedChannelCache.has(channelId)) return null;

    const pvc = await this.repository.findPrivateChannelById(channelId);
    if (!pvc) {
      this.unmanagedChannelCache.add(channelId);
      return null;
    }

    this.cachePrivateChannel(pvc);
    return pvc;
  }

  private cachePrivateChannel(channel: PrivateVoiceChannel) {
    this.privateChannelCache.set(channel.channelId, createPrivateChannelCacheEntry(channel));
    this.unmanagedChannelCache.delete(channel.channelId);
  }

  private getCachedPrivateChannels() {
    const now = Date.now();
    const channels: PrivateVoiceChannel[] = [];
    for (const [channelId, entry] of this.privateChannelCache.entries()) {
      if (entry.expiresAt <= now) {
        this.privateChannelCache.delete(channelId);
        continue;
      }
      channels.push(entry.value);
    }
    return channels;
  }

  private privateVoiceCopy(config: PrivateVoiceGuildConfig | null): PrivateVoiceCopy {
    return getMessages(parseI18nLanguage(config?.lang)).privateVoice;
  }

  private pv(config: PrivateVoiceGuildConfig | null, key: keyof PrivateVoiceCopy, values?: Record<string, string | number>): string {
    const template = this.privateVoiceCopy(config)[key];
    if (typeof template !== "string") return String(template ?? key);
    return template.replace(/\{(\w+)\}/g, (_, placeholder: string) => {
      const value = values?.[placeholder];
      return value == null ? "" : String(value);
    });
  }

  private defaultChannelName(config: PrivateVoiceGuildConfig | null, displayName: string) {
    const copy = this.privateVoiceCopy(config);
    const firstCharacter = displayName.trim().charAt(0).toLowerCase();
    if (copy.defaultChannelNameVowel && ["a", "e", "i", "o", "u", "y", "h"].includes(firstCharacter)) {
      return this.pv(config, "defaultChannelNameVowel", { displayName });
    }
    return this.pv(config, "defaultChannelName", { displayName });
  }

  private permissionLanguage(config: PrivateVoiceGuildConfig | null): PermissionLanguage {
    return parseI18nLanguage(config?.lang) as PermissionLanguage;
  }

  private permissionContext(config: PrivateVoiceGuildConfig | null, context: PermissionContext) {
    return this.privateVoiceCopy(config).permissionContexts[context] ?? context;
  }

  private async notifyMissingPermissions(
    guild: Guild,
    config: PrivateVoiceGuildConfig | null,
    context: PermissionContext,
    missing: Parameters<typeof formatPermissionList>[1],
  ) {
    const channel = await findFirstPublicWritableTextChannel(guild);
    if (!channel) return;

    const sendCheck = checkCanSendText(channel);
    if (!sendCheck.ok) return;

    const language = this.permissionLanguage(config);
    const permissions = formatPermissionList(language, missing);
    const ownerMention = `<@${guild.ownerId}>`;
    const content = this.pv(config, "permissionAlert", {
      ownerMention,
      context: this.permissionContext(config, context),
      permissions,
    });
    await channel.send({ content, allowedMentions: NO_PING_ALLOWED_MENTIONS }).catch(error => logError(`failed to send missing permissions alert in guild ${guild.id}`, error));
  }

  private async withMemberLock<T>(guildId: string, memberId: string, task: () => Promise<T>): Promise<T> {
    const key = `${guildId}:${memberId}`;
    const previous = this.memberLocks.get(key) ?? Promise.resolve();
    let releaseCurrent!: () => void;
    const gate = new Promise<void>(resolve => {
      releaseCurrent = resolve;
    });
    const current = previous.catch(() => undefined).then(() => gate);

    this.memberLocks.set(key, current);
    await previous.catch(() => undefined);

    try {
      return await task();
    } finally {
      releaseCurrent();
      if (this.memberLocks.get(key) === current) this.memberLocks.delete(key);
    }
  }

  private async fetchVoiceChannelFromGuild(guild: Guild, channelId: string): Promise<VoiceChannel | null> {
    const cached = guild.channels.cache.get(channelId);
    if (isManagedVoiceChannel(cached)) return cached;

    try {
      const fetched = await guild.channels.fetch(channelId);
      return isManagedVoiceChannel(fetched) ? fetched : null;
    } catch (error) {
      if (error instanceof DiscordAPIError && error.code === UNKNOWN_CHANNEL_ERROR) return null;
      throw error;
    }
  }

  private async safelyDeleteChannel(channel: VoiceChannel, reason: string): Promise<void> {
    try {
      await channel.delete(reason);
    } catch (error) {
      if (error instanceof DiscordAPIError && error.code === UNKNOWN_CHANNEL_ERROR) return;
      throw error;
    }
  }

  private async removeTrackedChannel(channelId: string, reason: string): Promise<void> {
    if (!this.app) return;
    const channel = await this.app.channels.fetch(channelId).catch((error: unknown) => {
      if (error instanceof DiscordAPIError && error.code === UNKNOWN_CHANNEL_ERROR) return null;
      throw error;
    });

    if (isManagedVoiceChannel(channel)) await this.safelyDeleteChannel(channel, reason);
    await this.repository.deletePrivateChannelByChannelId(channelId);
    this.privateChannelCache.delete(channelId);
    this.unmanagedChannelCache.add(channelId);
  }

  private async renameVoiceChannel(channel: VoiceChannel, requestedName: string, reason: string) {
    const renameTask = channel.setName(requestedName, reason)
      .then(() => true)
      .catch((error: unknown) => {
        logError(`failed to rename private voice channel ${channel.id} to ${requestedName}`, error);
        return false;
      });

    const renameFinished = await Promise.race([
      renameTask,
      timeout(CHANNEL_RENAME_TIMEOUT_MS, false),
    ]);
    if (!renameFinished) return false;

    const updatedChannel = await Promise.race([
      channel.guild.channels.fetch(channel.id, { force: true, cache: true }).catch((error: unknown) => {
        logError(`failed to refetch private voice channel ${channel.id} after rename`, error);
        return null;
      }),
      timeout(CHANNEL_RENAME_TIMEOUT_MS, null),
    ]);

    return isManagedVoiceChannel(updatedChannel) && updatedChannel.name === requestedName;
  }

  private isMemberAllowed(member: GuildMember, pvc: PrivateVoiceChannel): boolean {
    return this.permissionService.canMemberJoinPrivateVoiceChannel({
      memberId: member.id,
      ownerId: pvc.ownerId,
      isPrivate: pvc.isPrivate,
      allowedIds: pvc.allowedIds,
      hasAdministratorPermission: member.permissions.has(PermissionFlagsBits.Administrator),
      hasManageChannelsPermission: member.permissions.has(PermissionFlagsBits.ManageChannels),
    });
  }

  private resolveMemberAccentColor(member: GuildMember): number {
    const coloredRole = member.roles.cache
      .sort((left, right) => right.position - left.position)
      .find(role => role.colors.primaryColor > 0);
    return coloredRole?.colors.primaryColor ?? DEFAULT_ACCENT_COLOR;
  }

  private async syncChannelPermissions(guild: Guild, channel: VoiceChannel, pvc: PrivateVoiceChannel, config: PrivateVoiceGuildConfig) {
    const botUserId = guild.client.user?.id;
    if (!botUserId) throw new BotUserUnavailableError();

    const manageCheck = checkCanManageVoiceChannel(channel);
    if (!manageCheck.ok) {
      await this.notifyMissingPermissions(guild, config, "managePermissions", manageCheck.missing);
      throw new MissingDiscordPermissionError(manageCheck.missing);
    }

    const overwrites: OverwriteResolvable[] = [
      {
        id: guild.roles.everyone.id,
        allow: pvc.isPrivate ? [] : MEMBER_CHANNEL_PERMISSIONS,
        deny: pvc.isPrivate ? [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect] : [],
      },
      { id: pvc.ownerId, allow: OWNER_CHANNEL_PERMISSIONS },
      { id: botUserId, allow: BOT_CHANNEL_PERMISSIONS },
    ];

    if (pvc.isPrivate) {
      for (const allowedId of pvc.allowedIds) {
        if (allowedId !== pvc.ownerId) overwrites.push({ id: allowedId, allow: MEMBER_CHANNEL_PERMISSIONS });
      }
    }

    await channel.permissionOverwrites.set(overwrites, this.pv(config, "updateReason"));
  }

  private buildPanelContainer(owner: GuildMember, pvc: PrivateVoiceChannel, channelName: string, config: PrivateVoiceGuildConfig) {
    const allowedCount = Math.max(pvc.allowedIds.filter(id => id !== pvc.ownerId).length, 0);
    const container = new NookBuilder()
      .setAccentColor(this.resolveMemberAccentColor(owner))
      .addTextDisplayComponents(text => text.setContent(`## ${this.pv(config, "panelTitle")}\n${this.pv(config, "controlPanelIntro", { ownerMention: owner.toString() })}`))
      .addSeparatorComponents(separator => separator.setDivider(true).setSpacing(SeparatorSpacingSize.Small))
      .addSectionComponents(section =>
        section
          .addTextDisplayComponents(text =>
            text.setContent(`${this.pv(config, "panelDescription", {
              channelName,
              mode: pvc.isPrivate ? this.pv(config, "privateModeLine") : this.pv(config, "publicModeLine"),
              allowedCount,
            })}\n> ${pvc.isPrivate ? this.pv(config, "privateStatus") : this.pv(config, "publicStatus")}`),
          )
          .setButtonAccessory(button =>
            button
              .setCustomId(`pvc:toggle:${pvc.ownerId}:${pvc.channelId}`)
              .setLabel(pvc.isPrivate ? this.pv(config, "publicButton") : this.pv(config, "privateButton"))
              .setStyle(pvc.isPrivate ? ButtonStyle.Success : ButtonStyle.Secondary),
          ),
      )
      .addSeparatorComponents(separator => separator.setDivider(true).setSpacing(SeparatorSpacingSize.Small))
      .addSectionComponents(section =>
        section
          .addTextDisplayComponents(text => text.setContent(this.pv(config, "panelFooter")))
          .setButtonAccessory(button =>
            button
              .setCustomId(`pvc:rename:${pvc.ownerId}:${pvc.channelId}`)
              .setLabel(this.pv(config, "renameButton"))
              .setStyle(ButtonStyle.Primary),
          ),
      );

    if (pvc.isPrivate) {
      container
        .addSeparatorComponents(separator => separator.setDivider(true).setSpacing(SeparatorSpacingSize.Small))
        .addActionRowComponents(row =>
          row.addComponents(
            new UserSelectMenuBuilder()
              .setCustomId(`pvc:access:${pvc.ownerId}:${pvc.channelId}`)
              .setPlaceholder(this.pv(config, "accessPlaceholder"))
              .setMinValues(0)
              .setMaxValues(Math.min(Math.max(config.maxAllowedUsers, 1), 25))
              .setDefaultUsers(pvc.allowedIds.filter(id => id !== pvc.ownerId)),
          ),
        );
    }

    return container;
  }

  private buildControlPanelCreateMessage(owner: GuildMember, pvc: PrivateVoiceChannel, channelName: string, config: PrivateVoiceGuildConfig): PanelCreatePayload {
    return { components: [this.buildPanelContainer(owner, pvc, channelName, config)], flags: MessageFlags.IsComponentsV2 };
  }

  private buildControlPanelUpdateMessage(owner: GuildMember, pvc: PrivateVoiceChannel, channelName: string, config: PrivateVoiceGuildConfig): PanelUpdatePayload {
    return { content: null, components: [this.buildPanelContainer(owner, pvc, channelName, config)], flags: MessageFlags.IsComponentsV2 };
  }

  private async sendManagedChannelMessage(channel: VoiceChannel, payload: string | MessageCreateOptions) {
    if (!channel.isSendable()) return;
    const sendsComponents = typeof payload !== "string"
      && Array.isArray((payload as { components?: unknown[] }).components)
      && ((payload as { components?: unknown[] }).components?.length ?? 0) > 0;
    const check = sendsComponents ? checkCanSendComponents(channel) : checkCanSendText(channel);
    if (!check.ok) {
      logError(`missing permissions to send in private voice channel ${channel.id}: ${check.missing.join(", ")}`, check.missing);
      return;
    }
    const normalizedPayload: MessageCreateOptions = typeof payload === "string"
      ? { content: payload, allowedMentions: NO_PING_ALLOWED_MENTIONS }
      : { ...payload, allowedMentions: NO_PING_ALLOWED_MENTIONS };
    await channel.send(normalizedPayload).catch(error => logError(`failed to send a message in voice channel ${channel.id}`, error));
  }

  private async sendOwnerGreeting(channel: VoiceChannel, owner: GuildMember, config: PrivateVoiceGuildConfig) {
    if (!channel.isSendable()) return;
    const check = checkCanSendText(channel);
    if (!check.ok) {
      await this.notifyMissingPermissions(channel.guild, config, "sendPanel", check.missing);
      return;
    }
    const pingMessage = await channel.send({ content: owner.toString() }).catch(error => {
      logError(`failed to send greeting in voice channel ${channel.id}`, error);
      return null;
    });
    if (!pingMessage) return;
    setTimeout(() => void pingMessage.delete().catch(() => undefined), config.panelMentionTtlMs).unref?.();
  }

  private async createPrivateVoiceChannel(guild: Guild, owner: GuildMember, config: PrivateVoiceGuildConfig) {
    const category = guild.channels.cache.get(config.categoryId) ?? await guild.channels.fetch(config.categoryId);
    if (!category || category.type !== ChannelType.GuildCategory) {
      throw new PrivateVoiceCategoryNotFoundError(config.categoryId);
    }

    const createCheck = checkCanCreateVoiceInCategory(guild, category);
    if (!createCheck.ok) {
      await this.notifyMissingPermissions(guild, config, "createVoice", createCheck.missing);
      throw new MissingDiscordPermissionError(createCheck.missing);
    }

    const channelName = sanitizeChannelName(this.defaultChannelName(config, owner.displayName));
    const channel = await guild.channels.create({
      name: channelName,
      type: ChannelType.GuildVoice,
      parent: category.id,
      permissionOverwrites: [
        { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect] },
        { id: owner.id, allow: OWNER_CHANNEL_PERMISSIONS },
        { id: guild.client.user!.id, allow: BOT_CHANNEL_PERMISSIONS },
      ],
      reason: this.pv(config, "createReason"),
    });

    try {
      const pvc = await this.repository.createPrivateChannel({
        guildId: guild.id,
        allowedIds: [owner.id],
        channelId: channel.id,
        isPrivate: true,
        ownerId: owner.id,
      });

      this.cachePrivateChannel(pvc);
      await this.syncChannelPermissions(guild, channel, pvc, config);
      const voiceAccessCheck = checkVoiceChannelAccess(channel);
      if (!voiceAccessCheck.ok) {
        await this.notifyMissingPermissions(guild, config, "joinVoice", voiceAccessCheck.missing);
        throw new MissingDiscordPermissionError(voiceAccessCheck.missing);
      }
      return { channel, pvc };
    } catch (error) {
      await this.safelyDeleteChannel(channel, "Rolling back failed private voice channel creation").catch(() => undefined);
      throw error;
    }
  }

  private async findReusablePrivateChannel(guild: Guild, ownerId: string) {
    const trackedChannels = this.getCachedPrivateChannels()
      .filter(channel => channel.guildId === guild.id && channel.ownerId === ownerId)
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime());

    const staleChannelIds: string[] = [];
    for (const pvc of trackedChannels) {
      const channel = await this.fetchVoiceChannelFromGuild(guild, pvc.channelId);
      if (!channel) {
        staleChannelIds.push(pvc.channelId);
        continue;
      }
      return { channel, pvc };
    }

    if (staleChannelIds.length > 0) {
      await this.repository.deletePrivateChannelsByIds(staleChannelIds);
      for (const channelId of staleChannelIds) {
        this.privateChannelCache.delete(channelId);
        this.unmanagedChannelCache.add(channelId);
      }
    }
    return null;
  }

  private async publishControlPanel(channel: VoiceChannel, owner: GuildMember, pvc: PrivateVoiceChannel, config: PrivateVoiceGuildConfig) {
    const check = checkCanSendComponents(channel);
    if (!check.ok) {
      await this.notifyMissingPermissions(channel.guild, config, "sendPanel", check.missing);
      await this.sendManagedChannelMessage(channel, this.pv(config, "permissionAlert", {
        ownerMention: owner.toString(),
        context: this.permissionContext(config, "sendPanel"),
        permissions: formatPermissionList(this.permissionLanguage(config), check.missing),
      }));
      return;
    }
    await this.sendManagedChannelMessage(channel, this.buildControlPanelCreateMessage(owner, pvc, channel.name, config));
    await this.sendOwnerGreeting(channel, owner, config);
  }

  private async handleCreateChannelJoin(newState: VoiceState, oldState: VoiceState, config: PrivateVoiceGuildConfig): Promise<boolean> {
    const member = newState.member;
    if (!member) return false;

    const reused = await this.findReusablePrivateChannel(newState.guild, member.id);
    if (reused) {
      const moveCheck = checkCanMoveMemberToVoice(member, reused.channel);
      if (!moveCheck.ok) {
        await this.notifyMissingPermissions(newState.guild, config, "moveMember", moveCheck.missing);
        return false;
      }
      await member.voice.setChannel(reused.channel);
      return oldState.channelId === reused.channel.id;
    }

    const created = await this.createPrivateVoiceChannel(newState.guild, member, config);
    const moveCheck = checkCanMoveMemberToVoice(member, created.channel);
    if (!moveCheck.ok) {
      await this.notifyMissingPermissions(newState.guild, config, "moveMember", moveCheck.missing);
      await this.removeTrackedChannel(created.channel.id, "Deleting a private voice channel after missing move permissions");
      return false;
    }
    await member.voice.setChannel(created.channel);
    await this.publishControlPanel(created.channel, member, created.pvc, config);
    return false;
  }

  private async reassignOwnerIfNeeded(channel: VoiceChannel, pvc: PrivateVoiceChannel, leavingMemberId: string, config: PrivateVoiceGuildConfig) {
    if (pvc.ownerId !== leavingMemberId || channel.members.size === 0) return;

    const nextOwner = channel.members.find(member => !member.user.bot);
    if (!nextOwner) return;

    const updated = await this.repository.updatePrivateChannel(channel.id, {
      allowedIds: this.permissionService.composeAllowedMemberIds(nextOwner.id, pvc.allowedIds),
      ownerId: nextOwner.id,
    });

    this.cachePrivateChannel(updated);
    await this.syncChannelPermissions(channel.guild, channel, updated, config);
    await this.sendManagedChannelMessage(channel, { content: this.pv(config, "transferNotice", { ownerMention: nextOwner.toString() }) });
    await this.publishControlPanel(channel, nextOwner, updated, config);
  }

  private async getTrackedChannel(guild: Guild, channelId: string) {
    const pvc = await this.getPrivateChannelRecord(guild.id, channelId);
    if (!pvc) return null;

    const channel = await this.fetchVoiceChannelFromGuild(guild, channelId);
    if (!channel) {
      await this.repository.deletePrivateChannelByChannelId(channelId);
      this.privateChannelCache.delete(channelId);
      this.unmanagedChannelCache.add(channelId);
      return null;
    }

    const config = await this.getGuildConfig(guild.id);
    if (!config) return null;

    return { channel, config, pvc };
  }

  private async ensureOwnerInteraction(interaction: PvcInteraction, ownerId: string, config: PrivateVoiceGuildConfig): Promise<GuildMember | null> {
    const member = interaction.member instanceof GuildMember ? interaction.member : null;
    if (!member) return null;

    if (member.id !== ownerId) {
      if (interaction.isModalSubmit()) await interaction.editReply({ content: this.pv(config, "notOwner") }).catch(() => undefined);
      else await interaction.reply({ content: this.pv(config, "notOwner"), flags: MessageFlags.Ephemeral }).catch(() => undefined);
      return null;
    }

    return member;
  }

  private async handleButtonInteraction(interaction: ButtonInteraction<CacheType>, parsed: ParsedCustomId) {
    const guild = interaction.guild;
    if (!guild) return;

    const tracked = await this.getTrackedChannel(guild, parsed.channelId);
    if (!tracked) {
      await interaction.reply({ content: this.pv(null, "noLongerExists"), flags: MessageFlags.Ephemeral });
      return;
    }

    const owner = await this.ensureOwnerInteraction(interaction, parsed.ownerId, tracked.config);
    if (!owner) return;

    if (parsed.action === "rename") {
      const modal = new ModalBuilder()
        .setCustomId(`pvc:rename_input:${parsed.ownerId}:${parsed.channelId}`)
        .setTitle(this.pv(tracked.config, "modalTitle"));
      const input = new TextInputBuilder()
        .setCustomId("name")
        .setRequired(true)
        .setMinLength(1)
        .setMaxLength(100)
        .setStyle(TextInputStyle.Short)
        .setValue(tracked.channel.name);

      modal.addLabelComponents(new LabelBuilder().setLabel(this.pv(tracked.config, "renameInputLabel")).setTextInputComponent(input));
      await interaction.showModal(modal);
      return;
    }

    const updated = await this.repository.updatePrivateChannel(parsed.channelId, {
      isPrivate: !tracked.pvc.isPrivate,
    });

    this.cachePrivateChannel(updated);
    await this.syncChannelPermissions(guild, tracked.channel, updated, tracked.config);
    await interaction.update({
      ...this.buildControlPanelUpdateMessage(owner, updated, tracked.channel.name, tracked.config),
      allowedMentions: NO_PING_ALLOWED_MENTIONS,
    });
  }

  private async handleModalInteraction(interaction: ModalSubmitInteraction<CacheType>, parsed: ParsedCustomId) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const guild = interaction.guild;
    if (!guild) return;

    const tracked = await this.getTrackedChannel(guild, parsed.channelId);
    if (!tracked) {
      await interaction.editReply({ content: this.pv(null, "noLongerExists") });
      return;
    }

    const owner = await this.ensureOwnerInteraction(interaction, parsed.ownerId, tracked.config);
    if (!owner) return;

    const requestedName = sanitizeChannelName(interaction.fields.getTextInputValue("name"));
    if (!requestedName) {
      await interaction.editReply({ content: this.pv(tracked.config, "invalidName") });
      return;
    }

    const renamed = await this.renameVoiceChannel(tracked.channel, requestedName, this.pv(tracked.config, "updateReason"));
    if (!renamed) {
      await interaction.editReply({ content: this.pv(tracked.config, "renameRateLimited") });
      return;
    }

    await interaction.editReply({ content: this.pv(tracked.config, "channelRenameSuccess", { newName: requestedName }) });
  }

  private async handleUserSelectInteraction(interaction: UserSelectMenuInteraction<CacheType>, parsed: ParsedCustomId) {
    const guild = interaction.guild;
    if (!guild) return;

    const tracked = await this.getTrackedChannel(guild, parsed.channelId);
    if (!tracked) {
      await interaction.reply({ content: this.pv(null, "noLongerExists"), flags: MessageFlags.Ephemeral });
      return;
    }

    const owner = await this.ensureOwnerInteraction(interaction, parsed.ownerId, tracked.config);
    if (!owner) return;

    await interaction.deferUpdate();

    const allowedIds = this.permissionService.composeAllowedMemberIds(parsed.ownerId, interaction.values.slice(0, tracked.config.maxAllowedUsers));
    const updated = await this.repository.updatePrivateChannel(parsed.channelId, { allowedIds });

    this.cachePrivateChannel(updated);
    await this.syncChannelPermissions(guild, tracked.channel, updated, tracked.config);
    await interaction.message.edit({
      ...this.buildControlPanelUpdateMessage(owner, updated, tracked.channel.name, tracked.config),
      allowedMentions: NO_PING_ALLOWED_MENTIONS,
    }).catch(error => {
      logError(`failed to refresh control panel for channel ${tracked.channel.id}`, error);
    });
    await interaction.followUp({ content: this.pv(tracked.config, "accessUpdated"), flags: MessageFlags.Ephemeral, allowedMentions: NO_PING_ALLOWED_MENTIONS });
  }

  private async cleanupIfEmpty(channelId: string) {
    const pvc = await this.getPrivateChannelRecordById(channelId);
    if (!pvc || !this.app) return;

    const channel = await this.app.channels.fetch(channelId).catch((error: unknown) => {
      if (error instanceof DiscordAPIError && error.code === UNKNOWN_CHANNEL_ERROR) return null;
      throw error;
    });

    if (!channel || !isManagedVoiceChannel(channel)) {
      await this.repository.deletePrivateChannelByChannelId(channelId);
      this.privateChannelCache.delete(channelId);
      this.unmanagedChannelCache.add(channelId);
      return;
    }

    if (channel.members.size > 0) return;

    await this.safelyDeleteChannel(channel, "Deleting an empty private voice channel");
    await this.repository.deletePrivateChannelByChannelId(channelId);
    this.privateChannelCache.delete(channelId);
    this.unmanagedChannelCache.add(channelId);
  }

  private async runCleanupSweep(guildId: string) {
    const trackedChannels = this.getCachedPrivateChannels().filter(channel => channel.guildId === guildId);
    for (const pvc of trackedChannels) {
      await this.cleanupIfEmpty(pvc.channelId).catch(error => logError(`cleanup sweep failed for channel ${pvc.channelId}`, error));
    }
  }

  private getKnownCleanupGuildIds() {
    const guildIds = new Set<string>();

    for (const [guildId, config] of this.guildConfigCache) {
      if (config) guildIds.add(guildId);
    }

    for (const channel of this.getCachedPrivateChannels()) {
      guildIds.add(channel.guildId);
    }

    return Array.from(guildIds);
  }

  private async runStartupCleanupSweeps() {
    const guildIds = this.getKnownCleanupGuildIds();
    for (const guildId of guildIds) {
      await this.runCleanupSweep(guildId).catch(error => {
        logError(`startup cleanup sweep failed for guild ${guildId}`, error);
      });
    }
  }

  private async reconcileTrackedChannels() {
    if (!this.app) return;
    const trackedChannels = this.getCachedPrivateChannels();

    for (const pvc of trackedChannels) {
      const config = await this.getGuildConfig(pvc.guildId);
      const channel = await this.app.channels.fetch(pvc.channelId).catch((error: unknown) => {
        if (error instanceof DiscordAPIError && error.code === UNKNOWN_CHANNEL_ERROR) return null;
        throw error;
      });

      if (!channel || !isManagedVoiceChannel(channel)) {
        await this.repository.deletePrivateChannelByChannelId(pvc.channelId);
        this.privateChannelCache.delete(pvc.channelId);
        this.unmanagedChannelCache.add(pvc.channelId);
        continue;
      }

      if (channel.members.size === 0) {
        await this.removeTrackedChannel(channel.id, "Deleting an empty private voice channel during startup");
        continue;
      }

      if (config) {
        await this.syncChannelPermissions(channel.guild, channel, pvc, config).catch(error => {
          logError(`failed to resync permissions for ${channel.id}`, error);
        });
      }
    }
  }

  private async refreshCleanupTimers() {
    for (const timer of this.cleanupTimers.values()) clearInterval(timer);
    this.cleanupTimers.clear();

    const configs = Array.from(this.guildConfigCache.values()).filter(config => config?.enabled) as PrivateVoiceGuildConfig[];
    for (const config of configs) {
      const timer = setInterval(() => {
        void this.runCleanupSweep(config.guildId).catch(error => {
          logError(`periodic cleanup sweep failed for guild ${config.guildId}`, error);
        });
      }, config.emptyChannelSweepMs);
      timer.unref?.();
      this.cleanupTimers.set(config.guildId, timer);
    }
  }

  private async replyInteractionError(interaction: PvcInteraction, content: string) {
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp({ content, flags: MessageFlags.Ephemeral }).catch(() => undefined);
      return;
    }

    await interaction.reply({ content, flags: MessageFlags.Ephemeral }).catch(() => undefined);
  }
}

export const privateVoiceManager = new PrivateVoiceManager();

