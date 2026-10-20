import { assertEquals } from "jsr:@std/assert@1";
import { collectScreenshots, INLINE_MAX_BYTES } from "./index.ts";

const blob = (n: number) => new Blob([new Uint8Array(n).fill(1)]);
function storage(opts: Record<string, { sign?: boolean; download?: number | "error" }>) {
  return {
    createSignedUrl: async (p: string) => opts[p].sign ? { data: { signedUrl: `https://s/${p}` }, error: null } : { data: null, error: new Error("x") },
    download: async (p: string) => {
      const d = opts[p].download;
      if (d === "error" || d === undefined) return { data: null, error: new Error("x") };
      return { data: blob(d), error: null };
    },
  };
}

Deno.test("signing failure on one capture keeps the valid one", async () => {
  const r = await collectScreenshots(storage({ a: { sign: false, download: "error" }, b: { sign: true, download: 10 } }), ["a", "b"]);
  assertEquals(r.items.length, 1);
  assertEquals(r.items[0].signedUrl, "https://s/b");
  assertEquals(r.attachments.length, 1);
  assertEquals(r.attachments[0].content_id, r.items[0].contentId);
});

Deno.test("all captures unavailable yields empty, never throws", async () => {
  const r = await collectScreenshots(storage({ a: { sign: false }, b: { sign: false } }), ["a", "b"]);
  assertEquals(r.items.length, 0);
  assertEquals(r.attachments.length, 0);
});

Deno.test("oversized or failed download keeps signed link without inline", async () => {
  const r = await collectScreenshots(storage({ big: { sign: true, download: INLINE_MAX_BYTES + 1 }, err: { sign: true, download: "error" } }), ["big", "err"]);
  assertEquals(r.items.map((i) => [i.signedUrl, i.contentId]), [["https://s/big", undefined], ["https://s/err", undefined]]);
  assertEquals(r.attachments.length, 0);
});
