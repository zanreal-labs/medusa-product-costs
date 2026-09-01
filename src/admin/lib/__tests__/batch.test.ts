import { describe, expect, it, vi } from "vitest";
import { createBatcher } from "../batch";

/** Runs the flush immediately, so a batch can be asserted without timers. */
const immediate = (flush: () => void) => {
  flush();
};

describe("createBatcher", () => {
  it("coalesces every key asked for in one tick into a single request", async () => {
    const fetchMany = vi.fn(async (keys: string[]) =>
      new Map(keys.map((key) => [key, `value:${key}`])),
    );
    const batcher = createBatcher(fetchMany, (flush) => {
      queueMicrotask(flush);
    });

    const results = await Promise.all([
      batcher.load("A"),
      batcher.load("B"),
      batcher.load("C"),
    ]);

    expect(results).toEqual(["value:A", "value:B", "value:C"]);
    expect(fetchMany).toHaveBeenCalledTimes(1);
    expect(fetchMany).toHaveBeenCalledWith(["A", "B", "C"]);
  });

  it("asks for a repeated key once and fans the answer out to every caller", async () => {
    // Two columns ask for the same SKU on the same row; the request must not
    // carry it twice.
    const fetchMany = vi.fn(async (keys: string[]) => new Map(keys.map((key) => [key, key])));
    const batcher = createBatcher(fetchMany, (flush) => {
      queueMicrotask(flush);
    });

    const results = await Promise.all([batcher.load("A"), batcher.load("A")]);

    expect(results).toEqual(["A", "A"]);
    expect(fetchMany).toHaveBeenCalledWith(["A"]);
  });

  it("resolves null for a key the source has no value for", async () => {
    // "This variant has no cost on file" is a fact worth rendering, and must
    // stay distinguishable from a failed lookup.
    const batcher = createBatcher(async () => new Map<string, string>(), immediate);
    await expect(batcher.load("missing")).resolves.toBeNull();
  });

  it("rejects every waiter in a failed batch", async () => {
    const boom = new Error("network down");
    const batcher = createBatcher<string>(async () => {
      throw boom;
    }, immediate);

    await expect(batcher.load("A")).rejects.toBe(boom);
  });

  it("does not let a late caller join a request already sent", async () => {
    const fetchMany = vi.fn(async (keys: string[]) => new Map(keys.map((key) => [key, key])));
    const batcher = createBatcher(fetchMany, (flush) => {
      queueMicrotask(flush);
    });

    const first = batcher.load("A");
    await first;
    await batcher.load("B");

    expect(fetchMany).toHaveBeenCalledTimes(2);
    expect(fetchMany).toHaveBeenNthCalledWith(1, ["A"]);
    expect(fetchMany).toHaveBeenNthCalledWith(2, ["B"]);
  });
});
