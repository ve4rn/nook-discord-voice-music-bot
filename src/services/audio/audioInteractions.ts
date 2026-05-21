import {
  ButtonInteraction,
  ChannelType,
  GuildMember,
  MessageFlags,
  ModalSubmitInteraction,
  PermissionFlagsBits,
  StringSelectMenuInteraction,
} from "discord.js";
import type App from "../../config/App.js";
import { NO_PING_ALLOWED_MENTIONS } from "../../config/DiscordMentions.js";
import { requireTextReplyPermissions } from "../../config/CommandPermissionGuards.js";
import { getGuildMessages } from "../../config/i18n.js";
import { buildControlPanel, buildLetsPlayPanel, buildListenerPresencePanelState, buildNeutralNoticePanel, buildPlaylistLauncherPanel, buildQueuePanel, buildTrackNoticePanel, buildVoiceChannelModal, buildAddMusicModal } from "./audioPanel.js";
import { AUDIO_CUSTOM_IDS } from "./audioCustomIds.js";
import { defaultAudioCommandCopy, getAudioCommandCopy } from "./audioCommandCache.js";
import { formatSlashCommandMention } from "./commandMentions.js";
import { getAudioPlaylist } from "./playlists.js";
import { getInteractionMemberVoiceChannelId, requireControlVoice, requirePlayableVoice } from "./voiceGuards.js";

function isUnknownInteractionError(error: unknown) {
  return (error as { code?: number })?.code === 10062;
}

function isManageMessagesAllowed(interaction: ButtonInteraction | StringSelectMenuInteraction | ModalSubmitInteraction) {
  const member = interaction.member;
  if (member instanceof GuildMember) return member.permissions.has(PermissionFlagsBits.ManageMessages);
  return interaction.memberPermissions?.has(PermissionFlagsBits.ManageMessages) ?? false;
}

async function ensureCurrentTrackAuthority(interaction: ButtonInteraction, app: App) {
  if (!interaction.guildId || !app.audio) return false;
  const state = await app.audio.getQueue(interaction.guildId);
  if (!state.current) return false;
  return state.current.requestedBy === interaction.user.id || isManageMessagesAllowed(interaction);
}

async function resolveAccentColor(interaction: ButtonInteraction | ModalSubmitInteraction | StringSelectMenuInteraction) {
  const member = interaction.member;
  if (member instanceof GuildMember && member.displayColor && member.displayColor !== 0) return member.displayColor;
  return null;
}

async function buildDisabledPlaylistSourcePanel(interaction: StringSelectMenuInteraction) {
  if (!interaction.guildId) return null;

  if (interaction.customId === AUDIO_CUSTOM_IDS.letsPlayPlaylist(interaction.guildId)) {
    return buildLetsPlayPanel({
      guildId: interaction.guildId,
      memberMention: interaction.user.toString(),
      playCommand: await formatSlashCommandMention(interaction.client, "play"),
      accentColor: await resolveAccentColor(interaction),
      playlistSelectDisabled: true,
    });
  }

  if (interaction.customId === AUDIO_CUSTOM_IDS.playlistLaunch(interaction.guildId)) {
    return buildPlaylistLauncherPanel(interaction.guildId, true);
  }

  return null;
}

async function replyPublicQueue(interaction: ButtonInteraction | StringSelectMenuInteraction, app: App, guildId: string, addedBy?: string) {
  const state = await app.audio!.getQueue(guildId);
  await interaction.reply({
    components: [await buildQueuePanel(state, guildId, addedBy)],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: NO_PING_ALLOWED_MENTIONS,
  });
}

async function replyNeutralMusicNotice(
  interaction: ButtonInteraction | StringSelectMenuInteraction | ModalSubmitInteraction,
  guildId: string | null,
  title: string,
  description: string,
  ephemeral = true,
) {
  await interaction.reply({
    components: [await buildNeutralNoticePanel(guildId, title, description)],
    flags: (ephemeral ? MessageFlags.Ephemeral : 0) | MessageFlags.IsComponentsV2,
    allowedMentions: NO_PING_ALLOWED_MENTIONS,
  });
}

async function getQueueEmptyHint(interaction: ButtonInteraction | StringSelectMenuInteraction | ModalSubmitInteraction, guildId: string) {
  const messages = await getGuildMessages(guildId);
  const playlistCommand = await formatSlashCommandMention(interaction.client, "playlist");
  return messages.music.queueEmptyHint
    .replace("{playlistCommand}", playlistCommand);
}

async function handlePlaylistLaunch(interaction: StringSelectMenuInteraction, app: App, playlistId: string) {
  const playlist = getAudioPlaylist(playlistId);
  const copy = interaction.guildId
    ? await getAudioCommandCopy(interaction.guildId)
    : defaultAudioCommandCopy;

  if (!interaction.guildId || !playlist) {
    await replyNeutralMusicNotice(interaction, interaction.guildId ?? null, copy.playlist.notFound, "");
    return true;
  }
  if (!app.audio) {
    await replyNeutralMusicNotice(interaction, interaction.guildId, copy.playlist.playerNotReady, "");
    return true;
  }

  const voiceChannelId = await requirePlayableVoice(interaction, app);
  if (!voiceChannelId) return true;
  if (!await requireTextReplyPermissions(interaction)) return true;

  const disabledPanel = await buildDisabledPlaylistSourcePanel(interaction);
  if (disabledPanel) {
    await interaction.update({
      components: [disabledPanel],
      flags: MessageFlags.IsComponentsV2,
      allowedMentions: NO_PING_ALLOWED_MENTIONS,
    }).catch(error => {
      if (isUnknownInteractionError(error)) return;
      throw error;
    });
  }

  const limitedTracks = playlist.tracks.slice(0, 10);
  const result = await app.audio.addPlaylistTracks({
    guildId: interaction.guildId,
    voiceChannelId,
    textChannelId: interaction.channelId,
    requestedBy: interaction.user.id,
    tracks: limitedTracks,
  }).catch(() => null);

  if (!result) {
    await interaction.followUp({
      components: [await buildNeutralNoticePanel(interaction.guildId, copy.playlist.addFailed)],
      flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
      allowedMentions: NO_PING_ALLOWED_MENTIONS,
    }).catch(error => {
      if (isUnknownInteractionError(error)) return;
      throw error;
    });
    return true;
  }

  await interaction.followUp({
    components: [await buildNeutralNoticePanel(interaction.guildId, (await getGuildMessages(interaction.guildId)).music.playlistLaunched)],
    flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
    allowedMentions: NO_PING_ALLOWED_MENTIONS,
  }).catch(error => {
    if (isUnknownInteractionError(error)) return;
    throw error;
  });
  await interaction.followUp({
    components: [await buildQueuePanel(await app.audio.getQueue(interaction.guildId), interaction.guildId, interaction.user.toString())],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: NO_PING_ALLOWED_MENTIONS,
  }).catch(error => {
    if (isUnknownInteractionError(error)) return;
    throw error;
  });
  return true;
}

export async function handleAudioSelect(interaction: StringSelectMenuInteraction) {
  const app = interaction.client as App;

  if (interaction.customId === AUDIO_CUSTOM_IDS.letsPlayPlaylist(interaction.guildId ?? "")) {
    return handlePlaylistLaunch(interaction, app, interaction.values[0] ?? "");
  }

  if (interaction.customId === AUDIO_CUSTOM_IDS.playlistLaunch(interaction.guildId ?? "")) {
    return handlePlaylistLaunch(interaction, app, interaction.values[0] ?? "");
  }

  return false;
}

export async function handleAudioModal(interaction: ModalSubmitInteraction) {
  const app = interaction.client as App;
  const copy = interaction.guildId
    ? await getAudioCommandCopy(interaction.guildId)
    : defaultAudioCommandCopy;

  if (interaction.customId === AUDIO_CUSTOM_IDS.welcomeVoiceModal(interaction.guildId ?? "")) {
    if (!interaction.guildId || !app.audio) {
      await replyNeutralMusicNotice(interaction, interaction.guildId ?? null, copy.controls.playerNotReady, "");
      return true;
    }

    const selectedChannels = interaction.fields.getSelectedChannels(`audio:voice_channel:${interaction.guildId}`, true);
    const voiceChannel = selectedChannels.first();
    if (!voiceChannel || (voiceChannel.type !== ChannelType.GuildVoice && voiceChannel.type !== ChannelType.GuildStageVoice)) {
      await replyNeutralMusicNotice(interaction, interaction.guildId, copy.voice.joinVoice, "");
      return true;
    }

    if (!interaction.channelId) {
      await replyNeutralMusicNotice(interaction, interaction.guildId, copy.errors.genericPlay, "");
      return true;
    }

    await app.audio.join(interaction.guildId, voiceChannel.id, interaction.channelId);
    const panel = await buildLetsPlayPanel({
      guildId: interaction.guildId,
      memberMention: interaction.user.toString(),
      playCommand: await formatSlashCommandMention(interaction.client, "play"),
      accentColor: await resolveAccentColor(interaction),
    });

    await interaction.reply({
      components: [panel],
      flags: MessageFlags.IsComponentsV2,
      allowedMentions: NO_PING_ALLOWED_MENTIONS,
    });
    return true;
  }

  if (interaction.customId === AUDIO_CUSTOM_IDS.addMusicModal(interaction.guildId ?? "")) {
    if (!interaction.guildId || !app.audio) {
      await replyNeutralMusicNotice(interaction, interaction.guildId ?? null, copy.errors.genericPlay, "");
      return true;
    }

    const query = interaction.fields.getTextInputValue(`audio:add_music_input:${interaction.guildId}`).trim();
    const member = interaction.member instanceof GuildMember
      ? interaction.member
      : await interaction.guild?.members.fetch(interaction.user.id).catch(() => null);
    const voiceChannelId = member?.voice.channelId ?? null;
    if (!voiceChannelId || !interaction.channelId) {
      await replyNeutralMusicNotice(interaction, interaction.guildId, copy.voice.joinVoiceForMusic, "");
      return true;
    }

    const result = await app.audio.play({
      guildId: interaction.guildId,
      voiceChannelId,
      textChannelId: interaction.channelId,
      query,
      requestedBy: interaction.user.id,
    }).catch(() => null);

    if (!result) {
      await replyNeutralMusicNotice(interaction, interaction.guildId, copy.errors.genericPlay, "");
      return true;
    }

    await interaction.reply({
      components: [await buildTrackNoticePanel(result.track, result.queued, interaction.guildId)],
      flags: MessageFlags.IsComponentsV2,
      allowedMentions: NO_PING_ALLOWED_MENTIONS,
    });
    return true;
  }

  return false;
}

export async function handleAudioButton(interaction: ButtonInteraction) {
  const app = interaction.client as App;
  const copy = interaction.guildId
    ? await getAudioCommandCopy(interaction.guildId)
    : defaultAudioCommandCopy;

  if (!interaction.customId.startsWith("audio:")) return false;
  if (!await requireTextReplyPermissions(interaction)) return true;

  if (!app.audio) {
    await replyNeutralMusicNotice(interaction, interaction.guildId ?? null, copy.controls.playerNotReady, "");
    return true;
  }

  const guildId = interaction.guildId;
  if (!guildId) {
    await replyNeutralMusicNotice(interaction, null, copy.serverOnly, "");
    return true;
  }

  if (interaction.customId === AUDIO_CUSTOM_IDS.welcomeStart(guildId)) {
    await interaction.showModal(await buildVoiceChannelModal(guildId));
    return true;
  }

  if (interaction.customId === AUDIO_CUSTOM_IDS.letsPlayAdd(guildId) || interaction.customId === AUDIO_CUSTOM_IDS.controlAdd(guildId)) {
    await interaction.showModal(await buildAddMusicModal(guildId));
    return true;
  }

  if (interaction.customId === AUDIO_CUSTOM_IDS.controlPlaylist(guildId)) {
    await interaction.reply({
      components: [await buildPlaylistLauncherPanel(guildId)],
      flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
      allowedMentions: NO_PING_ALLOWED_MENTIONS,
    });
    return true;
  }

  if (interaction.customId === AUDIO_CUSTOM_IDS.letsPlayQueue(guildId) || interaction.customId === AUDIO_CUSTOM_IDS.queueControl(guildId)) {
    const panel = interaction.customId === AUDIO_CUSTOM_IDS.queueControl(guildId)
      ? await buildControlPanel(await app.audio.getQueue(guildId), guildId)
      : await buildQueuePanel(await app.audio.getQueue(guildId), guildId);
    await interaction.reply({
      components: [panel],
      flags: MessageFlags.IsComponentsV2,
      allowedMentions: NO_PING_ALLOWED_MENTIONS,
    });
    return true;
  }

  if (interaction.customId === AUDIO_CUSTOM_IDS.controlQueue(guildId)) {
    if (!await requireControlVoice(interaction, app)) return true;
    await interaction.reply({
      components: [await buildQueuePanel(await app.audio.getQueue(guildId), guildId)],
      flags: MessageFlags.IsComponentsV2,
      allowedMentions: NO_PING_ALLOWED_MENTIONS,
    });
    return true;
  }

  if (interaction.customId === AUDIO_CUSTOM_IDS.controlOpen(guildId)) {
    const memberVoice = getInteractionMemberVoiceChannelId(interaction);
    const botVoice = app.audio.getPlayerVoiceChannelId(guildId);
    if (botVoice && memberVoice !== botVoice) {
      await replyNeutralMusicNotice(interaction, guildId, copy.voice.mustBeInBotVoiceForControl, "");
      return true;
    }

    await interaction.reply({
      components: [await buildControlPanel(await app.audio.getQueue(guildId), guildId)],
      flags: MessageFlags.IsComponentsV2,
      allowedMentions: NO_PING_ALLOWED_MENTIONS,
    });
    return true;
  }

  if (interaction.customId.startsWith("audio:listener_presence:")) {
    const [, , rawGuildId] = interaction.customId.split(":");
    if (rawGuildId !== guildId) {
      await replyNeutralMusicNotice(interaction, guildId, copy.controls.guildMismatch, "");
      return true;
    }

    const acknowledged = await app.audio.confirmListenerPresence(guildId, interaction.user.id);
    if (!acknowledged) {
      await replyNeutralMusicNotice(interaction, guildId, copy.voice.mustBeInBotVoiceForControl, "");
      return true;
    }

    await interaction.update({
      components: [await buildListenerPresencePanelState(guildId, acknowledged.listenerCount, "confirmed")],
      flags: MessageFlags.IsComponentsV2,
      allowedMentions: NO_PING_ALLOWED_MENTIONS,
    });
    return true;
  }

  if (interaction.customId.startsWith("audio:resume:")) {
    const [, , rawGuildId, voiceChannelId] = interaction.customId.split(":");
    if (rawGuildId !== guildId || !voiceChannelId) {
      await replyNeutralMusicNotice(interaction, guildId, copy.controls.guildMismatch, "");
      return true;
    }

    const resumed = await app.audio.resumeSession(guildId, voiceChannelId, interaction.channelId).catch(() => false);
    if (!resumed) {
      await replyNeutralMusicNotice(interaction, guildId, copy.errors.genericPlay, "");
      return true;
    }

    const state = await app.audio.getQueue(guildId);
    if (!state.current) {
      await replyNeutralMusicNotice(interaction, guildId, copy.noCurrentTrack, await getQueueEmptyHint(interaction, guildId));
      return true;
    }

    const accentColor = interaction.member instanceof GuildMember
      ? (interaction.member.displayColor || null)
      : null;

    await interaction.update({
      components: [await buildLetsPlayPanel({
        guildId,
        memberMention: interaction.user.toString(),
        playCommand: await formatSlashCommandMention(app, "play"),
        accentColor,
        resumeVoiceChannelId: voiceChannelId,
        resumeButtonDisabled: true,
      })],
      flags: MessageFlags.IsComponentsV2,
      allowedMentions: NO_PING_ALLOWED_MENTIONS,
    });

    await interaction.followUp({
      components: [await buildTrackNoticePanel(state.current, false, guildId, state.positionMs)],
      flags: MessageFlags.IsComponentsV2,
      allowedMentions: NO_PING_ALLOWED_MENTIONS,
    });
    return true;
  }

  if (interaction.customId === AUDIO_CUSTOM_IDS.controlToggle(guildId)) {
    if (!await requireControlVoice(interaction, app)) return true;
    if (!await ensureCurrentTrackAuthority(interaction, app)) {
      await replyNeutralMusicNotice(interaction, guildId, copy.controls.pauseDenied, "");
      return true;
    }

    await app.audio.pauseToggle(guildId);
    await interaction.update({
      components: [await buildControlPanel(await app.audio.getQueue(guildId), guildId)],
      flags: MessageFlags.IsComponentsV2,
      allowedMentions: NO_PING_ALLOWED_MENTIONS,
    });
    return true;
  }

  if (interaction.customId === AUDIO_CUSTOM_IDS.controlStop(guildId)) {
    if (!await requireControlVoice(interaction, app)) return true;
    if (!await ensureCurrentTrackAuthority(interaction, app)) {
      await replyNeutralMusicNotice(interaction, guildId, copy.controls.pauseDenied, "");
      return true;
    }

    await interaction.deferUpdate();
    await app.audio.stop(guildId, interaction.user.toString());
    return true;
  }

  if (interaction.customId === AUDIO_CUSTOM_IDS.controlShuffle(guildId)) {
    if (!await requireControlVoice(interaction, app)) return true;
    const result = await app.audio.shuffleQueue(guildId);
    if (!result.shuffled) {
      await replyNeutralMusicNotice(interaction, guildId, (await getGuildMessages(guildId)).music.shuffleUnavailable, "");
      return true;
    }

    await interaction.reply({
      components: [await buildQueuePanel(await app.audio.getQueue(guildId), guildId)],
      flags: MessageFlags.IsComponentsV2,
      allowedMentions: NO_PING_ALLOWED_MENTIONS,
    });
    return true;
  }

  if (interaction.customId === AUDIO_CUSTOM_IDS.controlSkip(guildId) || interaction.customId === AUDIO_CUSTOM_IDS.queueSkip(guildId)) {
    if (!await requireControlVoice(interaction, app)) return true;
    const vote = await app.audio.voteSkip(guildId, interaction.user.id);
    if (!vote.skipped) {
      if (vote.reason === "no_next") {
        await replyNeutralMusicNotice(interaction, guildId, copy.controls.noNextTrack, await getQueueEmptyHint(interaction, guildId));
        return true;
      }

      await replyNeutralMusicNotice(interaction, guildId, copy.voteSkip(vote.votes, vote.needed), "");
      return true;
    }

    await replyPublicQueue(interaction, app, guildId);
    return true;
  }

  if (interaction.customId === AUDIO_CUSTOM_IDS.controlPrevious(guildId) || interaction.customId === AUDIO_CUSTOM_IDS.queuePrevious(guildId)) {
    if (!await requireControlVoice(interaction, app)) return true;
    const vote = await app.audio.votePrevious(guildId, interaction.user.id);
    if (!vote.previous) {
      if (vote.reason === "no_previous") {
        await replyNeutralMusicNotice(interaction, guildId, copy.controls.noPreviousTrack, await getQueueEmptyHint(interaction, guildId));
        return true;
      }

      await replyNeutralMusicNotice(interaction, guildId, copy.votePrevious(vote.votes, vote.needed), "");
      return true;
    }

    await replyPublicQueue(interaction, app, guildId);
    return true;
  }

  return false;
}
