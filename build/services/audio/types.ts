import type { Track } from "lavalink-client";

export const MAX_AUDIO_QUEUE_SIZE = 10;

export function getAudioQueueSize(state: { current?: unknown | null; currentTrack?: unknown | null; queue: unknown[] }) {
    return state.queue.length + (state.current || state.currentTrack ? 1 : 0);
}

export function getAudioQueueAvailableSlots(state: { current?: unknown | null; currentTrack?: unknown | null; queue: unknown[] }) {
    return Math.max(0, MAX_AUDIO_QUEUE_SIZE - getAudioQueueSize(state));
}

export type BotLanguage = "fr" | "en" | "es" | "de";

export type AudioCommandCopy = {
    serverOnly: string;
    emptyQueue: string;
    noCurrentTrack: string;
    voteSkip: (votes: number, needed: number) => string;
    panel: {
        queueTitle: (count: number, label: string) => string;
        trackLabel: (count: number) => string;
        unknownAuthor: string;
        queuedTitle: string;
        playingTitle: string;
    };
    track: {
        unknownAuthor: string;
        authorLabel: string;
        durationLabel: string;
        live: string;
    };
    controls: {
        guildMismatch: string;
        playerNotReady: string;
        removeForbidden: string;
        removeMissing: string;
        shuffleTooSmall: string;
        noNextTrack: string;
        leaveSuccess: string;
    };
    session: {
        emptyDisconnect: string;
        voiceDisconnectedTitle: string;
        voiceDisconnectedDescription: string;
    };
    playlist: {
        title: (name: string) => string;
        description: (availableSlots: number) => string;
        truncated: (hiddenCount: number) => string;
        placeholder: string;
        serverOnly: string;
        guildMismatch: string;
        ownerOnly: string;
        empty: string;
        fullQueue: string;
        notFound: string;
        playerNotReady: string;
        noSelection: string;
        addFailed: string;
        added: (count: number) => string;
        partiallyAdded: (added: number, requested: number) => string;
    };
    voice: {
        joinVoice: string;
        joinVoiceForMusic: string;
        joinBotVoiceForControl: string;
        botAlreadyConnected: string;
        joinSuccess: string;
        noActivePlayer: string;
        mustBeInBotVoiceForMusic: string;
        mustBeInBotVoiceForControl: string;
    };
    errors: {
        lavalinkNotReady: string;
        lavalinkTimeout: string;
        trackNotFound: string;
        queueLimit: string;
        genericPlay: string;
    };
};

export const audioCommandCopies: Record<BotLanguage, AudioCommandCopy> = {
    fr: {
        serverOnly: "Cette commande doit etre utilisée dans un serveur.",
        emptyQueue: "Vous ne savez pas quoi lancer ? Essayez une ambiance prete avec /playlist.",
        noCurrentTrack: "Aucune musique en cours.",
        voteSkip: (votes, needed) => `Vote skip: ${votes}/${needed}.`,
        panel: {
            queueTitle: (count, label) => `### Queue (${count} ${label})`,
            trackLabel: count => count > 1 ? "titres" : "titre",
            unknownAuthor: "Auteur inconnu",
            queuedTitle: "### Ajouté a la file",
            playingTitle: "### Lecture lancée",
        },
        track: {
            unknownAuthor: "Auteur inconnu",
            authorLabel: "Auteur",
            durationLabel: "Durée",
            live: "live",
        },
        controls: {
            guildMismatch: "Ce controle ne correspond pas a ce serveur.",
            playerNotReady: "Le player audio n'est pas prêt.",
            removeForbidden: "Seule la personne qui a ajouté cette musique peut la retirer de la file.",
            removeMissing: "Cette musique n'est plus dans la file.",
            shuffleTooSmall: "Il faut au moins 5 titres dans la queue pour la mélanger.",
            noNextTrack: "Vous ne savez pas quoi lancer ? Essayez une ambiance prete avec /playlist.",
            leaveSuccess: "J'ai quitté le salon vocal et vidé l'état audio.",
        },
        session: {
            emptyDisconnect: "Je me deconnecte car il n'y a plus rien a jouer.",
            voiceDisconnectedTitle: "Session musique terminée",
            voiceDisconnectedDescription: "J'ai été retire du salon vocal. La session musique à été arrêtée et l'état audio à été réinitialisé.",
        },
        playlist: {
            title: name => `Playlist: ${name}`,
            description: availableSlots => `Selectionnez les titres a ajouter a la queue. Places disponibles: **${availableSlots}**.`,
            truncated: hiddenCount => `${hiddenCount} titre(s) supplementaire(s) ne sont pas affiches a cause de la limite Discord.`,
            placeholder: "Titres a ajouter",
            serverOnly: "Cette commande doit etre utilisee dans un serveur.",
            guildMismatch: "Ce menu ne correspond pas a ce serveur.",
            ownerOnly: "Seule la personne qui a lance la commande peut utiliser ce menu.",
            empty: "Cette playlist ne contient aucun titre pour le moment.",
            fullQueue: "La queue est pleine. Retirez des titres avant d'en ajouter.",
            notFound: "Playlist introuvable.",
            playerNotReady: "Le player audio n'est pas pret.",
            noSelection: "Aucun titre selectionne.",
            addFailed: "Impossible d'ajouter ces titres pour le moment.",
            added: count => `${count} titre(s) ajoute(s) a la queue.`,
            partiallyAdded: (added, requested) => `${added}/${requested} titre(s) ajoute(s). Certains titres n'ont pas pu etre resolus.`,
        },
        voice: {
            joinVoice: "Rejoignez un salon vocal avant d'utiliser cette commande.",
            joinVoiceForMusic: "Rejoignez un salon vocal avant d'utiliser la musique.",
            joinBotVoiceForControl: "Rejoignez mon salon vocal avant d'utiliser ce controle.",
            botAlreadyConnected: "Je suis deja connecté a un salon vocal.",
            joinSuccess: "Connecté au salon vocal.",
            noActivePlayer: "Aucun player actif.",
            mustBeInBotVoiceForMusic: "Vous devez être dans mon salon vocal pour utiliser la musique.",
            mustBeInBotVoiceForControl: "Vous devez être dans mon salon vocal pour utiliser ce controle.",
        },
        errors: {
            lavalinkNotReady: "Lavalink n'est pas encore connecté. Verifiez le service audio.",
            lavalinkTimeout: "Lavalink met trop de temps a repondre. Reessayez dans quelques secondes.",
            trackNotFound: "Je n'ai trouvé aucun resultat exploitable.",
            queueLimit: "La file est pleine: maximum 10 musiques.",
            genericPlay: "Impossible de lancer cette musique pour le moment.",
        },
    },
    en: {
        serverOnly: "This command must be used in a server.",
        emptyQueue: "No idea what to play? Try a ready-made vibe with /playlist.",
        noCurrentTrack: "No track is currently playing.",
        voteSkip: (votes, needed) => `Skip vote: ${votes}/${needed}.`,
        panel: {
            queueTitle: (count, label) => `### Queue (${count} ${label})`,
            trackLabel: count => count > 1 ? "tracks" : "track",
            unknownAuthor: "Unknown author",
            queuedTitle: "### Added to queue",
            playingTitle: "### Now playing",
        },
        track: {
            unknownAuthor: "Unknown author",
            authorLabel: "Author",
            durationLabel: "Duration",
            live: "live",
        },
        controls: {
            guildMismatch: "This control does not match this server.",
            playerNotReady: "The audio player is not ready.",
            removeForbidden: "Only the person who added this track can remove it from the queue.",
            removeMissing: "This track is no longer in the queue.",
            shuffleTooSmall: "There must be at least 5 tracks in the queue to shuffle it.",
            noNextTrack: "No idea what to play? Try a ready-made vibe with /playlist.",
            leaveSuccess: "I left the voice channel and cleared the audio state.",
        },
        session: {
            emptyDisconnect: "I am disconnecting because there is nothing left to play.",
            voiceDisconnectedTitle: "Music session ended",
            voiceDisconnectedDescription: "I was removed from the voice channel. The music session has been stopped and the audio state has been reset.",
        },
        playlist: {
            title: name => `Playlist: ${name}`,
            description: availableSlots => `Select the tracks to add to the queue. Available slots: **${availableSlots}**.`,
            truncated: hiddenCount => `${hiddenCount} additional track(s) are hidden because of Discord's menu limit.`,
            placeholder: "Tracks to add",
            serverOnly: "This command must be used in a server.",
            guildMismatch: "This menu does not belong to this server.",
            ownerOnly: "Only the person who ran this command can use this menu.",
            empty: "This playlist does not have any tracks yet.",
            fullQueue: "The queue is full. Remove tracks before adding more.",
            notFound: "Playlist not found.",
            playerNotReady: "The audio player is not ready.",
            noSelection: "No track selected.",
            addFailed: "I cannot add these tracks right now.",
            added: count => `${count} track(s) added to the queue.`,
            partiallyAdded: (added, requested) => `${added}/${requested} track(s) added. Some tracks could not be resolved.`,
        },
        voice: {
            joinVoice: "Join a voice channel before using this command.",
            joinVoiceForMusic: "Join a voice channel before using music.",
            joinBotVoiceForControl: "Join my voice channel before using this control.",
            botAlreadyConnected: "I am already connected to a voice channel.",
            joinSuccess: "Connected to the voice channel.",
            noActivePlayer: "No active player.",
            mustBeInBotVoiceForMusic: "You must be in my voice channel to use music.",
            mustBeInBotVoiceForControl: "You must be in my voice channel to use this control.",
        },
        errors: {
            lavalinkNotReady: "Lavalink is not connected yet. Check the audio service.",
            lavalinkTimeout: "Lavalink is taking too long to respond. Try again in a few seconds.",
            trackNotFound: "I could not find a usable result.",
            queueLimit: "The queue is full: maximum 10 tracks.",
            genericPlay: "I cannot play this track right now.",
        },
    },
    es: {
        serverOnly: "Este comando debe usarse en un servidor.",
        emptyQueue: "No sabes que reproducir? Prueba un ambiente listo con /playlist.",
        noCurrentTrack: "No hay musica en curso.",
        voteSkip: (votes, needed) => `Voto skip: ${votes}/${needed}.`,
        panel: {
            queueTitle: (count, label) => `### Cola (${count} ${label})`,
            trackLabel: count => count > 1 ? "canciones" : "cancion",
            unknownAuthor: "Autor desconocido",
            queuedTitle: "### Aniadido a la cola",
            playingTitle: "### Reproduccion iniciada",
        },
        track: {
            unknownAuthor: "Autor desconocido",
            authorLabel: "Autor",
            durationLabel: "Duracion",
            live: "directo",
        },
        controls: {
            guildMismatch: "Este control no corresponde a este servidor.",
            playerNotReady: "El reproductor de audio no esta listo.",
            removeForbidden: "Solo la persona que anadio esta cancion puede quitarla de la cola.",
            removeMissing: "Esta cancion ya no esta en la cola.",
            shuffleTooSmall: "Debe haber al menos 5 canciones en la cola para mezclarla.",
            noNextTrack: "No sabes que reproducir? Prueba un ambiente listo con /playlist.",
            leaveSuccess: "He salido del canal de voz y he limpiado el estado de audio.",
        },
        session: {
            emptyDisconnect: "Me desconecto porque no queda nada por reproducir.",
            voiceDisconnectedTitle: "Sesion de musica terminada",
            voiceDisconnectedDescription: "Me han sacado del canal de voz. La sesion de musica se ha detenido y el estado de audio se ha reiniciado.",
        },
        playlist: {
            title: name => `Playlist: ${name}`,
            description: availableSlots => `Selecciona las canciones que quieres anadir a la cola. Huecos disponibles: **${availableSlots}**.`,
            truncated: hiddenCount => `${hiddenCount} cancion(es) adicional(es) no se muestran por el limite de Discord.`,
            placeholder: "Canciones para anadir",
            serverOnly: "Este comando debe usarse en un servidor.",
            guildMismatch: "Este menu no corresponde a este servidor.",
            ownerOnly: "Solo la persona que ejecuto el comando puede usar este menu.",
            empty: "Esta playlist aun no contiene canciones.",
            fullQueue: "La cola esta llena. Quita canciones antes de anadir mas.",
            notFound: "Playlist no encontrada.",
            playerNotReady: "El reproductor de audio no esta listo.",
            noSelection: "No se selecciono ninguna cancion.",
            addFailed: "No puedo anadir estas canciones por ahora.",
            added: count => `${count} cancion(es) anadida(s) a la cola.`,
            partiallyAdded: (added, requested) => `${added}/${requested} cancion(es) anadida(s). Algunas canciones no se pudieron resolver.`,
        },
        voice: {
            joinVoice: "Unete a un canal de voz antes de usar este comando.",
            joinVoiceForMusic: "Unete a un canal de voz antes de usar la musica.",
            joinBotVoiceForControl: "Unete a mi canal de voz antes de usar este control.",
            botAlreadyConnected: "Ya estoy conectado a un canal de voz.",
            joinSuccess: "Conectado al canal de voz.",
            noActivePlayer: "No hay ningun reproductor activo.",
            mustBeInBotVoiceForMusic: "Debes estar en mi canal de voz para usar la musica.",
            mustBeInBotVoiceForControl: "Debes estar en mi canal de voz para usar este control.",
        },
        errors: {
            lavalinkNotReady: "Lavalink aun no esta conectado. Revisa el servicio de audio.",
            lavalinkTimeout: "Lavalink tarda demasiado en responder. Intentalo de nuevo en unos segundos.",
            trackNotFound: "No encontre ningun resultado utilizable.",
            queueLimit: "La cola esta llena: maximo 10 canciones.",
            genericPlay: "No puedo reproducir esta musica por ahora.",
        },
    },
    de: {
        serverOnly: "Dieser Befehl muss auf einem Server genutzt werden.",
        emptyQueue: "Keine Idee, was laufen soll? Probiere eine fertige Stimmung mit /playlist.",
        noCurrentTrack: "Es laeuft gerade kein Titel.",
        voteSkip: (votes, needed) => `Skip-Abstimmung: ${votes}/${needed}.`,
        panel: {
            queueTitle: (count, label) => `### Warteschlange (${count} ${label})`,
            trackLabel: count => count > 1 ? "Titel" : "Titel",
            unknownAuthor: "Unbekannter Autor",
            queuedTitle: "### Zur Warteschlange hinzugefuegt",
            playingTitle: "### Wiedergabe gestartet",
        },
        track: {
            unknownAuthor: "Unbekannter Autor",
            authorLabel: "Autor",
            durationLabel: "Dauer",
            live: "live",
        },
        controls: {
            guildMismatch: "Dieses Bedienelement gehoert nicht zu diesem Server.",
            playerNotReady: "Der Audioplayer ist noch nicht bereit.",
            removeForbidden: "Nur die Person, die diesen Titel hinzugefuegt hat, kann ihn aus der Warteschlange entfernen.",
            removeMissing: "Dieser Titel ist nicht mehr in der Warteschlange.",
            shuffleTooSmall: "Es muessen mindestens 5 Titel in der Warteschlange sein, um sie zu mischen.",
            noNextTrack: "Keine Idee, was laufen soll? Probiere eine fertige Stimmung mit /playlist.",
            leaveSuccess: "Ich habe den Sprachkanal verlassen und den Audiozustand geleert.",
        },
        session: {
            emptyDisconnect: "Ich trenne die Verbindung, weil nichts mehr abzuspielen ist.",
            voiceDisconnectedTitle: "Musiksitzung beendet",
            voiceDisconnectedDescription: "Ich wurde aus dem Sprachkanal entfernt. Die Musiksitzung wurde gestoppt und der Audiozustand wurde zurueckgesetzt.",
        },
        playlist: {
            title: name => `Playlist: ${name}`,
            description: availableSlots => `Waehle die Titel aus, die zur Warteschlange hinzugefuegt werden sollen. Freie Plaetze: **${availableSlots}**.`,
            truncated: hiddenCount => `${hiddenCount} weitere(r) Titel werden wegen des Discord-Menue-Limits nicht angezeigt.`,
            placeholder: "Titel hinzufuegen",
            serverOnly: "Dieser Befehl muss auf einem Server genutzt werden.",
            guildMismatch: "Dieses Menue gehoert nicht zu diesem Server.",
            ownerOnly: "Nur die Person, die den Befehl ausgefuehrt hat, kann dieses Menue nutzen.",
            empty: "Diese Playlist enthaelt noch keine Titel.",
            fullQueue: "Die Warteschlange ist voll. Entferne Titel, bevor du neue hinzufuegst.",
            notFound: "Playlist nicht gefunden.",
            playerNotReady: "Der Audioplayer ist noch nicht bereit.",
            noSelection: "Kein Titel ausgewaehlt.",
            addFailed: "Ich kann diese Titel gerade nicht hinzufuegen.",
            added: count => `${count} Titel zur Warteschlange hinzugefuegt.`,
            partiallyAdded: (added, requested) => `${added}/${requested} Titel hinzugefuegt. Einige Titel konnten nicht aufgeloest werden.`,
        },
        voice: {
            joinVoice: "Betritt einen Sprachkanal, bevor du diesen Befehl nutzt.",
            joinVoiceForMusic: "Betritt einen Sprachkanal, bevor du Musik nutzt.",
            joinBotVoiceForControl: "Betritt meinen Sprachkanal, bevor du dieses Bedienelement nutzt.",
            botAlreadyConnected: "Ich bin bereits mit einem Sprachkanal verbunden.",
            joinSuccess: "Mit dem Sprachkanal verbunden.",
            noActivePlayer: "Kein aktiver Player.",
            mustBeInBotVoiceForMusic: "Du musst in meinem Sprachkanal sein, um Musik zu nutzen.",
            mustBeInBotVoiceForControl: "Du musst in meinem Sprachkanal sein, um dieses Bedienelement zu nutzen.",
        },
        errors: {
            lavalinkNotReady: "Lavalink ist noch nicht verbunden. Pruefe den Audiodienst.",
            lavalinkTimeout: "Lavalink braucht zu lange zum Antworten. Versuche es in ein paar Sekunden erneut.",
            trackNotFound: "Ich habe kein nutzbares Ergebnis gefunden.",
            queueLimit: "Die Warteschlange ist voll: maximal 10 Titel.",
            genericPlay: "Ich kann diesen Titel gerade nicht abspielen.",
        },
    },
};

export const defaultAudioCommandCopy = audioCommandCopies.en;

export type StoredTrack = {
    title: string;
    url: string;
    duration: number;
    requestedBy: string;
    source?: string;
    author?: string;
    encoded?: string;
    identifier?: string;
    artworkUrl?: string | null;
    isStream?: boolean;
};

export type TrackSearchChoice = {
    token: string;
    label: string;
    track: StoredTrack;
    lavalinkTrack?: Track;
};

export function trackToStored(track: Track, requestedBy: string): StoredTrack {
    return {
        title: track.info.title,
        url: track.info.uri,
        duration: track.info.duration,
        requestedBy,
        source: track.info.sourceName,
        author: track.info.author,
        encoded: track.encoded,
        identifier: track.info.identifier,
        artworkUrl: track.info.artworkUrl,
        isStream: track.info.isStream,
    };
}

export function formatDuration(ms: number, copy: AudioCommandCopy = defaultAudioCommandCopy): string {
    if (!Number.isFinite(ms) || ms <= 0) return copy.track.live;
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    if (hours > 0) {
        return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
    }
    return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function formatTrackSummary(track: StoredTrack, copy: AudioCommandCopy = defaultAudioCommandCopy): string {
    const author = track.author?.trim() || copy.track.unknownAuthor;
    return `**${track.title}**\n> ${copy.track.authorLabel}: ${author}\n> ${copy.track.durationLabel}: ${formatDuration(track.duration, copy)}`;
}

export function formatQueueLine(track: StoredTrack, index: number, copy: AudioCommandCopy = defaultAudioCommandCopy): string {
    const author = track.author?.trim() || copy.track.unknownAuthor;
    return `#${String(index + 1).padStart(2, "0")} | ${track.title} - ${author} | ${formatDuration(track.duration, copy)}`;
}

export function getStoredTrackKey(track: StoredTrack): string {
    const rawKey = track.identifier || track.encoded || track.url || track.title;
    return rawKey.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 32) || "track";
}

export function formatProgress(positionMs: number, durationMs: number, copy: AudioCommandCopy = defaultAudioCommandCopy): string {
    if (!Number.isFinite(durationMs) || durationMs <= 0) return copy.track.live;
    const safePosition = Math.min(Math.max(0, positionMs), durationMs);
    const ratio = safePosition / durationMs;
    const activeIndex = Math.min(9, Math.floor(ratio * 10));
    const segments = Array.from({ length: 10 }, (_, index) => {
        if (index === 0) return activeIndex === 0 ? "<:line_1:1493641092787208192>" : "<:line_6:1493641026202501192>";
        if (index === 9) return activeIndex === 9 ? "<:line_7:1493641004576935966>" : "<:line_3:1493641132737822812>";
        if (index < activeIndex) return "<:line_5:1493641072256094432>";
        if (index === activeIndex) return "<:line_2:1493641050038997082>";
        return "<:line_4:1493641111900651600>";
    });
    return `${segments.join("")} ${formatDuration(safePosition, copy)} / ${formatDuration(durationMs, copy)}`;
}
