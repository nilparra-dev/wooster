import { useCallback, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import {
  ChevronDown,
  History,
  MessageSquare,
  Minus,
  PanelRightClose,
  Plus,
  Search,
  X,
} from "lucide-react";

import { parseSearchQuery, type ChatMessage } from "./archive";
import { readableColor } from "./chat-text";
import { Badges, Message } from "./Message";
import { CHAT_WIDTH, MAX_CHAT_OFFSET } from "./storage";
import { clock } from "./time";
import type { ChatImages } from "./useChatImages";
import type { ChatReplay } from "./useChatReplay";

interface ChatPanelProps {
  replay: ChatReplay;
  hidden: boolean;
  /** Replay clock: media time plus the sync offset. */
  time: number;
  images: ChatImages | null;
  /** Name of the attached chat, or null when there is none. */
  attached: string | null;
  /** False until a video is open: chat is always paired with one. */
  canAttach: boolean;
  /** Progress of the chat the watch server is still saving, when it is. */
  download: { messages: number; percent: number | null } | null;
  /** Why the watch server has no chat for this broadcast, when it has none. */
  unavailable: string | null;
  offset: number;
  onOffset: (seconds: number) => void;
  onSeek: (time: number) => void;
  onAttach: () => void;
  onRemove: () => void;
  onHide: () => void;
  /**
   * Called with the chat column's new width while its edge is dragged, and
   * with `done` once the viewer lets go.
   */
  onResize: (width: number, done: boolean) => void;
}

const RESIZE_STEP = 16;

export function ChatPanel({
  replay,
  hidden,
  time,
  images,
  attached,
  canAttach,
  download,
  unavailable,
  offset,
  onOffset,
  onSeek,
  onAttach,
  onRemove,
  onHide,
  onResize,
}: ChatPanelProps) {
  const {
    chat,
    ready,
    query,
    setQuery,
    searching,
    displayed,
    moreResults,
    loadingResults,
    loadMoreResults,
    following,
    setFollowing,
    held,
    setHeld,
    log,
    loadOlder,
    historyFull,
  } = replay;
  const panel = useRef<HTMLElement>(null);
  // The message whose author's card is open. The card is a view of the search
  // for that author, so it closes by itself when the search changes.
  const [card, setCard] = useState<ChatMessage | null>(null);
  const searchText = query.trim();
  const term = parseSearchQuery(query).text;
  const author = card?.user && query === `from:${card.user.login}` ? card.user : null;
  const showUser = useCallback(
    (message: ChatMessage) => {
      if (!message.user) return;
      setCard(message);
      setQuery(`from:${message.user.login}`);
    },
    [setQuery],
  );
  const status = searchText
    ? "Search results"
    : !ready
      ? "Chat replay"
      : !following
        ? "Paused while you scroll"
        : held
          ? "Paused while you hover"
          : "Following video time";

  // How far inside the column's left edge the pointer took hold of the handle.
  const grip = useRef(0);
  const clampWidth = (width: number) =>
    Math.round(Math.max(CHAT_WIDTH.min, Math.min(CHAT_WIDTH.max, width)));
  function drag(event: PointerEvent<HTMLDivElement>, done: boolean) {
    const box = panel.current?.getBoundingClientRect();
    if (!box || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
    // The column is anchored to its right edge, so its width is the distance
    // from that edge to where the pointer holds the handle.
    onResize(clampWidth(box.right - (event.clientX - grip.current)), done);
    if (done) event.currentTarget.releasePointerCapture(event.pointerId);
  }
  function resizeByKey(event: KeyboardEvent<HTMLDivElement>) {
    const box = panel.current?.getBoundingClientRect();
    const change =
      event.key === "ArrowLeft" ? RESIZE_STEP : event.key === "ArrowRight" ? -RESIZE_STEP : 0;
    if (!box || !change) return;
    event.preventDefault();
    onResize(clampWidth(box.width + change), true);
  }

  return (
    <aside ref={panel} aria-label="Replay chat" className="replay-chat" hidden={hidden}>
      <div
        className="replay-chat-resize"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize chat"
        tabIndex={0}
        onPointerDown={(event) => {
          event.preventDefault();
          grip.current = event.clientX - (panel.current?.getBoundingClientRect().left ?? 0);
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => drag(event, false)}
        onPointerUp={(event) => drag(event, true)}
        onKeyDown={resizeByKey}
      />
      <div className="replay-chat-heading">
        <button
          type="button"
          className="vod-icon"
          aria-label="Hide chat"
          title="Hide chat"
          onClick={onHide}
        >
          <PanelRightClose size={17} />
        </button>
        <h2>Stream Chat</h2>
        <span className="replay-chat-replay">
          <History size={12} />
          Replay
        </span>
      </div>
      <div className="replay-chat-tools">
        <time>{clock(time)}</time>
        <span>{status}</span>
      </div>
      {ready && (
        <div className="replay-search">
          <Search size={14} />
          <input
            aria-label="Search chat"
            placeholder="Search messages, or from:name"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          {query && (
            <button type="button" aria-label="Clear search" onClick={() => setQuery("")}>
              <X size={14} />
            </button>
          )}
        </div>
      )}
      {ready && author && card && (
        <div className="replay-user-card">
          <div>
            <Badges message={card} images={images} />
            <strong style={{ color: readableColor(card.color) ?? undefined }}>
              {author.displayName || author.login}
            </strong>
            {author.displayName.toLocaleLowerCase() !== author.login && (
              <span>@{author.login}</span>
            )}
          </div>
          <p>
            {searching
              ? "Finding their messages…"
              : `${displayed.length.toLocaleString()}${moreResults ? "+" : ""} ${displayed.length === 1 && !moreResults ? "message" : "messages"} in this chat`}
          </p>
          <button type="button" aria-label="Close user card" onClick={() => setQuery("")}>
            <X size={14} />
          </button>
        </div>
      )}
      <div className="replay-chat-window">
        {/* The log is silent to assistive technology: a replay can add several
            messages a second, and announcing each would bury everything else. */}
        <div
          ref={log}
          aria-label="Chat messages"
          role="log"
          aria-live="off"
          className={`replay-chat-log${searchText ? " is-search" : ""}`}
          tabIndex={0}
          // A mouse resting on the chat holds it still, so a name or a link
          // can be clicked before it scrolls away. Touch has no resting state.
          onPointerEnter={(event) => {
            if (event.pointerType === "mouse") setHeld(true);
          }}
          onPointerLeave={() => setHeld(false)}
          onScroll={() => {
            const element = log.current;
            if (searchText || !element) return;
            const atEnd = element.scrollHeight - element.scrollTop - element.clientHeight < 48;
            setFollowing(atEnd);
            if (!atEnd && element.scrollTop < 240) loadOlder();
          }}
        >
          {chat.kind === "none" && (
            <div className="replay-empty-chat">
              <MessageSquare size={24} strokeWidth={1.5} />
              <h3>
                {download
                  ? "Loading chat"
                  : unavailable
                    ? "Chat is unavailable"
                    : "Welcome to the replay."}
              </h3>
              <p role={unavailable && !download ? "alert" : undefined}>
                {download
                  ? `${download.messages.toLocaleString()} messages saved${download.percent === null ? "" : ` (${download.percent}%)`}. Keep watching while we get the rest.`
                  : (unavailable ??
                    "The conversation will follow the video. Open its chat archive to join the moment.")}
              </p>
              {download && (
                <progress
                  className="replay-progress"
                  aria-label="Chat download"
                  max={100}
                  {...(download.percent === null ? {} : { value: download.percent })}
                />
              )}
              <button
                type="button"
                className="replay-button"
                disabled={!canAttach}
                onClick={onAttach}
              >
                Open chat file
              </button>
            </div>
          )}
          {chat.kind === "loading" && (
            <div role="status" className="replay-chat-status">
              Indexing chat… {chat.percent}%
              <progress className="replay-progress" max={100} value={chat.percent} />
            </div>
          )}
          {chat.kind === "error" && (
            <p role="alert" className="replay-error">
              {chat.message}
            </p>
          )}
          {ready && searching && (
            <p role="status" className="replay-chat-status">
              Searching archive…
            </p>
          )}
          {ready && !searching && displayed.length === 0 && (
            <p className="replay-chat-status">
              {searchText ? "No matching messages." : "No messages at this point in the replay."}
            </p>
          )}
          {ready && !searchText && historyFull && (
            <p className="replay-chat-status">
              Older messages are not loaded here. Seek the video to read further back.
            </p>
          )}
          {ready &&
            displayed.map((message) => (
              <Message
                key={message.id}
                message={message}
                images={images}
                term={searchText ? term : ""}
                onSeek={onSeek}
                onUser={showUser}
              />
            ))}
          {searchText && !searching && moreResults && (
            <div className="replay-chat-status">
              <button
                type="button"
                className="replay-button"
                disabled={loadingResults}
                onClick={loadMoreResults}
              >
                {loadingResults ? "Searching…" : "Show more matches"}
              </button>
            </div>
          )}
        </div>
        {!following && !searchText && ready && (
          <button type="button" className="replay-follow" onClick={() => setFollowing(true)}>
            <ChevronDown size={14} />
            Chat paused due to scroll
          </button>
        )}
      </div>
      <div className="replay-chat-footer">
        <div className="replay-chat-file">
          <span title={attached ?? undefined}>{attached ?? "No chat attached"}</span>
          <button type="button" disabled={!canAttach} onClick={onAttach}>
            {attached ? "Replace" : "Open"}
          </button>
          {attached && (
            <button type="button" aria-label="Remove chat" onClick={onRemove}>
              <X size={13} />
            </button>
          )}
        </div>
        <div className="replay-offset">
          <label htmlFor="replay-offset">Sync offset</label>
          <span>
            <button
              type="button"
              aria-label="Show chat 1 second earlier"
              title="Show chat 1 second earlier"
              disabled={!ready || offset <= -MAX_CHAT_OFFSET}
              onClick={() => onOffset(offset - 1)}
            >
              <Minus size={13} />
            </button>
            <input
              id="replay-offset"
              type="number"
              aria-label="Chat offset in seconds"
              value={offset}
              disabled={!ready}
              step=".5"
              min={-MAX_CHAT_OFFSET}
              max={MAX_CHAT_OFFSET}
              onChange={(event) => {
                const value = event.target.valueAsNumber;
                if (Number.isFinite(value)) onOffset(value);
              }}
            />
            <button
              type="button"
              aria-label="Show chat 1 second later"
              title="Show chat 1 second later"
              disabled={!ready || offset >= MAX_CHAT_OFFSET}
              onClick={() => onOffset(offset + 1)}
            >
              <Plus size={13} />
            </button>
            s
          </span>
        </div>
        <p className="replay-readonly">Archived conversation · Read only</p>
      </div>
    </aside>
  );
}
