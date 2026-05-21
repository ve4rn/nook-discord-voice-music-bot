export type DefaultEmojisKey = "nook" | "nookIcon" |"control";
export type MusciEmojisKey = "play" | "pause" | "stop" | "skip" | "previous" | "add" | "shuffle" | "playlist" | "queue";
export type TrackEmojisKey = "track1" | "track2" | "track3" | "track4" | "track5" | "track6" | "track7";
type DiscordEmojiDefinition = {
  id: string;
  name: string;
};

const defaultEmojis: Record<DefaultEmojisKey, DiscordEmojiDefinition> = {
  nook: {
    id: "1506068564434485248",
    name: "Nook",
  },
  nookIcon: {
    id: "1506276216792023200",
    name: "NookIcon",
  },
  control: {
    id: "1506071195143901265",
    name: "ControlIcon",
  },
};

const musicEmojis: Record<MusciEmojisKey, DiscordEmojiDefinition> = {
    play: {
        id: "1506072205912444938",
        name: "PlayIcon",
    },
    pause: {
        id: "1506072224912769105",
        name: "PauseIcon",
    },
    stop: {
        id: "1506262524713111572",
        name: "StopIcon",
    },
    skip: {
        id: "1506072246584741918",
        name: "SkipForwardIcon",
    },
    previous: {
        id: "1506072322870743041",
        name: "SkipBackwardIcon",
    },
    add: {
        id: "1506257957795532972",
        name: "AddIcon",
    },
    shuffle: {
        id: "1506066625432916089",
        name: "ShuffleIcon",
    },
    playlist: {
        id: "1506257890888126474",
        name: "PlaylistIcon",
    },
    queue: {
        id: "1506437438782967859",
        name: "QueueIcon",
    }
}

const trackEmojis: Record<TrackEmojisKey, DiscordEmojiDefinition> = {
    track1: {
        id: "1506254292615692308",
        name: "SongTrack1",
    },
    track2: {
        id: "1506255194634326086",
        name: "SongTrack2",
    },
    track3: {
        id: "1506255917744656424",
        name: "SongTrack3",
    },
    track4: {
        id: "1506255975085113415",
        name: "SongTrack4",
    },
    track5: {
        id: "1506256165149868113",
        name: "SongTrack5",
    },
    track6: {
        id: "1506256517576523786",
        name: "SongTrack6",
    },
    track7: {
        id: "1506267955673960498",
        name: "SongTrack7",
    },
}

export function getDefaultEmoji(key: DefaultEmojisKey): DiscordEmojiDefinition {
    return defaultEmojis[key];
}

export function getDefaultEmojiMention(key: DefaultEmojisKey): string {
    const emoji = getDefaultEmoji(key);
    return `<:${emoji.name}:${emoji.id}>`;
}

export function getMusicEmoji(key: MusciEmojisKey): DiscordEmojiDefinition {
    return musicEmojis[key];
}

export function getMusicEmojiMention(key: MusciEmojisKey): string {
    const emoji = getMusicEmoji(key);
    return `<:${emoji.name}:${emoji.id}>`;
}

export function getTrackEmoji(key: TrackEmojisKey): DiscordEmojiDefinition {
    return trackEmojis[key];
}

export function getTrackEmojiMention(key: TrackEmojisKey): string {
    const emoji = getTrackEmoji(key);
    return `<:${emoji.name}:${emoji.id}>`;
}