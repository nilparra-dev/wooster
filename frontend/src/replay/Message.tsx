import { memo, useState, type ReactNode } from "react";

import type { ChatMessage } from "./archive";
import { readableColor, tokenize } from "./chat-text";
import { shortClock } from "./time";
import type { ChatImages } from "./useChatImages";

/** Wrap each case-insensitive occurrence of `term` in a <mark>. */
function highlight(text: string, term: string): ReactNode {
  if (!term) return text;
  const lower = text.toLocaleLowerCase();
  // Lowercasing can change a string's length in a few scripts, which would
  // misplace the marks; those messages are shown without them.
  if (lower.length !== text.length) return text;
  const parts: ReactNode[] = [];
  let from = 0;
  for (let at = lower.indexOf(term); at !== -1; at = lower.indexOf(term, from)) {
    if (at > from) parts.push(text.slice(from, at));
    from = at + term.length;
    parts.push(<mark key={at}>{text.slice(at, from)}</mark>);
  }
  if (from < text.length) parts.push(text.slice(from));
  return parts;
}

function Emote({ name, src }: { name: string; src: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <>{name}</>;
  return (
    <img
      className="replay-emote"
      src={src}
      alt={name}
      title={name}
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
    />
  );
}

export function Badges({ message, images }: { message: ChatMessage; images: ChatImages | null }) {
  if (!images) return null;
  return (
    <>
      {message.badges.map((badge) => {
        const image = images.badges.get(`${badge.setId}/${badge.version}`);
        return (
          image && (
            <img
              key={badge.setId}
              className="replay-badge"
              src={image.url}
              alt={image.title}
              title={image.title}
              loading="lazy"
              decoding="async"
            />
          )
        );
      })}
    </>
  );
}

/** A text fragment with its third-party emotes, links and mentions drawn. */
function Text({ text, images, term }: { text: string; images: ChatImages | null; term: string }) {
  return (
    <>
      {tokenize(text, images?.words ?? null).map((token, index) => {
        switch (token.kind) {
          case "emote":
            return <Emote key={index} name={token.name} src={token.url} />;
          case "link":
            return (
              <a key={index} href={token.url} target="_blank" rel="noreferrer noopener">
                {highlight(token.text, term)}
              </a>
            );
          case "mention":
            return (
              <strong key={index} className="replay-mention">
                {highlight(token.text, term)}
              </strong>
            );
          case "text":
            return <span key={index}>{highlight(token.text, term)}</span>;
        }
      })}
    </>
  );
}

interface MessageProps {
  message: ChatMessage;
  images: ChatImages | null;
  /** Lowercased search text to mark in the message, or "" for none. */
  term: string;
  onSeek: (time: number) => void;
  /** Called with the message when its author's name is activated. */
  onUser: (message: ChatMessage) => void;
}

/**
 * One chat line. Memoized because the log holds up to a few hundred of them
 * and the player re-renders on every media clock tick.
 */
export const Message = memo(function Message({
  message,
  images,
  term,
  onSeek,
  onUser,
}: MessageProps) {
  const color = readableColor(message.color) ?? undefined;
  const name = message.user?.displayName || message.user?.login || "Deleted user";
  const badgeNames = message.badges.map((badge) => `${badge.setId} ${badge.version}`).join(", ");
  // Archives written before fragments were stored carry only the plain text.
  const fragments =
    message.fragments.length > 0 ? message.fragments : [{ text: message.text, emoteId: null }];
  return (
    <div className="replay-message">
      <button
        type="button"
        onClick={() => onSeek(message.offsetSeconds)}
        className="replay-message-time"
        aria-label={`Jump to ${shortClock(message.offsetSeconds)}`}
      >
        {shortClock(message.offsetSeconds)}
      </button>
      <Badges message={message} images={images} />
      {message.user ? (
        <button
          type="button"
          className="replay-message-name"
          style={{ color }}
          title={badgeNames || undefined}
          aria-label={`Show messages from ${name}`}
          onClick={() => onUser(message)}
        >
          {highlight(name, term)}
        </button>
      ) : (
        <span className="replay-message-name" style={{ color }}>
          {name}
        </span>
      )}
      <span>: </span>
      <span className="whitespace-pre-wrap">
        {fragments.map((fragment, index) =>
          fragment.emoteId && images ? (
            <Emote key={index} name={fragment.text} src={images.emote(fragment.emoteId)} />
          ) : (
            <Text key={index} text={fragment.text} images={images} term={term} />
          ),
        )}
      </span>
    </div>
  );
});
