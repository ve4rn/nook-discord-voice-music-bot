import { describe, expect, it } from "vitest";
import { prependStoredTrackOnce } from "./AudioManager.js";
import type { StoredTrack } from "../../types/audio.js";

function createTrack(title: string, suffix: string): StoredTrack {
  return {
    title,
    url: `https://example.com/${suffix}`,
    duration: 180000,
    requestedBy: "user-1",
    author: "Artist",
    identifier: suffix,
  };
}

describe("prependStoredTrackOnce", () => {
  it("inserts the current track once when going back", () => {
    const current = createTrack("Current", "current");
    const queue = [createTrack("Next", "next"), createTrack("Later", "later")];

    expect(prependStoredTrackOnce(current, queue)).toEqual([
      current,
      queue[0],
      queue[1],
    ]);
  });

  it("does not duplicate the current track when it is already at the front", () => {
    const previousCurrent = createTrack("Current", "current");
    const queue = [previousCurrent, createTrack("Later", "later")];

    expect(prependStoredTrackOnce(previousCurrent, queue)).toEqual(queue);
  });
});
