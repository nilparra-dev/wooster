import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChatMessage } from "./archive";
import { Message } from "./Message";
import type { ChatImages } from "./useChatImages";

afterEach(cleanup);

const message: ChatMessage = {
  id: "1",
  offsetSeconds: 3725,
  createdAt: "2026-09-01T12:00:00Z",
  user: { id: "7", login: "wren", displayName: "Wren" },
  text: "nice Kappa run",
  color: "#ff7f50",
  fragments: [
    { text: "nice ", emoteId: null },
    { text: "Kappa", emoteId: "25" },
    { text: " run", emoteId: null },
  ],
  badges: [
    { setId: "subscriber", version: "12" },
    { setId: "unknown", version: "1" },
  ],
};
const images: ChatImages = {
  emote: (id) => `/api/emote/${id}`,
  badges: new Map([["subscriber/12", { title: "1-Year Subscriber", url: "/api/badge/abc" }]]),
  words: new Map([["catJAM", "/api/emote/7tv/abc"]]),
};
const show = (props: Partial<Parameters<typeof Message>[0]> = {}) =>
  render(
    <Message
      message={message}
      images={images}
      term=""
      onSeek={() => {}}
      onUser={() => {}}
      {...props}
    />,
  );

describe("chat message", () => {
  it("draws emotes and known badges through the local proxy", () => {
    show();
    expect(screen.getByAltText("Kappa")).toHaveAttribute("src", "/api/emote/25");
    expect(screen.getByAltText("1-Year Subscriber")).toHaveAttribute("src", "/api/badge/abc");
    // A badge the server did not list is left to the name's tooltip.
    expect(screen.getAllByRole("img")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Show messages from Wren" })).toHaveAttribute(
      "title",
      "subscriber 12, unknown 1",
    );
  });
  it("shows emotes as their names without a proxy or when the image fails", () => {
    const { container, unmount } = show({ images: null });
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(container).toHaveTextContent("Wren: nice Kappa run");
    unmount();
    const failing = show();
    fireEvent.error(screen.getByAltText("Kappa"));
    expect(screen.queryByAltText("Kappa")).not.toBeInTheDocument();
    expect(failing.container).toHaveTextContent("Wren: nice Kappa run");
  });
  it("marks the search text in the name and the message, whatever its case", () => {
    const { container } = show({ term: "n" });
    expect([...container.querySelectorAll("mark")].map((mark) => mark.textContent)).toEqual([
      "n",
      "n",
      "n",
    ]);
    // Marking splits the text into pieces without changing what it says.
    expect(container).toHaveTextContent("Wren: nice run");
  });
  it("seeks from the timestamp and filters from the name", () => {
    const onSeek = vi.fn();
    const onUser = vi.fn();
    show({ onSeek, onUser });
    fireEvent.click(screen.getByRole("button", { name: "Jump to 1:02:05" }));
    expect(onSeek).toHaveBeenCalledWith(3725);
    fireEvent.click(screen.getByRole("button", { name: "Show messages from Wren" }));
    expect(onUser).toHaveBeenCalledWith(message);
  });
  it("draws third-party emotes, links and mentions inside the text", () => {
    const { container } = show({
      message: {
        ...message,
        text: "catJAM @Wren, look https://clips.twitch.tv/abc catJAMMER",
        fragments: [
          { text: "catJAM @Wren, look https://clips.twitch.tv/abc catJAMMER", emoteId: null },
        ],
      },
    });
    // Only the whole word is the emote; a longer word that starts with it is text.
    expect(screen.getByAltText("catJAM")).toHaveAttribute("src", "/api/emote/7tv/abc");
    expect(container.querySelectorAll(".replay-emote")).toHaveLength(1);
    expect(container.querySelector(".replay-mention")).toHaveTextContent("@Wren,");
    const link = screen.getByRole("link", { name: "https://clips.twitch.tv/abc" });
    expect(link).toHaveAttribute("href", "https://clips.twitch.tv/abc");
    expect(link).toHaveAttribute("rel", "noreferrer noopener");
    expect(container).toHaveTextContent("Wren: @Wren, look https://clips.twitch.tv/abc catJAMMER");
  });
  it("lightens a name colour that would not read on the dark panel", () => {
    show({ message: { ...message, color: "#0000ff" } });
    const name = screen.getByRole("button", { name: "Show messages from Wren" });
    expect(name.style.color).not.toBe("rgb(0, 0, 255)");
    expect(name.style.color).not.toBe("");
  });
  it("renders archives without fragments and messages from deleted users", () => {
    const { container } = show({ message: { ...message, user: null, fragments: [], badges: [] } });
    expect(container).toHaveTextContent("Deleted user: nice Kappa run");
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });
});
