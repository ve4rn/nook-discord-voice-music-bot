import { describe, expect, it } from "vitest";
import { audioPlaylists } from "./playlists.js";

describe("audioPlaylists", () => {
  it("exposes local playlist tracks with persisted metadata", () => {
    for (const playlist of audioPlaylists) {
      for (const track of playlist.tracks) {
        expect(track.encoded).toBeTruthy();
        expect(track.url).toMatch(/^https?:\/\//);
        expect(typeof track.source).toBe("string");
        expect(track.source.length).toBeGreaterThan(0);
        expect(track.artworkUrl === null || /^https?:\/\//.test(track.artworkUrl)).toBe(true);
        expect(typeof track.isStream).toBe("boolean");
      }
    }
  });
});
