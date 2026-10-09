import {
  ArrowRight,
  Check,
  ChevronDown,
  FolderOpen,
  History,
  Link,
  LoaderCircle,
  PanelRightOpen,
  RotateCcw,
  Upload,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState, type DragEvent } from "react";

import { ChatPanel } from "./ChatPanel";
import { GithubIcon } from "./GithubIcon";
import type { Setting } from "./SettingsMenu";
import { chapterAt, useBroadcast } from "./useBroadcast";
import { useChatImages } from "./useChatImages";
import { useChatReplay } from "./useChatReplay";
import { usePositionPersistence } from "./usePositionPersistence";
import { usePlayerBridge } from "./session";
import {
  clearRecent,
  loadChatOffset,
  loadPreferences,
  loadRecent,
  MAX_CHAT_OFFSET,
  PLAYBACK_RATES,
  rememberRecent,
  saveChatOffset,
  savePreferences,
} from "./storage";
import { useTheaterMode } from "./useTheaterMode";
import { useHls } from "./useHls";
import { VideoControls } from "./VideoControls";
import { parseStartTime, shortClock, splitStartTime, withStartTime } from "./time";
import "./player.css";

type Media =
  | { kind: "local"; file: File; url: string }
  /** `key` is the broadcast's target without any start time. */
  | { kind: "remote"; title: string; key: string; url: string };

const VIDEO_FILE = /\.(mp4|webm|m4v|mov|mkv)$/i;
const SPEED_OPTIONS = PLAYBACK_RATES.map((rate) => ({ value: String(rate), label: `${rate}×` }));

/** Twitch's playlist names for the two renditions that are not a resolution. */
function qualityLabel(id: string): string {
  if (id === "chunked" || id === "Source") return "Source";
  return id === "audio_only" ? "Audio only" : id;
}

function dateLabel(value: string | null): string | null {
  const time = value ? Date.parse(value) : Number.NaN;
  return Number.isNaN(time)
    ? null
    : new Date(time).toLocaleDateString(undefined, { dateStyle: "medium" });
}

/**
 * Storage identity of a video, shared by its saved position and chat offset.
 * A live broadcast has none: its timeline restarts with every session.
 */
function videoKey(media: Media | null, live: boolean): string {
  if (!media || live) return "";
  return media.kind === "local"
    ? `replay:${media.file.name}:${media.file.size}:${media.file.lastModified}`
    : `replay:stream:${media.key}`;
}

export function ReplayPlayer() {
  const { bridge, error: bridgeError } = usePlayerBridge();
  const [media, setMedia] = useState<Media | null>(null);
  const videoFile = media?.kind === "local" ? media.file : null;
  const videoUrl = media?.url ?? "";
  const [target, setTarget] = useState("");
  const [channel, setChannel] = useState("");
  const [openError, setOpenError] = useState("");
  const [loadedRevision, setLoadedRevision] = useState(-1);
  const [ignoreRemoteChat, setIgnoreRemoteChat] = useState(-1);
  const [videoError, setVideoError] = useState("");
  const [chatFile, setChatFile] = useState<File | null>(null);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [shift, setShift] = useState(0);
  const [speed, setSpeed] = useState(() => loadPreferences().speed);
  const [chatVisible, setChatVisible] = useState(() => loadPreferences().chatVisible);
  const [chatWidth, setChatWidth] = useState(() => loadPreferences().chatWidth);
  const [recent, setRecent] = useState(loadRecent);
  const [dragging, setDragging] = useState(false);
  const [copied, setCopied] = useState(false);
  const [theater, setTheater] = useTheaterMode();
  const video = useRef<HTMLVideoElement>(null);
  const videoPicker = useRef<HTMLInputElement>(null);
  const chatPicker = useRef<HTMLInputElement>(null);
  // Start time from a link, applied once to the next video that loads.
  const pendingStart = useRef(parseStartTime(new URLSearchParams(location.search).get("t") ?? ""));
  // Set when the same broadcast is about to reload (new quality, reconnect)
  // while playing, so the new <video> carries on instead of waiting paused.
  const resumePlaying = useRef(false);
  const loadedKey = useRef("");
  const remote = bridge?.session;
  const isLive = remote?.source === "live" && media?.kind === "remote";
  const storageKey = videoKey(media, isLive);
  const replayTime = time + shift;
  const remoteChat =
    remote?.state === "ready" &&
    remote.chat.kind === "ready" &&
    remote.revision !== ignoreRemoteChat &&
    media?.kind === "remote"
      ? remote.chat
      : null;
  const remoteChatUrl = remoteChat?.url;
  const remoteChatSize = remoteChat?.size ?? 0;
  const title = media?.kind === "remote" ? media.title : videoFile?.name;
  const recentKey = media?.kind === "remote" && !isLive ? media.key : null;

  const replay = useChatReplay({
    file: chatFile,
    ...(remoteChatUrl ? { remoteUrl: remoteChatUrl } : {}),
    remoteSize: remoteChatSize,
    time: replayTime,
    span: duration > 0 && !isLive ? { start: shift, end: duration + shift } : null,
  });
  const { chat, setQuery, setFollowing, reset, clearWindow } = replay;
  const { remember, restore } = usePositionPersistence(storageKey, video, (saved, length) => {
    if (recentKey) rememberRecent(recentKey, { time: saved, duration: length });
  });
  // The server's badges belong to the session's channel, so they apply only
  // while that session's own chat is the one on screen.
  const images = useChatImages(
    bridge?.api ?? null,
    remoteChat && !chatFile && remote ? remote.revision : null,
  );

  const broadcast = useBroadcast(
    bridge?.api ?? null,
    media?.kind === "remote" && remote?.state === "ready" ? remote.revision : null,
  );

  const liveEdge = useHls(video, videoUrl, media?.kind === "remote", setVideoError, isLive);

  useEffect(() => {
    if (
      !remote ||
      remote.state !== "ready" ||
      remote.revision === loadedRevision ||
      !remote.formats[0]
    )
      return;
    const broadcast = splitStartTime(remote.input);
    if (loadedKey.current === broadcast.input) {
      resumePlaying.current = Boolean(video.current && !video.current.paused);
    } else {
      resumePlaying.current = false;
      if (broadcast.start !== null) pendingStart.current = broadcast.start;
      if (remote.source !== "live") rememberRecent(broadcast.input, { title: remote.title });
    }
    loadedKey.current = broadcast.input;
    const next: Media = {
      kind: "remote",
      title: remote.title,
      key: broadcast.input,
      url: remote.formats[0].url,
    };
    setMedia(next);
    setTarget(broadcast.input);
    setLoadedRevision(remote.revision);
    setVideoError("");
    setChatFile(null);
    setTime(0);
    setDuration(0);
    setShift(loadChatOffset(videoKey(next, remote.source === "live")));
    reset();
  }, [remote, loadedRevision, reset]);

  useEffect(() => {
    return () => {
      if (media?.kind === "local") URL.revokeObjectURL(media.url);
    };
  }, [media]);

  // The recovered chat names the stream; the session only knows its channel
  // or VOD number, so prefer the chat's title in the recent list.
  const chatTitle = chat.kind === "ready" && remoteChat && !chatFile ? chat.info.title : null;
  const streamTitle = broadcast?.title ?? chatTitle;
  useEffect(() => {
    if (recentKey && streamTitle) rememberRecent(recentKey, { title: streamTitle });
  }, [recentKey, streamTitle]);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  function updateTime() {
    if (video.current) setTime(video.current.currentTime);
    remember();
  }

  function selectVideo(file: File) {
    remember(true);
    const next: Media = { kind: "local", file, url: URL.createObjectURL(file) };
    loadedKey.current = "";
    resumePlaying.current = false;
    setMedia(next);
    setIgnoreRemoteChat(remote?.revision ?? -1);
    setVideoError("");
    setOpenError("");
    setTime(0);
    setDuration(0);
    setShift(loadChatOffset(videoKey(next, false)));
    setChatFile(null);
    reset();
  }

  function attachChat(file: File) {
    setChatFile(file);
    setOpenError("");
    setQuery("");
    setFollowing(true);
  }

  function dropFiles(files: File[]) {
    const droppedVideo = files.find(
      (file) => file.type.startsWith("video/") || VIDEO_FILE.test(file.name),
    );
    const droppedChat = files.find(
      (file) => file.type === "application/json" || /\.json$/i.test(file.name),
    );
    if (droppedVideo) selectVideo(droppedVideo);
    if (droppedChat && (droppedVideo || media)) attachChat(droppedChat);
    else if (droppedChat) setOpenError("Open a video before adding its chat.");
    else if (!droppedVideo) setOpenError("Drop a video file or a chat.json export.");
  }

  function handleDrag(event: DragEvent<HTMLElement>) {
    if (!event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    setDragging(true);
  }

  const seek = useCallback(
    (offset: number) => {
      const element = video.current;
      if (!element || !Number.isFinite(element.duration)) return;
      element.currentTime = Math.min(element.duration, Math.max(0, offset - shift));
      reset();
      setTime(element.currentTime);
      remember(true);
    },
    [shift, reset, remember],
  );

  function changeOffset(seconds: number) {
    const value = Math.max(-MAX_CHAT_OFFSET, Math.min(MAX_CHAT_OFFSET, seconds));
    setShift(value);
    saveChatOffset(storageKey, value);
    clearWindow();
    setFollowing(true);
  }

  async function openTarget(input = target) {
    const broadcast = splitStartTime(input);
    if (!bridge || !broadcast.input) return;
    remember(true);
    setOpenError("");
    pendingStart.current = broadcast.start;
    try {
      await bridge.load(broadcast.input, channel.trim() || undefined);
    } catch (error) {
      setOpenError(error instanceof Error ? error.message : "Could not open this broadcast.");
    }
  }

  function changeQuality(url: string) {
    if (media?.kind !== "remote" || url === media.url) return;
    resumePlaying.current = Boolean(video.current && !video.current.paused);
    remember(true);
    setVideoError("");
    setMedia({ ...media, url });
  }

  const link = media?.kind === "remote" && !isLive ? withStartTime(media.key, time) : null;
  async function copyLink() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      setOpenError("The browser did not allow copying to the clipboard.");
    }
  }

  function showChat(visible: boolean) {
    savePreferences({ chatVisible: visible });
    setChatVisible(visible);
  }

  const settings: Setting[] = [];
  if (media?.kind === "remote" && remote && remote.formats.length > 0)
    settings.push({
      label: "Video quality",
      value: media.url,
      options: remote.formats.map((format) => ({
        value: format.url,
        label: qualityLabel(format.id),
      })),
      onChange: changeQuality,
    });
  if (!isLive)
    settings.push({
      label: "Playback speed",
      value: String(speed),
      options: SPEED_OPTIONS,
      onChange: (value) => {
        const rate = Number(value);
        if (video.current) video.current.playbackRate = rate;
        setSpeed(rate);
        savePreferences({ speed: rate });
      },
    });

  // The category on screen now: the chapter being played, when Twitch split
  // the broadcast into chapters, or else the one it filed the video under.
  const chapter = broadcast ? chapterAt(broadcast.chapters, time) : undefined;
  const category = chapter?.title ?? broadcast?.category ?? null;
  const date = dateLabel(broadcast?.startedAt ?? null);
  const resolving = remote?.state === "resolving";
  const sourceError = openError || bridgeError || (remote?.state === "error" ? remote.error : "");
  const downloading =
    media?.kind === "remote" && remote?.chat.kind === "downloading" ? remote.chat : null;
  const unavailable =
    media?.kind === "remote" && remote?.chat.kind === "unavailable" ? remote.chat.message : null;
  // The session's own chat was matched to the video by the server, so its
  // title can name the broadcast. A chat file the viewer picked is only shown
  // next to the video's name, for them to check the pairing.
  const paired = chatTitle !== null;
  return (
    <section
      aria-label="Local replay player"
      className={`replay-kit${theater ? " is-theater" : ""}${chatVisible ? "" : " chat-hidden"}${media ? " has-media" : ""}`}
      onDragEnter={handleDrag}
      onDragOver={handleDrag}
      onDragLeave={(event) => {
        if (!(
          event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)
        ))
          setDragging(false);
      }}
      onDrop={(event) => {
        if (!event.dataTransfer.types.includes("Files")) return;
        event.preventDefault();
        setDragging(false);
        dropFiles(Array.from(event.dataTransfer.files));
      }}
    >
      <header className="replay-topbar">
        <a className="replay-brand" href="./" aria-label="Wooster home">
          <img src="./favicon.svg" alt="" width={28} height={28} />
          <strong>wooster</strong>
        </a>
        <form
          className="replay-open-form"
          onSubmit={(event) => {
            event.preventDefault();
            void openTarget();
          }}
        >
          <div className="replay-url">
            <input
              aria-label="Open a broadcast"
              placeholder={
                bridge ? "Paste a VOD or tracker URL" : "Launch twitch-m3u8 watch to stream a URL"
              }
              value={target}
              onChange={(event) => setTarget(event.target.value)}
              disabled={!bridge || resolving}
            />
            <button
              type="submit"
              aria-label="Watch replay"
              title="Open broadcast"
              disabled={!bridge || resolving || !target.trim()}
            >
              <ArrowRight size={17} />
            </button>
          </div>
          <details className="replay-source-options">
            <summary title="Source options">
              <ChevronDown size={15} />
              <span className="sr-only">Source options</span>
            </summary>
            <div>
              <label>
                Channel, if needed
                <input
                  aria-label="Channel name (optional)"
                  placeholder="Channel name"
                  value={channel}
                  onChange={(event) => setChannel(event.target.value)}
                />
              </label>
            </div>
          </details>
        </form>
        <div className="replay-top-actions">
          <button
            type="button"
            className="vod-icon"
            aria-label="Open video"
            title="Open local video"
            onClick={() => videoPicker.current?.click()}
          >
            <FolderOpen size={19} />
          </button>
          <a
            href="https://github.com/nilparra-dev/wooster"
            target="_blank"
            rel="noreferrer"
            aria-label="Source on GitHub"
            title="Source on GitHub"
            className="vod-icon"
          >
            <GithubIcon size={19} />
          </a>
        </div>
      </header>
      {sourceError && (
        <p className="replay-source-error" role="alert">
          {sourceError}
        </p>
      )}
      <div
        className="replay-layout"
        // Only a width the viewer chose is set here; otherwise the stylesheet
        // sizes the chat column for the window.
        style={
          chatVisible && chatWidth !== null
            ? { gridTemplateColumns: `minmax(0, 1fr) min(${chatWidth}px, 55vw)` }
            : undefined
        }
      >
        <div className="replay-main">
          <div className="replay-screen">
            {videoUrl ? (
              <video
                key={videoUrl}
                ref={video}
                src={media?.kind === "local" ? videoUrl : undefined}
                playsInline
                preload="metadata"
                aria-label={isLive ? "Live video" : "Archived video"}
                onTimeUpdate={updateTime}
                onSeeking={() => {
                  clearWindow();
                  setFollowing(true);
                  updateTime();
                }}
                onSeeked={updateTime}
                onWaiting={updateTime}
                onPlaying={updateTime}
                onPause={() => {
                  updateTime();
                  remember(true);
                }}
                onEnded={() => remember(true)}
                onRateChange={() => {
                  if (video.current) setSpeed(video.current.playbackRate);
                }}
                onDurationChange={() => {
                  const length = video.current?.duration ?? 0;
                  setDuration(Number.isFinite(length) ? length : 0);
                }}
                onLoadedMetadata={() => {
                  const element = video.current;
                  if (!element) return;
                  element.playbackRate = speed;
                  const start = pendingStart.current;
                  pendingStart.current = null;
                  // A linked moment wins over the saved position: the viewer
                  // asked for it now.
                  if (start !== null && Number.isFinite(element.duration))
                    element.currentTime = Math.max(0, Math.min(start, element.duration - 1));
                  else restore();
                  if (resumePlaying.current) {
                    resumePlaying.current = false;
                    // If the browser refuses, the video stays paused with the
                    // play button showing, which is the state to recover from.
                    void element.play().catch(() => undefined);
                  }
                  updateTime();
                }}
                onError={() =>
                  setVideoError(
                    media?.kind === "remote"
                      ? "Playback stopped. Reconnect the broadcast or try another quality."
                      : "This browser cannot play this file. Try an H.264/AAC MP4 or WebM.",
                  )
                }
              />
            ) : (
              <div className="replay-empty-video">
                <History size={36} strokeWidth={1.4} />
                <h1>Open a broadcast</h1>
                <p>
                  {bridge
                    ? "Paste a link above, or drop a video from your files."
                    : "Choose or drop a video from your files to start watching."}
                </p>
                <button
                  type="button"
                  className="replay-button"
                  onClick={() => videoPicker.current?.click()}
                >
                  <FolderOpen size={15} />
                  Open video file
                </button>
                <span>Chat can be added at any time.</span>
                {bridge && recent.length > 0 && (
                  <div className="replay-recent">
                    <div className="replay-recent-heading">
                      <h2>Continue watching</h2>
                      <button
                        type="button"
                        onClick={() => {
                          clearRecent();
                          setRecent([]);
                        }}
                      >
                        Clear
                      </button>
                    </div>
                    <ul>
                      {recent.map((item) => (
                        <li key={item.input}>
                          <button
                            type="button"
                            disabled={resolving}
                            onClick={() => {
                              setTarget(item.input);
                              void openTarget(item.input);
                            }}
                          >
                            <span className="replay-recent-title">{item.title || item.input}</span>
                            <span className="replay-recent-time">
                              {item.duration > 0
                                ? `${shortClock(item.time)} / ${shortClock(item.duration)}`
                                : "Not started"}
                            </span>
                            <span
                              className="replay-recent-progress"
                              style={{
                                width: `${item.duration > 0 ? Math.min(100, (item.time / item.duration) * 100) : 0}%`,
                              }}
                            />
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
            {!chatVisible && (
              <button
                type="button"
                className="vod-icon replay-chat-show"
                aria-label="Show chat"
                title="Show chat"
                onClick={() => showChat(true)}
              >
                <PanelRightOpen size={18} />
              </button>
            )}
            {resolving && (
              <div className="replay-resolving" role="status">
                <LoaderCircle size={30} strokeWidth={1.6} />
                Finding the broadcast…
              </div>
            )}
            {videoError && (
              <div className="replay-video-error" role="alert">
                <span>{videoError}</span>
                {media?.kind === "remote" && (
                  <button
                    type="button"
                    className="replay-button"
                    disabled={resolving}
                    onClick={() => void openTarget(media.key)}
                  >
                    <RotateCcw size={14} />
                    Reconnect
                  </button>
                )}
                <button
                  type="button"
                  className="vod-icon"
                  aria-label="Dismiss video error"
                  onClick={() => setVideoError("")}
                >
                  <X size={15} />
                </button>
              </div>
            )}
            <VideoControls
              video={video}
              source={videoUrl}
              theater={theater}
              onTheater={() => setTheater(!theater)}
              onError={setVideoError}
              live={isLive}
              liveEdge={liveEdge}
              activity={replay.activity}
              chapters={broadcast?.chapters}
              storyboard={broadcast?.storyboard}
              settings={settings}
            />
          </div>
          <div className="replay-details">
            {broadcast?.channel?.avatar && (
              <img className="replay-avatar" src={broadcast.channel.avatar} alt="" />
            )}
            <div className="replay-description">
              <h2>{streamTitle || title || "No video selected"}</h2>
              <div className="replay-metadata">
                {broadcast?.channel && (
                  <strong className="replay-channel">{broadcast.channel.name}</strong>
                )}
                <span className="replay-source-badge">
                  {media?.kind === "remote"
                    ? remote?.source === "live"
                      ? "Live · ads filtered"
                      : remote?.source === "hidden"
                        ? "Recovered VOD"
                        : "Twitch VOD"
                    : "Local video"}
                </span>
                {category && <span>{category}</span>}
                {/* A hidden VOD's own title already is its channel and date. */}
                {date && (streamTitle || remote?.source !== "hidden") && <span>{date}</span>}
                {streamTitle && remote?.source === "public" && <span>{title}</span>}
                {duration > 0 && !isLive && <span>{shortClock(duration)}</span>}
                <span>
                  {chat.kind === "ready"
                    ? `${chat.info.count.toLocaleString()} messages${chat.info.status === "partial" ? " · Partial archive" : ""}`
                    : media?.kind === "remote"
                      ? "Video loads as you watch"
                      : "Files stay on this device"}
                </span>
              </div>
              {chat.kind === "ready" && !paired && (
                <p className="replay-chat-title" title={chat.info.title}>
                  Chat: {chat.info.title} · VOD {chat.info.vodId}
                </p>
              )}
            </div>
            {link && (
              <button
                type="button"
                className="replay-button replay-copy"
                title={`Copy a link to ${shortClock(time)}`}
                onClick={() => void copyLink()}
              >
                {copied ? <Check size={14} /> : <Link size={14} />}
                {copied ? "Copied" : "Copy link at this time"}
              </button>
            )}
          </div>
        </div>
        <ChatPanel
          replay={replay}
          hidden={!chatVisible}
          time={replayTime}
          images={images}
          attached={chatFile?.name ?? (remoteChat ? "Recovered chat" : null)}
          canAttach={Boolean(media)}
          download={
            downloading
              ? {
                  messages: downloading.messages,
                  // The last saved message marks how far into the video the
                  // download has reached. It is never shown as complete: the
                  // server says so by switching the chat to ready.
                  percent:
                    duration > 0
                      ? Math.min(99, Math.floor((downloading.offsetSeconds / duration) * 100))
                      : null,
                }
              : null
          }
          unavailable={unavailable}
          offset={shift}
          onOffset={changeOffset}
          onSeek={seek}
          onAttach={() => chatPicker.current?.click()}
          onRemove={() => {
            setChatFile(null);
            setIgnoreRemoteChat(remote?.revision ?? -1);
            setQuery("");
          }}
          onHide={() => showChat(false)}
          onResize={(width, done) => {
            setChatWidth(width);
            if (done) savePreferences({ chatWidth: width });
          }}
        />
      </div>
      {dragging && (
        <div className="replay-drop" aria-hidden="true">
          <Upload size={30} strokeWidth={1.5} />
          Drop a video, its chat.json, or both
        </div>
      )}
      <input
        ref={videoPicker}
        type="file"
        accept="video/*,.mp4,.webm,.m4v,.mov,.mkv"
        aria-label="Video file"
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) selectVideo(file);
          event.target.value = "";
        }}
      />
      <input
        ref={chatPicker}
        type="file"
        aria-label={chatFile ? "Replace chat file" : "Add archived chat"}
        accept=".json,application/json"
        disabled={!media}
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) attachChat(file);
          event.target.value = "";
        }}
      />
    </section>
  );
}
