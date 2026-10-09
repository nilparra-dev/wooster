/** Relative luminance (WCAG) of an sRGB colour given as 0-255 channels. */
function luminance(channels: readonly number[]): number {
  const [r = 0, g = 0, b = 0] = channels.map((value) => {
    const unit = value / 255;
    return unit <= 0.03928 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Luminance of the chat panel background, #18181b. */
const PANEL_LUMINANCE = luminance([0x18, 0x18, 0x1b]);
/** WCAG AA contrast for body text. */
const MIN_CONTRAST = 4.5;

/**
 * A viewer's name colour, lightened until it reads on the dark chat panel.
 * Viewers pick any colour, including navy and black; Twitch adjusts those the
 * same way. Returns null for anything that is not a `#rrggbb` colour.
 */
export function readableColor(color: string | null): string | null {
  if (!color || !/^#[a-f\d]{6}$/i.test(color)) return null;
  const original = [1, 3, 5].map((at) => Number.parseInt(color.slice(at, at + 2), 16));
  // Mix towards white in 5% steps; the last step is white, which always passes.
  for (let step = 0; step <= 20; step += 1) {
    const mixed = original.map((value) => Math.round(value + (255 - value) * (step / 20)));
    if ((luminance(mixed) + 0.05) / (PANEL_LUMINANCE + 0.05) >= MIN_CONTRAST)
      return step === 0
        ? color
        : `#${mixed.map((value) => value.toString(16).padStart(2, "0")).join("")}`;
  }
  return "#ffffff";
}

export type TextToken =
  | { kind: "text"; text: string }
  | { kind: "emote"; name: string; url: string }
  | { kind: "link"; text: string; url: string }
  | { kind: "mention"; text: string };

const MENTION = /^@\w{2,25}[.,:;!?]?$/;

/**
 * Split message text into what chat draws differently: third-party emotes,
 * which are whole words that appear in `emotes`, links and @mentions. The
 * tokens joined back give the original text, whitespace included.
 */
export function tokenize(text: string, emotes: ReadonlyMap<string, string> | null): TextToken[] {
  const tokens: TextToken[] = [];
  let plain = "";
  const flush = () => {
    if (plain) tokens.push({ kind: "text", text: plain });
    plain = "";
  };
  for (const word of text.split(/(\s+)/)) {
    const emote = emotes?.get(word);
    if (emote) {
      flush();
      tokens.push({ kind: "emote", name: word, url: emote });
    } else if (/^https?:\/\/\S+$/i.test(word) && URL.canParse(word)) {
      flush();
      tokens.push({ kind: "link", text: word, url: word });
    } else if (MENTION.test(word)) {
      flush();
      tokens.push({ kind: "mention", text: word });
    } else plain += word;
  }
  flush();
  return tokens;
}
