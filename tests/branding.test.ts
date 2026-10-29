import { describe, expect, it } from "vitest";
import { parseBranding, validateLogo } from "../lib/connect/branding";

const PNG = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0,
]);

describe("parseBranding", () => {
  it("accepts valid branding", () => {
    expect(parseBranding({ name: " Acme ", logo_key: "k" })).toEqual({
      name: "Acme",
      logo_key: "k",
    });
  });
  it("returns {} for invalid input", () => {
    expect(parseBranding({ name: "" })).toEqual({});
    expect(parseBranding({ name: "x".repeat(61) })).toEqual({});
    expect(parseBranding(null)).toEqual({});
  });
});

describe("validateLogo", () => {
  it("accepts a tiny PNG", () => {
    expect(validateLogo(PNG)).toMatchObject({ ok: true, ext: "png" });
  });
  it("rejects SVG", () => {
    const svg = new TextEncoder().encode(
      "<svg xmlns='http://www.w3.org/2000/svg'/>",
    );
    expect(validateLogo(svg).ok).toBe(false);
  });
  it("rejects a text file renamed .png", () => {
    expect(validateLogo(new TextEncoder().encode("hello world")).ok).toBe(
      false,
    );
  });
  it("rejects more than 512 KB", () => {
    const big = new Uint8Array(512 * 1024 + 1);
    big.set(PNG);
    expect(validateLogo(big).ok).toBe(false);
  });
});
