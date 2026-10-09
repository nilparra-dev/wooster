// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readableColor, tokenize } from "./chat-text";

/** WCAG contrast of a `#rrggbb` colour against the chat panel, #18181b. */
function contrast(color: string): number {
  const luminance = (hex: string) => {
    const [r = 0, g = 0, b = 0] = [1, 3, 5].map((at) => {
      const unit = Number.parseInt(hex.slice(at, at + 2), 16) / 255;
      return unit <= 0.03928 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  return (luminance(color) + 0.05) / (luminance("#18181b") + 0.05);
}

describe("name colours", () => {
  it("keeps a colour that already reads on the panel", () => {
    for (const color of ["#ff7f50", "#9acd32", "#FFFFFF", "#bf94ff"])
      expect(readableColor(color)).toBe(color);
  });
  it("lightens dark colours until they pass, keeping their hue", () => {
    for (const color of ["#000000", "#0000ff", "#8a2be2", "#191970", "#b22222"]) {
      const readable = readableColor(color);
      expect(readable, color).toMatch(/^#[a-f\d]{6}$/);
      expect(contrast(readable ?? ""), color).toBeGreaterThanOrEqual(4.5);
    }
    // Blue stays the strongest channel of a lightened blue.
    const blue = readableColor("#0000ff") ?? "";
    expect(Number.parseInt(blue.slice(5, 7), 16)).toBeGreaterThan(
      Number.parseInt(blue.slice(1, 3), 16),
    );
  });
  it("rejects anything that is not a six-digit hex colour", () => {
    for (const color of [null, "", "red", "#fff", "#12345g", "url(x)", "#1234567"])
      expect(readableColor(color)).toBeNull();
  });
});

describe("message text", () => {
  const emotes = new Map([
    ["catJAM", "/emote/1"],
    [":tf:", "/emote/2"],
  ]);
  it("finds emotes, links and mentions as whole words and keeps the rest verbatim", () => {
    const text = "  catJAM  hi @someone_1: see https://example.com/a?b=1 :tf: catJAMs";
    const tokens = tokenize(text, emotes);
    expect(tokens).toEqual([
      { kind: "text", text: "  " },
      { kind: "emote", name: "catJAM", url: "/emote/1" },
      { kind: "text", text: "  hi " },
      { kind: "mention", text: "@someone_1:" },
      { kind: "text", text: " see " },
      { kind: "link", text: "https://example.com/a?b=1", url: "https://example.com/a?b=1" },
      { kind: "text", text: " " },
      { kind: "emote", name: ":tf:", url: "/emote/2" },
      { kind: "text", text: " catJAMs" },
    ]);
    const original = tokens.map((token) => ("text" in token ? token.text : token.name)).join("");
    expect(original).toBe(text);
  });
  it("links only http and https, and leaves look-alikes as text", () => {
    for (const text of [
      "javascript:alert(1)",
      "ftp://host/file",
      "http://",
      "email@host",
      "@",
      "@a",
    ])
      expect(tokenize(text, emotes), text).toEqual([{ kind: "text", text }]);
  });
  it("draws no emotes without a list", () => {
    expect(tokenize("catJAM", null)).toEqual([{ kind: "text", text: "catJAM" }]);
    expect(tokenize("", emotes)).toEqual([]);
  });
});
