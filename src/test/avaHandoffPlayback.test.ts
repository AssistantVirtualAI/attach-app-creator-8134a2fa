import { describe, expect, it, vi } from "vitest";
import { playHandoffGreeting } from "../lib/planipret/avaHandoffPlayback";

describe("handoff spoken summary", () => {
  it("releases a failed automatic greeting so a later opening can play it", async () => {
    const release = vi.fn(async () => {});
    await expect(playHandoffGreeting({ automatic: true, claim: async () => true, play: async () => { throw new Error("audio_unavailable"); }, release })).rejects.toThrow("audio_unavailable");
    expect(release).toHaveBeenCalledTimes(1);
  });
  it("a duplicate automatic greeting never starts playback", async () => {
    const play = vi.fn(async () => {}), release = vi.fn(async () => {});
    expect(await playHandoffGreeting({ automatic: true, claim: async () => false, play, release })).toBe(false);
    expect(play).not.toHaveBeenCalled();
    expect(release).not.toHaveBeenCalled();
  });
  it("successful playback retains the one-shot claim", async () => {
    const release = vi.fn(async () => {});
    expect(await playHandoffGreeting({ automatic: true, claim: async () => true, play: async () => {}, release })).toBe(true);
    expect(release).not.toHaveBeenCalled();
  });
});