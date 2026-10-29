import { describe, expect, it } from "vitest";
import {
  graphemeLength,
  utf8ByteLength,
  xWeightedLength,
} from "../lib/text/length";

const family = "👨‍👩‍👧‍👧";

describe("text length", () => {
  it("counts a joined emoji as one grapheme", () => {
    expect(graphemeLength(family)).toBe(1);
    expect(family.length).toBe(11);
  });
  it("counts UTF-8 bytes", () => {
    expect(utf8ByteLength("aé€😀")).toBe(1 + 2 + 3 + 4);
  });
  it("x: URL is 23, emoji and CJK are 2", () => {
    expect(xWeightedLength(`a https://example.com/${"x".repeat(70)}`)).toBe(25);
    expect(xWeightedLength("😀")).toBe(2);
    expect(xWeightedLength(family)).toBe(2);
    expect(xWeightedLength("日本")).toBe(4);
    expect(xWeightedLength("abc")).toBe(3);
  });
});

describe("threadsLength", () => {
  it("emoji count by UTF-8 bytes, other text by code point", async () => {
    const { threadsLength } = await import("../lib/text/length");
    expect(threadsLength("😀")).toBe(4);
    expect(threadsLength(family)).toBe(25);
    expect(threadsLength("aé日")).toBe(3);
  });
});
