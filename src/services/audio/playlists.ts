export type PlaylistTrackConfig = {
    id: string;
    title: string;
    author: string;
    duration: number;
    url: string;
    source: string;
    artworkUrl: string | null;
    isStream: boolean;
    encoded?: string;
    query?: string;
    identifier?: string;
    isrc?: string;
};

export type AudioPlaylistConfig = {
    id: string;
    name: string;
    description?: string;
    tracks: PlaylistTrackConfig[];
};

type RawPlaylistTrackConfig = Omit<PlaylistTrackConfig, "url" | "source" | "artworkUrl" | "isStream"> & Partial<Pick<PlaylistTrackConfig, "url" | "source" | "artworkUrl" | "isStream">>;

type RawAudioPlaylistConfig = Omit<AudioPlaylistConfig, "tracks"> & {
    tracks: RawPlaylistTrackConfig[];
};

function extractEncodedMetadata(encoded: string) {
    const decoded = Buffer.from(encoded, "base64").toString("utf8");
    const urls = [...decoded.matchAll(/https?:\/\/[^\s\u0000]+/g)]
        .map(match => match[0].replace(/\u0001+$/g, "").trim());
    const url = urls.find(candidate => !candidate.includes("/stream/hls")) ?? urls[0] ?? null;
    const artworkUrl = urls.find(candidate => /\.(?:png|jpe?g|webp)(?:[?#].*)?$/i.test(candidate)) ?? null;
    return { url, artworkUrl };
}

function inferTrackSource(url: string) {
    const normalized = url.toLowerCase();
    if (normalized.includes("youtube.com") || normalized.includes("youtu.be")) return "youtube";
    if (normalized.includes("soundcloud.com")) return "soundcloud";
    if (normalized.includes("spotify.com")) return "spotify";
    if (normalized.includes("deezer.com")) return "deezer";
    return "unknown";
}

function completePlaylistTrack(track: RawPlaylistTrackConfig): PlaylistTrackConfig {
    const embedded = track.encoded ? extractEncodedMetadata(track.encoded) : { url: null, artworkUrl: null };
    const url = (track.url ?? embedded.url)?.trim();
    if (!url) throw new Error(`Playlist track "${track.id}" is missing a canonical url.`);

    const source = (track.source ?? inferTrackSource(url)).trim();
    if (!source) throw new Error(`Playlist track "${track.id}" is missing a source.`);

    return {
        ...track,
        url,
        source,
        artworkUrl: track.artworkUrl?.trim() ?? embedded.artworkUrl,
        isStream: track.isStream ?? false,
    };
}

function completePlaylist(playlist: RawAudioPlaylistConfig): AudioPlaylistConfig {
    return {
        ...playlist,
        tracks: playlist.tracks.map(completePlaylistTrack),
    };
}

const rawAudioPlaylists: RawAudioPlaylistConfig[] = [
    {
        id: "vintage",
        name: "vintage",
        description: "80s & 90s vibes, retro pop, R&B and hip-hop classics",
        tracks: [
            {
                id: "1",
                encoded: "QAABKgMAPUJvb2dpZSBXb25kZXJsYW5kIChTaW5nbGUgVmVyc2lvbikgKGZlYXQuIEVhcnRoLCBXaW5kICYgRmlyZSkAEkVhcnRoLCBXaW5kICYgRmlyZQAAAAAABGjoAAtQYnBJeW43MHQ4YwABACtodHRwczovL3d3dy55b3V0dWJlLmNvbS93YXRjaD92PVBicEl5bjcwdDhjAQB9aHR0cHM6Ly95dDMuZ29vZ2xldXNlcmNvbnRlbnQuY29tL2JfR0xLeXdadmJLS044TW1idHJUakg1alZ5anNrWEk5VnVVSEhTRWJUdkt0YnUxMGIwNW1UWnd5UlJxS2laN0NMMEtZV2ZLMHdnenY2MkU9dzEwMDAtaDEwMDAAAAd5b3V0dWJlAAAAAAAAAAA=",
                title: "Boogie Wonderland (with The Emotions)",
                author: "Earth Wind & Fire",
                duration: 289000,
                source: "spotify",
                artworkUrl: "https://i.scdn.co/image/ab67616d0000b2738b2238ebc2b233ba73b8c4ca",
                url: "https://open.spotify.com/track/6ztstiyZL6FXzh4aG46ZPD"
            },
            {
                id: "2",
                encoded: "QAAA+gMADExldCdzIEdyb292ZQASRWFydGgsIFdpbmQgJiBGaXJlAAAAAAAFMCAAC2x0amlvNEFNMnV3AAEAK2h0dHBzOi8vd3d3LnlvdXR1YmUuY29tL3dhdGNoP3Y9bHRqaW80QU0ydXcBAH5odHRwczovL3l0My5nb29nbGV1c2VyY29udGVudC5jb20vb2hYbVhMOG1OQkl0bVlrMlNSdHg1ZHVaMUt5UVJFTUhqR2RvV3ZHNEZBNkg0R1pneDV0R0FIUUpROHN0MTJON0M3VUF2YU0zOXVHNGhqTE49dzEwMDAtaDEwMDAAAAd5b3V0dWJlAAAAAAAAAAA=",
                title: "Let's Groove",
                author: "Earth Wind & Fire",
                duration: 340000,
                source: "spotify",
                artworkUrl: "https://i.scdn.co/image/ab67616d0000b273e691caf11b86a3729899a304",
                url: "https://open.spotify.com/track/3koCCeSaVUyrRo3N2gHrd8"
            },
            {
                id: "3",
                encoded: "QAAAmwMABEp1bXAACVZhbiBIYWxlbgAAAAAAA6mAAAtnZ0pJOWRLQms0OAABACtodHRwczovL3d3dy55b3V0dWJlLmNvbS93YXRjaD92PWdnSkk5ZEtCazQ4AQAwaHR0cHM6Ly9pLnl0aW1nLmNvbS92aS9nZ0pJOWRLQms0OC9tcWRlZmF1bHQuanBnAAAHeW91dHViZQAAAAAAAAAA",
                title: "Jump",
                author: "Van Halen",
                duration: 240000,
                source: "spotify",
                artworkUrl: "https://i.scdn.co/image/ab67616d0000b27343de9079ae02773c1fae9a26",
                url: "https://open.spotify.com/track/6Fba9RZtC6vTY814JToDtP"
            },
            {
                id: "4",
                encoded: "QAABAwMAEkEgTWFuIFdpdGhvdXQgTG92ZQAVRW5nZWxiZXJ0IEh1bXBlcmRpbmNrAAAAAAADHOAAC28wV1dhQTNvRmE0AAEAK2h0dHBzOi8vd3d3LnlvdXR1YmUuY29tL3dhdGNoP3Y9bzBXV2FBM29GYTQBAH5odHRwczovL3l0My5nb29nbGV1c2VyY29udGVudC5jb20vUHp1dF9Nd2w5ZWFLeW1ENV92RkE0ZDR1cTJhLXQyanNwQlZtMGx3NDloSWhyNHd5Zy1wVkhQVnE0NGwyY3BrazAzLUZWTVdxMkRxcVlfR3c9dzEwMDAtaDEwMDAAAAd5b3V0dWJlAAAAAAAAAAA=",
                title: "A Man Without Love",
                author: "Engelbert Humperdinck",
                duration: 204000,
                source: "spotify",
                artworkUrl: "https://i.scdn.co/image/ab67616d0000b27313f61b73b155d49c9ad671b9",
                url: "https://open.spotify.com/track/0oUBuOO4g9P4lREqfqR5nq"
            },
            {
                id: "5",
                encoded: "QAABZgMAKkNhbid0IFRha2UgTXkgRXllcyBPZmYgWW91ICgyMDA2IFJlbWFzdGVyKQANRnJhbmtpZSBWYWxsaQAAAAAAAw6NAHFVOmh0dHBzOi8vYXBpLXYyLnNvdW5kY2xvdWQuY29tL21lZGlhL3NvdW5kY2xvdWQ6dHJhY2tzOjIxNDY5MzQ4MC8zYjg2YWU2MC03M2E0LTRlZTctOTk0YS1jMDIzYzE0YmI3YjQvc3RyZWFtL2hscwABAEtodHRwczovL3NvdW5kY2xvdWQuY29tL2ZyYW5raWV2YWxsaXRoZWZvdXJzZWFzb25zL2NhbnQtdGFrZS1teS1leWVzLW9mZi15b3UBADpodHRwczovL2kxLnNuZGNkbi5jb20vYXJ0d29ya3MtMnA1bzVyQ213WmJ4LTAtb3JpZ2luYWwuanBnAQAMVVNSSDEwNjUxNjIzAApzb3VuZGNsb3VkAAAAAAAAAAA=",
                title: "Can't Take My Eyes Off You",
                author: "Frankie Valli",
                duration: 200333,
                source: "soundcloud",
            },
            {
                id: "6",
                encoded: "QAAAoAMACkRhZGR5IENvb2wACEJvbmV5IE0uAAAAAAADNFAAC1BoU3BfLWR5akNnAAEAK2h0dHBzOi8vd3d3LnlvdXR1YmUuY29tL3dhdGNoP3Y9UGhTcF8tZHlqQ2cBADBodHRwczovL2kueXRpbWcuY29tL3ZpL1BoU3BfLWR5akNnL21xZGVmYXVsdC5qcGcAAAd5b3V0dWJlAAAAAAAAAAA=",
                title: "Daddy Cool",
                author: "Boney M.",
                duration: 210000,
                source: "youtube",
            },
            {
                id: "7",
                encoded: "QAAAmwMABVN1bm55AAhCb25leSBNLgAAAAAAA7FQAAtvSy0yVExYRTY0cwABACtodHRwczovL3d3dy55b3V0dWJlLmNvbS93YXRjaD92PW9LLTJUTFhFNjRzAQAwaHR0cHM6Ly9pLnl0aW1nLmNvbS92aS9vSy0yVExYRTY0cy9tcWRlZmF1bHQuanBnAAAHeW91dHViZQAAAAAAAAAA",
                title: "Sunny",
                author: "Boney M.",
                duration: 242000,
                source: "youtube",

            },
            {
                id: "8",
                encoded: "QAAAqwMAFkJlZSBHZWVzIC0gTmlnaHQgRmV2ZXIAB2JlZWdlZXMAAAAAAAMwaAALU2t5cFp1WTZadkEAAQAraHR0cHM6Ly93d3cueW91dHViZS5jb20vd2F0Y2g/dj1Ta3lwWnVZNlp2QQEAMGh0dHBzOi8vaS55dGltZy5jb20vdmkvU2t5cFp1WTZadkEvbXFkZWZhdWx0LmpwZwAAB3lvdXR1YmUAAAAAAAAAAA==",
                title: "Night Fever",
                author: "Bee Gees",
                duration: 209000,
                source: "youtube",
            },
            {
                id: "9",
                encoded: "QAAAqgMAFVlvdSBTaG91bGQgQmUgRGFuY2luZwAHYmVlZ2VlcwAAAAAAA+voAAsxc3FFNlAzWHlpUQABACtodHRwczovL3d3dy55b3V0dWJlLmNvbS93YXRjaD92PTFzcUU2UDNYeWlRAQAwaHR0cHM6Ly9pLnl0aW1nLmNvbS92aS8xc3FFNlAzWHlpUS9tcWRlZmF1bHQuanBnAAAHeW91dHViZQAAAAAAAAAA",
                title: "You Should Be Dancing",
                author: "Bee Gees",
                duration: 257000,
                source: "youtube",
            }
        ],
    },
    {
        id: "pop",
        name: "Pop",
        description: "Dark atmospheric hip-hop with heavy 808s",
        tracks: [
            {
                id: "1",
                encoded: "QAAAowMADk5vIFJvbGUgTW9kZWx6AAdKLiBDb2xlAAAAAAAEeIgACzBFblJLNVl2QndVAAEAK2h0dHBzOi8vd3d3LnlvdXR1YmUuY29tL3dhdGNoP3Y9MEVuUks1WXZCd1UBADBodHRwczovL2kueXRpbWcuY29tL3ZpLzBFblJLNVl2QndVL21xZGVmYXVsdC5qcGcAAAd5b3V0dWJlAAAAAAAAAAA=",
                title: "No Role Modelz",
                author: "J. Cole",
                duration: 293000,
                source: "youtube",
            },
            {
                id: "2",
                encoded: "QAAApAMACkdvb3NlYnVtcHMADFRyYXZpcyBTY290dAAAAAAAA7kgAAtGaFR0WVNVN1E3ZwABACtodHRwczovL3d3dy55b3V0dWJlLmNvbS93YXRjaD92PUZoVHRZU1U3UTdnAQAwaHR0cHM6Ly9pLnl0aW1nLmNvbS92aS9GaFR0WVNVN1E3Zy9tcWRlZmF1bHQuanBnAAAHeW91dHViZQAAAAAAAAAA",
                title: "Goosebumps",
                author: "Travis Scott",
                duration: 244000,
                source: "youtube",
            },
            {
                id: "3",
                encoded: "QAAAtQMAHUZhdGhlciBTdHJldGNoIE15IEhhbmRzIFB0LiAxAApLYW55ZSBXZXN0AAAAAAACE0AAC3d1TzRfUF84cC1RAAEAK2h0dHBzOi8vd3d3LnlvdXR1YmUuY29tL3dhdGNoP3Y9d3VPNF9QXzhwLVEBADBodHRwczovL2kueXRpbWcuY29tL3ZpL3d1TzRfUF84cC1RL21xZGVmYXVsdC5qcGcAAAd5b3V0dWJlAAAAAAAAAAA=",
                title: "Father Stretch My Hands Pt. 1",
                author: "Kanye West",
                duration: 136000,
                source: "youtube",
            },
            {
                id: "4",
                encoded: "QAAAxQMAKVN3aW1taW5nIFBvb2xzIChEcmFuaykgKEV4dGVuZGVkIFZlcnNpb24pAA5LZW5kcmljayBMYW1hcgAAAAAABMqQAAtVRUpUYVJlSTFscwABACtodHRwczovL3d3dy55b3V0dWJlLmNvbS93YXRjaD92PVVFSlRhUmVJMWxzAQAwaHR0cHM6Ly9pLnl0aW1nLmNvbS92aS9VRUpUYVJlSTFscy9tcWRlZmF1bHQuanBnAAAHeW91dHViZQAAAAAAAAAA",
                title: "Swimming Pools (Drank) (Extended Version)",
                author: "Kendrick Lamar",
                duration: 314000,
                source: "youtube",
            },
            {
                id: "5",
                encoded: "QAAApwMADkNvbGxhcmQgR3JlZW5zAAtTY0hvb2xib3kgUQAAAAAABJPgAAttNjFWTnQwck01cwABACtodHRwczovL3d3dy55b3V0dWJlLmNvbS93YXRjaD92PW02MVZOdDByTTVzAQAwaHR0cHM6Ly9pLnl0aW1nLmNvbS92aS9tNjFWTnQwck01cy9tcWRlZmF1bHQuanBnAAAHeW91dHViZQAAAAAAAAAA",
                title: "Collar Greens",
                author: "Schoolboy Q",
                duration: 300000,
                source: "youtube",
            },
            {
                id: "6",
                encoded: "QAABPAMAEE1lIGFuZCBZb3VyIE1hbWEAEENoaWxkaXNoIEdhbWJpbm8AAAAAAAXJiABxVTpodHRwczovL2FwaS12Mi5zb3VuZGNsb3VkLmNvbS9tZWRpYS9zb3VuZGNsb3VkOnRyYWNrczoyOTA5NDk1NTQvNTEwMzMzMTgtMzJkMi00NWFiLTg0YmItOGRkM2EwYTdhYzE0L3N0cmVhbS9obHMAAQA4aHR0cHM6Ly9zb3VuZGNsb3VkLmNvbS9jaGlsZGlzaC1nYW1iaW5vL21lLWFuZC15b3VyLW1hbWEBADpodHRwczovL2kxLnNuZGNkbi5jb20vYXJ0d29ya3MtZXZZdEhMQzd3dFBwLTAtb3JpZ2luYWwuanBnAQAMVVNZQUgxNjAwMTAyAApzb3VuZGNsb3VkAAAAAAAAAAA=",
                title: "Me and Your Mama",
                author: "Childish Gambino",
                duration: 379272,
                source: "soundcloud",
            },
            {
                id: "7",
                encoded: "QAABHwMABURvbid0AAxicnlzb250aWxsZXIAAAAAAAMGsgBxVTpodHRwczovL2FwaS12Mi5zb3VuZGNsb3VkLmNvbS9tZWRpYS9zb3VuZGNsb3VkOnRyYWNrczoyOTQzMjE4MzcvNGJkOWI2ZTQtOWE0Ny00MzMyLTljMTYtYTQ4NjQzZDgyZWQzL3N0cmVhbS9obHMAAQAqaHR0cHM6Ly9zb3VuZGNsb3VkLmNvbS9icnlzb250aWxsZXIvZG9udC0yAQA6aHR0cHM6Ly9pMS5zbmRjZG4uY29tL2FydHdvcmtzLU91MUlqaXdHT1ZmUS0wLW9yaWdpbmFsLmpwZwEADFVTUkMxMTUwMTA1MQAKc291bmRjbG91ZAAAAAAAAAAA",
                title: "Don't",
                author: "Bryson Tiller",
                duration: 198322,
                source: "soundcloud",
            },
            {
                id: "8",
                encoded: "QAAAzgMANFdoeSBJIExvdmUgWW91IC0gS2FueWUgV2VzdCwgSmF5LSBaIE11c2ljIHZpZGVvIChIRCkADEVtbWEgSGlnZ2lucwAAAAAAAxj4AAtCSG1MRmdhdnpwSQABACtodHRwczovL3d3dy55b3V0dWJlLmNvbS93YXRjaD92PUJIbUxGZ2F2enBJAQAwaHR0cHM6Ly9pLnl0aW1nLmNvbS92aS9CSG1MRmdhdnpwSS9tcWRlZmF1bHQuanBnAAAHeW91dHViZQAAAAAAAAAA",
                title: "Why I Love You",
                author: "Kanye West, Jay-Z, Mr Hudson",
                duration: 203000,
                source: "youtube",
            },
            {
                id: "9",
                encoded: "QAABUQMAHUppbW15IENvb2tzIChmZWF0LiAyMSBTYXZhZ2UpAA9vY3RvYmVyc3Zlcnlvd24AAAAAAANVKgByVTpodHRwczovL2FwaS12Mi5zb3VuZGNsb3VkLmNvbS9tZWRpYS9zb3VuZGNsb3VkOnRyYWNrczoxMjg5MDYxNDEyL2U3YmZjMjhjLTcwYzEtNDEzNi05Y2Q3LTY3MTZjZDFkOGQwYy9zdHJlYW0vaGxzAAEAQGh0dHBzOi8vc291bmRjbG91ZC5jb20vb2N0b2JlcnN2ZXJ5b3duL2RyYWtlLWppbW15LWNvb2tzLWZlYXQtMjEBADpodHRwczovL2kxLnNuZGNkbi5jb20vYXJ0d29ya3MtTnZ0TlNsalo4STh3LTAtb3JpZ2luYWwuanBnAQAMVVNVRzEyMjA0ODk3AApzb3VuZGNsb3VkAAAAAAAAAAA=",
                title: "Jimmy Cooks (feat. 21 Savage)",
                author: "Drake, 21 Savage",
                duration: 218410,
                source: "soundcloud"
            },
            {
                id: "10",
                encoded: "QAABOQMAEldha2UgVXAgaW4gdGhlIFNreQAKR3VjY2kgTWFuZQAAAAAAAxnHAHFVOmh0dHBzOi8vYXBpLXYyLnNvdW5kY2xvdWQuY29tL21lZGlhL3NvdW5kY2xvdWQ6dHJhY2tzOjUwMjU5NjAyNy8wMzc5ODA2Ni1kZjBiLTRjMjMtYjc4Yy01ZjFmNmJhNDlmNmYvc3RyZWFtL2hscwABADlodHRwczovL3NvdW5kY2xvdWQuY29tL2ZsYW1lZW1vamltdXNpYy93YWtlLXVwLWluLXRoZS1za3kBADpodHRwczovL2kxLnNuZGNkbi5jb20vYXJ0d29ya3MtMG9DZVR5WW95dzdJLTAtb3JpZ2luYWwuanBnAQAMVVNBVDIxODExMDg3AApzb3VuZGNsb3VkAAAAAAAAAAA=",
                title: "Wake Up in the Sky",
                author: "Gucci Mane, Bruno Mars, Kodak Black",
                duration: 203207,
                source: "soundcloud"
            },
        ]
    },
    {
        id: "soft-motion",
        name: "Soft Motion",
        description: "Chill, smooth and relaxing tracks for a cozy atmosphere",
        tracks: [
             {
                id: "1",
                encoded: "QAAApAMAEDlhbSBpbiBDYWxhYmFzYXMABkFkcmlhbgAAAAAAAcE4AAtUakRhZUw0NEgwUQABACtodHRwczovL3d3dy55b3V0dWJlLmNvbS93YXRjaD92PVRqRGFlTDQ0SDBRAQAwaHR0cHM6Ly9pLnl0aW1nLmNvbS92aS9UakRhZUw0NEgwUS9tcWRlZmF1bHQuanBnAAAHeW91dHViZQAAAAAAAAAA",
                title: "9am in Calabasas",
                author: "Adrian",
                duration: 115000,
                source: "youtube",
            },
            {
                id: "2",
                encoded: "QAAAtAMAHUV2ZXJ5dGhpbmcgSW4gSXRzIFJpZ2h0IFBsYWNlAAlSYWRpb2hlYWQAAAAAAAPYYAALTlVuWHhoNVUyNVkAAQAraHR0cHM6Ly93d3cueW91dHViZS5jb20vd2F0Y2g/dj1OVW5YeGg1VTI1WQEAMGh0dHBzOi8vaS55dGltZy5jb20vdmkvTlVuWHhoNVUyNVkvbXFkZWZhdWx0LmpwZwAAB3lvdXR1YmUAAAAAAAAAAA==",
                title: "Everything In Its Right Place",
                author: "Radiohead",
                duration: 252000,
                source: "youtube",
            },
            {
                id: "3",
                encoded: "QAABQgMAGFNEUCBJTlRFUkxVREUgKEV4dGVuZGVkKQAMVHJhdmlzIFNjb3R0AAAAAAAFAqcAclU6aHR0cHM6Ly9hcGktdjIuc291bmRjbG91ZC5jb20vbWVkaWEvc291bmRjbG91ZDp0cmFja3M6MTU2OTU1Mjc3OC83ZTFhM2IxOC0wNGI0LTQ0ZWMtOTliMS0yYjNlYzk5YzExMTgvc3RyZWFtL2hscwABAD5odHRwczovL3NvdW5kY2xvdWQuY29tL3NsZWV6aXRvL3NkcC1pbnRlcmx1ZGUtZXh0ZW5kZWQtZWRpdGlvbgEAQ2h0dHBzOi8vaTEuc25kY2RuLmNvbS9hcnR3b3Jrcy1xZjk3eU0yZzYwN251OVB6LWFDdmdVUS1vcmlnaW5hbC5qcGcAAApzb3VuZGNsb3VkAAAAAAAAAAA=",
                title: "sdp interlude (Extended Version)",
                author: "Travis Scott",
                duration: 328359,
                source: "soundcloud",
            },
            {
                id: "4",
                encoded: "QAABPQMAE21pZ2h0IHN0YXJ0IHNpbmdpbmcAFnd1dnYgKHNoZWxkb24gY2hhcmxvdCkAAAAAAAHuSQByVTpodHRwczovL2FwaS12Mi5zb3VuZGNsb3VkLmNvbS9tZWRpYS9zb3VuZGNsb3VkOnRyYWNrczoxMzI1MTk3MjM3LzIyN2NlNDZmLThmNWYtNGQ3My1iYzYyLTJlZDAxNDRlOWQxZC9zdHJlYW0vaGxzAAEAL2h0dHBzOi8vc291bmRjbG91ZC5jb20vd3V2di9taWdodC1zdGFydC1zaW5naW5nAQA6aHR0cHM6Ly9pMS5zbmRjZG4uY29tL2FydHdvcmtzLWNGbFljMlhkYWFuNy0wLW9yaWdpbmFsLmpwZwEADFFaRVM5MjIxNTU4MAAKc291bmRjbG91ZAAAAAAAAAAA",
                title: "might start singing",
                author: "sheldon charlot",
                duration: 126537,
                source: "soundcloud",

            },
            {
                id: "5",
                encoded: "QAAAngMAC05vdCBZb3UgVG9vAAVEcmFrZQAAAAAABB6wAAt5QV92YUNCWldNcwABACtodHRwczovL3d3dy55b3V0dWJlLmNvbS93YXRjaD92PXlBX3ZhQ0JaV01zAQAwaHR0cHM6Ly9pLnl0aW1nLmNvbS92aS95QV92YUNCWldNcy9tcWRlZmF1bHQuanBnAAAHeW91dHViZQAAAAAAAAAA",
                title: "Not You Too",
                author: "Drake, Chris Brown",
                duration: 270000,
                source: "youtube",
            },
            {
                id: "6",
                encoded: "QAAAvQMAKExvVmliZS4gLSBhIGdvb2QgbWFuIHdpdGggYSBicm9rZW4gaGVhcnQAB0xvVmliZS4AAAAAAAHQ2AALc0t3VnJzTWY2ZzAAAQAraHR0cHM6Ly93d3cueW91dHViZS5jb20vd2F0Y2g/dj1zS3dWcnNNZjZnMAEAMGh0dHBzOi8vaS55dGltZy5jb20vdmkvc0t3VnJzTWY2ZzAvbXFkZWZhdWx0LmpwZwAAB3lvdXR1YmUAAAAAAAAAAA==",
                title: "a good man with a broken heart",
                author: "LoVibe.",
                duration: 119000,
                source: "youtube"
            },
            {
                id: "7",
                encoded: "QAAAqgMAFUxlYW5pbiAoVWx0cmEgU2xvd2VkKQAHQ29yTWlsbAAAAAAAAqewAAtvMHVTTEd0bl9oNAABACtodHRwczovL3d3dy55b3V0dWJlLmNvbS93YXRjaD92PW8wdVNMR3RuX2g0AQAwaHR0cHM6Ly9pLnl0aW1nLmNvbS92aS9vMHVTTEd0bl9oNC9tcWRlZmF1bHQuanBnAAAHeW91dHViZQAAAAAAAAAA",
                title: "Leanin (Ultra Slowed)",
                author: "CorMill",
                duration: 174000,
                source: "youtube"
            },
            {
                id: "8",
                encoded: "QAABRwMAGUp1c3QgR2l2ZSBNZSBPbmUgTW9yZSBEYXkABEFsZWoAAAAAAAIApwByVTpodHRwczovL2FwaS12Mi5zb3VuZGNsb3VkLmNvbS9tZWRpYS9zb3VuZGNsb3VkOnRyYWNrczoxNTM3MzEwNTI0L2JlOGU0MWZkLTEzOWItNGNkNi1hZjlhLThkMjk2YzdjNDc0YS9zdHJlYW0vaGxzAAEASmh0dHBzOi8vc291bmRjbG91ZC5jb20vYWxlamFuZHJvLXZhcmdhcy0xOTg2MDAvanVzdC1naXZlLW1lLW9uZS1tb3JlLWRheS0xAQBDaHR0cHM6Ly9pMS5zbmRjZG4uY29tL2FydHdvcmtzLU1MeUlOWXNWMFZDUGZXb3otYTFzUmx3LW9yaWdpbmFsLmpwZwAACnNvdW5kY2xvdWQAAAAAAAAAAA==",
                title: "Just Give Me One More Day",
                author: "Alej",
                duration: 131239,
                source: "soundcloud"
            },
            {
                id: "9",
                encoded:  "QAAAswMAFkFsbCBJIG5lZWQgLSBSYWRpb2hlYWQAD01hc3NpbW8gVHJvdmF0bwAAAAAAA3qgAAtqWmtJaFY1OF9xYwABACtodHRwczovL3d3dy55b3V0dWJlLmNvbS93YXRjaD92PWpaa0loVjU4X3FjAQAwaHR0cHM6Ly9pLnl0aW1nLmNvbS92aS9qWmtJaFY1OF9xYy9tcWRlZmF1bHQuanBnAAAHeW91dHViZQAAAAAAAAAA",
                title: "All I need",
                author: "Radiohead",
                duration: 228000,
                source: "youtube"
            }
        ]
    }
];

export const audioPlaylists: AudioPlaylistConfig[] = rawAudioPlaylists.map(completePlaylist);

export function getAudioPlaylist(id: string) {
    return audioPlaylists.find(playlist => playlist.id === id) ?? null;
}

export function searchAudioPlaylists(query: string) {
    const normalized = query.trim().toLowerCase();
    const playlists = normalized
        ? audioPlaylists.filter(playlist =>
            playlist.id.toLowerCase().includes(normalized)
            || playlist.name.toLowerCase().includes(normalized)
            || playlist.description?.toLowerCase().includes(normalized),
        )
        : audioPlaylists;

    return playlists.slice(0, 25);
}
