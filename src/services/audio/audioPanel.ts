import {
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  ContainerBuilder,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputStyle,
} from "discord.js";
import { getDefaultEmoji, getDefaultEmojiMention, getMusicEmoji } from "../../config/DiscordEmojis.js";
import { getAvailableLanguages, getGuildMessages, getLanguageDisplayName, getMessages, tp, type BotLanguage } from "../../config/i18n.js";
import { NookBuilder } from "../../config/NookBuilder.js";
import { type QueueSnapshot, type StoredTrack, formatDuration, formatProgress, getTrackDisplayAuthor } from "../../types/audio.js";
import { AUDIO_CUSTOM_IDS } from "./audioCustomIds.js";
import { getDominantColorFromImageUrl } from "./dominantColor.js";
import { audioPlaylists } from "./playlists.js";

type LetsPlayPanelOptions = {
  guildId: string;
  memberMention: string;
  playCommand?: string;
  accentColor?: number | null;
  resumeVoiceChannelId?: string | null;
  resumeButtonDisabled?: boolean;
  playlistSelectDisabled?: boolean;
};

function playlistOptions() {
  return audioPlaylists.slice(0, 25).map(playlist => ({
    label: playlist.name,
    value: playlist.id,
    description: playlist.description?.slice(0, 100),
  }));
}

function actionButton(customId: string, emojiKey: Parameters<typeof getMusicEmoji>[0], style: ButtonStyle, label?: string, disabled = false) {
  const button = new ButtonBuilder()
    .setCustomId(customId)
    .setEmoji(getMusicEmoji(emojiKey))
    .setStyle(style)
    .setDisabled(disabled);

  if (label) button.setLabel(label);
  return button;
}

function buildLanguageOptions(selectedLanguage: BotLanguage, uiLanguage: BotLanguage, defaultLabel: string) {
  return getAvailableLanguages().map(language => ({
    label: language === "en"
      ? `${getLanguageDisplayName(language, language)} (${defaultLabel})`
      : getLanguageDisplayName(language, language),
    value: language,
    default: language === selectedLanguage,
    description: getLanguageDisplayName(language, uiLanguage),
  }));
}

export async function buildWelcomePanel(guildId: string, language: BotLanguage) {
  const messages = getMessages(language);

  return new NookBuilder()
    .addTextDisplayComponents(td => td.setContent(messages.welcome.title))
    .addSeparatorComponents(sp => sp.setDivider(true))
    .addTextDisplayComponents(td => td.setContent(messages.welcome.chooseLanguage))
    .addSeparatorComponents(sp => sp.setDivider(false))
    .addActionRowComponents(row =>
      row.addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(AUDIO_CUSTOM_IDS.welcomeLanguage(guildId))
          .setMinValues(1)
          .setMaxValues(1)
          .addOptions(...buildLanguageOptions(language, language, messages.common.defaultLabel)),
      ),
    )
    .addSeparatorComponents(sp => sp.setDivider(true))
    .addActionRowComponents(row =>
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(AUDIO_CUSTOM_IDS.welcomeStart(guildId))
          .setEmoji(getDefaultEmoji("nookIcon"))
          .setStyle(ButtonStyle.Primary)
          .setLabel(messages.welcome.startListening),
        new ButtonBuilder()
          .setStyle(ButtonStyle.Link)
          .setURL("https://discord.gg/mf6993bmQ8")
          .setLabel(messages.common.support),
      ),
    );
}

export async function buildVoiceChannelModal(guildId: string) {
  const messages = await getGuildMessages(guildId);
  return new ModalBuilder()
    .setCustomId(AUDIO_CUSTOM_IDS.welcomeVoiceModal(guildId))
    .setTitle(messages.welcome.voiceModalTitle)
    .addTextDisplayComponents(td => td.setContent(messages.welcome.voiceModalIntro))
    .addLabelComponents(label =>
      label
        .setLabel(messages.welcome.voiceModalLabel)
        .setDescription(messages.welcome.voiceModalDescription)
        .setChannelSelectMenuComponent(select =>
          select
            .setCustomId(`audio:voice_channel:${guildId}`)
            .setMinValues(1)
            .setMaxValues(1)
            .setChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice),
        ),
    );
}

export async function buildAddMusicModal(guildId: string) {
  const messages = await getGuildMessages(guildId);
  return new ModalBuilder()
    .setCustomId(AUDIO_CUSTOM_IDS.addMusicModal(guildId))
    .setTitle(messages.music.addMusicModalTitle)
    .addTextDisplayComponents(td => td.setContent(messages.music.addMusicModalIntro))
    .addLabelComponents(label =>
      label
        .setLabel(messages.music.addMusicLabel)
        .setDescription(messages.music.addMusicDescription)
        .setTextInputComponent(input =>
          input
            .setCustomId(`audio:add_music_input:${guildId}`)
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setMinLength(1)
            .setMaxLength(200)
            .setPlaceholder(messages.music.addMusicPlaceholder),
        ),
    );
}

export async function buildLetsPlayPanel(options: LetsPlayPanelOptions) {
  const messages = await getGuildMessages(options.guildId);
  const playCommand = options.playCommand ?? "/play";
  const panel = new NookBuilder();
  if (options.accentColor != null) panel.setAccentColor(options.accentColor);

  panel
    .addTextDisplayComponents(td =>
      td.setContent(
        options.resumeVoiceChannelId
          ? messages.music.resumeTitle.replace("{nookIcon}", getDefaultEmojiMention("nookIcon"))
          : messages.music.letsPlayTitle
            .replace("{nookIcon}", getDefaultEmojiMention("nookIcon"))
            .replace("{member}", options.memberMention)
            .replace("{playCommand}", playCommand),
      ),
    )
    .addSeparatorComponents(sp => sp.setDivider(true));

  if (options.resumeVoiceChannelId) {
    const resumeVoiceChannelId = options.resumeVoiceChannelId;
    panel.addActionRowComponents(row =>
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(AUDIO_CUSTOM_IDS.resume(options.guildId, resumeVoiceChannelId))
          .setStyle(ButtonStyle.Success)
          .setLabel(messages.music.resumeButton)
          .setDisabled(options.resumeButtonDisabled ?? false),
      ),
    );
    return panel;
  }

  panel
    .addActionRowComponents(row =>
      row.addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(AUDIO_CUSTOM_IDS.letsPlayPlaylist(options.guildId))
          .setMinValues(1)
          .setMaxValues(1)
          .setPlaceholder(messages.music.playlistPlaceholder)
          .setDisabled(options.playlistSelectDisabled ?? false)
          .addOptions(...playlistOptions()),
      ),
    )
    .addSeparatorComponents(sp => sp.setDivider(false))
    .addTextDisplayComponents(td => td.setContent(`### ${messages.common.actions}`))
    .addActionRowComponents(row =>
      row.addComponents(
        actionButton(AUDIO_CUSTOM_IDS.letsPlayAdd(options.guildId), "add", ButtonStyle.Secondary, messages.music.addMusic),
        actionButton(AUDIO_CUSTOM_IDS.letsPlayQueue(options.guildId), "playlist", ButtonStyle.Secondary, messages.music.viewQueue),
      ),
    );

  return panel;
}

export async function buildTrackNoticePanel(track: StoredTrack, queued: boolean, guildId: string, positionMs = 0) {
  const messages = await getGuildMessages(guildId);
  const accentColor = track.artworkUrl ? await getDominantColorFromImageUrl(track.artworkUrl) : null;
  const panel = new NookBuilder();
  panel.setAccentColor(accentColor ?? 0xFF4343);

  const author = getTrackDisplayAuthor(track, messages.music.unknownAuthor);
  const title = (queued ? messages.music.adding : messages.music.nowPlaying)
    .replace("{nookIcon}", getDefaultEmojiMention("nookIcon"))
    .replace("{title}", track.title)
    .replace("{author}", author)
    .replace("{url}", track.url);

  panel
    .addSectionComponents(sc =>
      sc
        .addTextDisplayComponents(td => td.setContent(title))
        .setThumbnailAccessory(th =>
          th
            .setURL(track.artworkUrl || "https://cdn.discordapp.com/embed/avatars/0.png")
            .setDescription(track.title),
        ),
    );

  if (queued) {
    panel.addTextDisplayComponents(td =>
      td.setContent(messages.music.trackAddedBy.replace("{member}", `<@${track.requestedBy}>`)),
    );
    return panel;
  }

  if (!queued) {
    panel
      .addSeparatorComponents(sp => sp.setDivider(false).setSpacing(2))
      .addTextDisplayComponents(td => td.setContent(`${formatProgress(positionMs, track.duration)}\n-# [${formatDuration(positionMs)}:${formatDuration(track.duration)}]`))
      .addSeparatorComponents(sp => sp.setDivider(false));
  }

  panel.addActionRowComponents(row =>
    row.addComponents(
      actionButton(AUDIO_CUSTOM_IDS.controlToggle(guildId), "pause", ButtonStyle.Secondary),
      actionButton(AUDIO_CUSTOM_IDS.controlStop(guildId), "stop", ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(AUDIO_CUSTOM_IDS.controlOpen(guildId))
        .setEmoji(getDefaultEmoji("control"))
        .setStyle(ButtonStyle.Secondary)
        .setLabel(messages.common.control),
    ),
  );

  return panel;
}

export async function buildPlaylistLauncherPanel(guildId: string, disabled = false) {
  const messages = await getGuildMessages(guildId);
  return new ContainerBuilder()
    .addTextDisplayComponents(td => td.setContent(messages.music.playlistSelectorNotice))
    .addActionRowComponents(row =>
      row.addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(AUDIO_CUSTOM_IDS.playlistLaunch(guildId))
          .setMinValues(1)
          .setMaxValues(1)
          .setPlaceholder(messages.music.playlistPlaceholder)
          .setDisabled(disabled)
          .addOptions(...playlistOptions()),
      ),
    );
}

export async function buildNeutralNoticePanel(_guildId: string | null, title: string, description?: string) {
  const panel = new ContainerBuilder()
    .addTextDisplayComponents(td => td.setContent(`### ${title}`));

  if (description) {
    panel.addTextDisplayComponents(td => td.setContent(description));
  }

  return panel;
}

export async function buildListenerPresencePanel(guildId: string, listenerCount: number) {
  return buildListenerPresencePanelState(guildId, listenerCount, "active");
}

export async function buildListenerPresencePanelState(
  guildId: string,
  listenerCount: number,
  state: "active" | "confirmed" | "expired",
) {
  const messages = await getGuildMessages(guildId);
  const buttonLabel = state === "confirmed"
    ? messages.music.listenerPresenceButtonConfirmed
    : state === "expired"
      ? messages.music.listenerPresenceButtonExpired
      : tp(messages.music.listenerPresenceButton, listenerCount);
  const buttonStyle = state === "expired" ? ButtonStyle.Danger : ButtonStyle.Success;
  const disabled = state !== "active";

  return new ContainerBuilder()
    .addTextDisplayComponents(td =>
      td.setContent(messages.music.listenerPresenceTitle),
    )
    .addTextDisplayComponents(td =>
      td.setContent(tp(messages.music.listenerPresenceDescription, listenerCount)),
    )
    .addActionRowComponents(row =>
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(AUDIO_CUSTOM_IDS.listenerPresence(guildId))
          .setStyle(buttonStyle)
          .setLabel(buttonLabel)
          .setDisabled(disabled),
      ),
    )
    .addTextDisplayComponents(td => td.setContent(messages.music.listenerPresenceFooter));
}

export async function buildControlPanel(state: QueueSnapshot, guildId: string) {
  const messages = await getGuildMessages(guildId);
  const panel = new ContainerBuilder();
  const current = state.current;

  panel.addTextDisplayComponents(td =>
    td.setContent(
      current
        ? messages.music.controlNowPlaying
          .replace("{nookIcon}", getDefaultEmojiMention("nookIcon"))
          .replace("{title}", current.title)
          .replace("{author}", getTrackDisplayAuthor(current, messages.music.unknownAuthor))
          .replace("{url}", current.url)
        : messages.music.controlNoCurrent.replace("{nookIcon}", getDefaultEmojiMention("nookIcon")),
    ),
  );

  if (current) {
    panel.addTextDisplayComponents(td =>
      td.setContent(`${formatProgress(state.positionMs, current.duration)}\n-# [${formatDuration(state.positionMs)}:${formatDuration(current.duration)}]`),
    );
  }

  panel
    .addSeparatorComponents(sp => sp.setDivider(true))
    .addTextDisplayComponents(td => td.setContent(`-# ${messages.common.control}`))
    .addActionRowComponents(row =>
      row.addComponents(
        actionButton(AUDIO_CUSTOM_IDS.controlPrevious(guildId), "previous", ButtonStyle.Secondary, undefined, !state.previous),
        actionButton(AUDIO_CUSTOM_IDS.controlToggle(guildId), state.isPaused ? "play" : "pause", ButtonStyle.Secondary, undefined, !current),
        actionButton(AUDIO_CUSTOM_IDS.controlStop(guildId), "stop", ButtonStyle.Danger, undefined, !current),
        actionButton(AUDIO_CUSTOM_IDS.controlSkip(guildId), "skip", ButtonStyle.Secondary),
        actionButton(AUDIO_CUSTOM_IDS.controlQueue(guildId), "queue", ButtonStyle.Secondary),
      ),
    )
    .addTextDisplayComponents(td => td.setContent(`-# ${messages.common.music}`))
    .addActionRowComponents(row =>
      row.addComponents(
        actionButton(AUDIO_CUSTOM_IDS.controlPlaylist(guildId), "playlist", current ? ButtonStyle.Secondary : ButtonStyle.Primary),
        actionButton(AUDIO_CUSTOM_IDS.controlAdd(guildId), "add", current ? ButtonStyle.Secondary : ButtonStyle.Primary),
        actionButton(AUDIO_CUSTOM_IDS.controlShuffle(guildId), "shuffle", ButtonStyle.Secondary),
      ),
    );

  return panel;
}

export async function buildQueuePanel(state: QueueSnapshot, guildId: string, _addedBy?: string) {
  const messages = await getGuildMessages(guildId);
  const current = state.current;
  const panel = new ContainerBuilder()
    .addTextDisplayComponents(td => td.setContent(messages.music.queueTitle));

  if (current) {
    panel.addSectionComponents(sc =>
      sc
        .addTextDisplayComponents(td =>
          td.setContent(
            messages.music.queueNowPlaying
              .replace("{nookIcon}", getDefaultEmojiMention("nookIcon"))
              .replace("{title}", current.title)
              .replace("{author}", getTrackDisplayAuthor(current, messages.music.unknownAuthor))
              .replace("{url}", current.url),
          ),
        )
        .setThumbnailAccessory(th =>
          th
            .setURL(current.artworkUrl || "https://cdn.discordapp.com/embed/avatars/0.png")
            .setDescription(current.title),
        ),
    );
    panel.addTextDisplayComponents(td => td.setContent(`${formatProgress(state.positionMs, current.duration)}\n-# [${formatDuration(state.positionMs)}:${formatDuration(current.duration)}]`));
  } else {
    panel.addTextDisplayComponents(td => td.setContent(messages.music.queueNoCurrent.replace("{nookIcon}", getDefaultEmojiMention("nookIcon"))));
  }

  if (state.queue.length === 0) {
    panel.addTextDisplayComponents(td => td.setContent(messages.music.queueEmpty));
  }

  state.queue.forEach((track, index) => {
    const meta = messages.music.queueTrackMeta
      .replace("{duration}", formatDuration(track.duration))
      .replace("{member}", `<@${track.requestedBy}>`);
    panel.addSectionComponents(sc =>
      sc
        .addTextDisplayComponents(td =>
          td.setContent(
            `### #${index + 1}\n[${track.title} - ${getTrackDisplayAuthor(track, messages.music.unknownAuthor)}](${track.url})\n-# ${meta}`,
          ),
        )
        .setThumbnailAccessory(th =>
          th
            .setURL(track.artworkUrl || "https://cdn.discordapp.com/embed/avatars/0.png")
            .setDescription(track.title),
        ),
    );
  });

  panel.addActionRowComponents(row =>
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(AUDIO_CUSTOM_IDS.queueControl(guildId))
        .setEmoji(getDefaultEmoji("control"))
        .setStyle(ButtonStyle.Secondary)
        .setLabel(messages.common.control),
      actionButton(AUDIO_CUSTOM_IDS.queuePrevious(guildId), "previous", ButtonStyle.Secondary, undefined, !state.previous),
      actionButton(AUDIO_CUSTOM_IDS.queueSkip(guildId), "skip", ButtonStyle.Secondary),
    ),
  );

  return panel;
}
