import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent,
  type RefObject,
} from "react";
import {
  FastForward,
  LoaderCircle,
  Maximize,
  Minimize,
  Pause,
  PictureInPicture2,
  Play,
  RectangleHorizontal,
  Rewind,
  Volume2,
  VolumeX,
} from "lucide-react";

import { SettingsMenu, type Setting } from "./SettingsMenu";
import { loadPreferences, savePreferences } from "./storage";
import { clock as mediaClock, shortClock } from "./time";
import { chapterAt, type Chapter, type Storyboard } from "./useBroadcast";

const SEEK_STEP = 10;
const VOLUME_STEP = 0.05;
/** A live viewer this close to the newest media counts as watching live. */
const LIVE_EDGE_SECONDS = 20;
/** Time without input after which the controls leave a playing video alone. */
const IDLE_MS = 3000;

/**
 * One closed outline per non-empty slice, in a `counts.length` by 1 box.
 * Heights follow the square root of the count: a single burst of chat would
 * otherwise flatten the rest of the broadcast into an empty line.
 */
function activityPath(counts: readonly number[]): string {
  const peak = Math.sqrt(Math.max(...counts));
  if (peak <= 0) return "";
  return counts
    .map((count, index) =>
      count > 0 ? `M${index} 1V${(1 - Math.sqrt(count) / peak).toFixed(3)}H${index + 1}V1Z` : "",
    )
    .join("");
}

/** Sheet and offset of the seek preview tile that covers `time`. */
function previewTile(board: Storyboard, time: number) {
  const tile = Math.max(0, Math.min(board.count - 1, Math.floor(time / board.interval)));
  const perSheet = board.cols * board.rows;
  const image = board.images[Math.floor(tile / perSheet)];
  if (!image) return null;
  const within = tile % perSheet;
  return {
    image,
    x: (within % board.cols) * board.width,
    y: Math.floor(within / board.cols) * board.height,
  };
}

type Notice = { id: number; icon?: "play" | "pause"; text?: string };

export function VideoControls({
  video,
  source,
  theater,
  onTheater,
  onError,
  live = false,
  liveEdge,
  activity = null,
  chapters = [],
  storyboard = null,
  settings = [],
}: {
  video: RefObject<HTMLVideoElement>;
  source: string;
  theater: boolean;
  onTheater: () => void;
  onError: (message: string) => void;
  /** A live source seeks inside a sliding window instead of from zero. */
  live?: boolean;
  /** Position that rejoins the live broadcast, when the source knows one. */
  liveEdge?: () => number | null;
  /** Chat messages per equal slice of the video, drawn above the timeline. */
  activity?: readonly number[] | null;
  chapters?: readonly Chapter[];
  storyboard?: Storyboard | null;
  settings?: readonly Setting[];
}) {
  const [state, setState] = useState({
    paused: true,
    time: 0,
    // Seekable span: zero to the duration, or the live window.
    start: 0,
    end: 0,
    volume: 1,
    muted: false,
    buffered: 0,
    buffering: false,
  });
  const [fullscreen, setFullscreen] = useState(false);
  const [pictureInPicture, setPictureInPicture] = useState(false);
  // Fraction of the timeline under the pointer, or null when it is elsewhere.
  const [hover, setHover] = useState<number | null>(null);
  const [idle, setIdle] = useState(false);
  // Brief confirmation of an action taken without the control bar.
  const [notice, setNotice] = useState<Notice | null>(null);
  const noticeId = useRef(0);
  const bar = useRef<HTMLDivElement>(null);
  const audio = useRef<{ volume: number; muted: boolean } | null>(null);
  if (audio.current === null) {
    const { volume, muted } = loadPreferences();
    audio.current = { volume, muted };
  }
  // Volume and mute must survive a <video> remount (new file, new quality).
  // A layout effect restores them during the commit, before the first frame,
  // instead of leaving a frame where a new element starts unmuted.
  useLayoutEffect(() => {
    const element = video.current;
    if (!element) return;
    if (audio.current) {
      element.volume = audio.current.volume;
      element.muted = audio.current.muted;
    }
    const update = () => {
      audio.current = { volume: element.volume, muted: element.muted };
      let buffered = 0;
      for (let i = 0; i < element.buffered.length; i++) {
        if (
          element.buffered.start(i) <= element.currentTime &&
          element.buffered.end(i) >= element.currentTime
        )
          buffered = element.buffered.end(i);
      }
      const windowed = live && element.seekable.length > 0;
      setState({
        paused: element.paused,
        time: element.currentTime,
        start: windowed ? element.seekable.start(0) : 0,
        end: windowed
          ? element.seekable.end(element.seekable.length - 1)
          : Number.isFinite(element.duration)
            ? element.duration
            : 0,
        volume: element.volume,
        muted: element.muted,
        buffered,
        // HAVE_FUTURE_DATA is the first state with something to play next.
        buffering:
          !element.error &&
          !element.ended &&
          (element.seeking || (!element.paused && element.readyState < 3)),
      });
    };
    const events = [
      "play",
      "pause",
      "timeupdate",
      "durationchange",
      "loadedmetadata",
      "volumechange",
      "progress",
      "emptied",
      "ended",
      "waiting",
      "playing",
      "canplay",
      "seeking",
      "seeked",
      "error",
    ];
    const click = () => actions.current.toggle(true);
    const doubleClick = () => actions.current.toggleFullscreen();
    const pictureChange = () => setPictureInPicture(document.pictureInPictureElement === element);
    events.forEach((event) => element.addEventListener(event, update));
    element.addEventListener("click", click);
    element.addEventListener("dblclick", doubleClick);
    element.addEventListener("enterpictureinpicture", pictureChange);
    element.addEventListener("leavepictureinpicture", pictureChange);
    update();
    return () => {
      events.forEach((event) => element.removeEventListener(event, update));
      element.removeEventListener("click", click);
      element.removeEventListener("dblclick", doubleClick);
      element.removeEventListener("enterpictureinpicture", pictureChange);
      element.removeEventListener("leavepictureinpicture", pictureChange);
    };
  }, [video, source, live]);
  useEffect(() => {
    const update = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", update);
    return () => document.removeEventListener("fullscreenchange", update);
  }, []);
  // The controls float over the video and step aside while it plays untouched.
  // They stay for a pointer resting on them, an open menu, or keyboard focus
  // inside them: hiding a control someone is using would strand them.
  useEffect(() => {
    const element = video.current;
    const screen = element?.parentElement;
    if (!element || !screen) return;
    let timer = 0;
    let pointerOnBar = false;
    let keyboard = false;
    const inUse = () => {
      const controls = bar.current;
      if (!controls) return false;
      return (
        pointerOnBar ||
        controls.querySelector("[aria-expanded='true']") !== null ||
        (keyboard && controls.contains(document.activeElement))
      );
    };
    const arm = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (inUse()) arm();
        else setIdle(true);
      }, IDLE_MS);
    };
    const wake = () => {
      setIdle(false);
      arm();
    };
    const pointer = (event: globalThis.PointerEvent) => {
      keyboard = false;
      pointerOnBar = event.target instanceof Node && Boolean(bar.current?.contains(event.target));
      wake();
    };
    const leave = () => {
      pointerOnBar = false;
    };
    const key = () => {
      keyboard = true;
      wake();
    };
    screen.addEventListener("pointermove", pointer);
    screen.addEventListener("pointerdown", pointer);
    screen.addEventListener("pointerleave", leave);
    screen.addEventListener("focusin", wake);
    element.addEventListener("play", wake);
    // Shortcuts work with the focus anywhere, so any key shows the controls.
    // Capturing sees the keys a menu handles and stops, such as Escape.
    window.addEventListener("keydown", key, true);
    wake();
    return () => {
      window.clearTimeout(timer);
      screen.removeEventListener("pointermove", pointer);
      screen.removeEventListener("pointerdown", pointer);
      screen.removeEventListener("pointerleave", leave);
      screen.removeEventListener("focusin", wake);
      element.removeEventListener("play", wake);
      window.removeEventListener("keydown", key, true);
    };
  }, [video, source]);
  const seekable = state.end > state.start;
  function announce(change: Omit<Notice, "id">) {
    noticeId.current += 1;
    setNotice({ id: noticeId.current, ...change });
  }
  function toggle(confirm = false) {
    const element = video.current;
    if (!element) return;
    if (confirm) announce({ icon: element.paused ? "play" : "pause" });
    if (!element.paused) element.pause();
    else
      void element.play().catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        onError("Playback could not start. Try reconnecting or opening the video again.");
      });
  }
  function jump(value: number) {
    if (video.current && seekable)
      video.current.currentTime = Math.max(state.start, Math.min(state.end, value));
  }
  // The ref is authoritative at once: volumechange fires later, and a source
  // change in between would otherwise restore a stale value.
  function setAudio(change: { volume?: number; muted?: boolean }) {
    const element = video.current;
    if (!element) return;
    if (change.volume !== undefined) element.volume = Math.max(0, Math.min(1, change.volume));
    if (change.muted !== undefined) element.muted = change.muted;
    audio.current = { volume: element.volume, muted: element.muted };
    savePreferences(audio.current);
  }
  function toggleFullscreen() {
    const container = video.current?.parentElement;
    const action = document.fullscreenElement
      ? document.exitFullscreen()
      : container?.requestFullscreen?.();
    void action?.catch(() => onError("Fullscreen is unavailable in this browser window."));
  }
  function togglePictureInPicture() {
    const element = video.current;
    if (!element) return;
    const action = document.pictureInPictureElement
      ? document.exitPictureInPicture()
      : element.requestPictureInPicture();
    void action.catch(() => onError("Picture-in-picture is unavailable for this video."));
  }
  function goLive() {
    const edge = liveEdge?.();
    // Without a hint from the source, land a few seconds behind the newest
    // media so playback has something buffered to start from.
    jump(edge ?? state.end - 6);
    if (video.current?.paused) toggle();
  }
  function handleKey(event: KeyboardEvent) {
    const element = video.current;
    switch (event.key.length === 1 ? event.key.toLowerCase() : event.key) {
      case " ":
      case "k":
        event.preventDefault();
        toggle(true);
        break;
      case "ArrowLeft":
      case "j":
        event.preventDefault();
        jump(state.time - SEEK_STEP);
        if (seekable) announce({ text: `−${SEEK_STEP} s` });
        break;
      case "ArrowRight":
      case "l":
        event.preventDefault();
        jump(state.time + SEEK_STEP);
        if (seekable) announce({ text: `+${SEEK_STEP} s` });
        break;
      case "ArrowUp":
      case "ArrowDown":
        event.preventDefault();
        if (event.key === "ArrowUp") setAudio({ volume: state.volume + VOLUME_STEP, muted: false });
        else setAudio({ volume: state.volume - VOLUME_STEP });
        if (element)
          announce({
            text: element.muted ? "Muted" : `Volume ${Math.round(element.volume * 100)}%`,
          });
        break;
      case "m":
        setAudio({ muted: !state.muted });
        if (element) announce({ text: element.muted ? "Muted" : "Unmuted" });
        break;
      case "f":
        toggleFullscreen();
        break;
    }
  }
  // Keep the latest handlers in a ref so the window and video listeners are
  // installed once but always see the current playback state.
  const actions = useRef({ handleKey, toggle, toggleFullscreen });
  useEffect(() => {
    actions.current = { handleKey, toggle, toggleFullscreen };
  });
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLSelectElement ||
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement && target.isContentEditable) ||
        event.defaultPrevented ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey
      )
        return;
      if (target instanceof Element) {
        // Space activates a focused control, and the arrows scroll the chat
        // log or move through an open menu. Those keep their native meaning.
        if (event.key === " " && target.closest("button, a, summary")) return;
        if (
          (event.key === "ArrowUp" || event.key === "ArrowDown") &&
          target.closest("[role='log'], [role='menu']")
        )
          return;
      }
      actions.current.handleKey(event);
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);
  // Without a video there is nothing to control, and the start screen needs
  // the room.
  if (!source) return null;
  const span = state.end - state.start;
  const percent = (value: number) =>
    `${seekable ? Math.max(0, Math.min(100, ((value - state.start) / span) * 100)) : 0}%`;
  const atLiveEdge = state.end - state.time < LIVE_EDGE_SECONDS;
  const hoverTime = hover === null ? 0 : state.start + hover * span;
  const bars = !live && activity ? activityPath(activity) : "";
  const marks = live ? [] : chapters.filter((item) => item.start > 0 && item.start < state.end);
  const playing = live ? undefined : chapterAt(chapters, state.time);
  const tile = storyboard && !live && hover !== null ? previewTile(storyboard, hoverTime) : null;
  const hoverChapter = live || hover === null ? undefined : chapterAt(chapters, hoverTime);
  // Half the tooltip's width, to keep it inside the timeline at both ends.
  const reach = tile && storyboard ? storyboard.width / 2 + 2 : hoverChapter ? 70 : 24;
  function trackPointer(event: PointerEvent<HTMLDivElement>) {
    const box = event.currentTarget.getBoundingClientRect();
    setHover(
      box.width > 0 ? Math.max(0, Math.min(1, (event.clientX - box.left) / box.width)) : null,
    );
  }
  return (
    <>
      {state.buffering && (
        <div className="vod-buffering" role="status" aria-label="Buffering">
          <LoaderCircle size={44} strokeWidth={1.6} />
        </div>
      )}
      {notice && (
        // The key restarts the fade for each new action.
        <div key={notice.id} className="vod-notice" aria-hidden="true">
          {notice.icon === "play" && <Play size={30} fill="currentColor" />}
          {notice.icon === "pause" && <Pause size={30} fill="currentColor" />}
          {notice.text}
        </div>
      )}
      <div
        ref={bar}
        className={`vod-controls${idle && !state.paused ? " is-idle" : ""}`}
        role="group"
        aria-label="Video controls"
      >
        <div
          className="vod-timeline"
          onPointerMove={seekable ? trackPointer : undefined}
          onPointerLeave={() => setHover(null)}
        >
          {hover !== null && seekable && (
            <span
              className="vod-hover-time"
              style={{ left: `clamp(${reach}px, ${hover * 100}%, calc(100% - ${reach}px))` }}
            >
              {tile && storyboard && (
                <span
                  className="vod-preview"
                  style={{
                    width: storyboard.width,
                    height: storyboard.height,
                    backgroundImage: `url("${tile.image}")`,
                    backgroundPosition: `-${tile.x}px -${tile.y}px`,
                  }}
                />
              )}
              {hoverChapter && <span className="vod-hover-chapter">{hoverChapter.title}</span>}
              {live ? `-${shortClock(state.end - hoverTime)}` : shortClock(hoverTime)}
            </span>
          )}
          {bars && (
            <svg
              className="vod-activity"
              viewBox={`0 0 ${activity?.length ?? 1} 1`}
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              <path d={bars} />
            </svg>
          )}
          <div className="vod-scrubber">
            <div className="vod-buffer" style={{ width: percent(state.buffered) }} />
            <div className="vod-progress" style={{ width: percent(state.time) }} />
            {marks.map((chapter) => (
              <span
                key={chapter.start}
                className="vod-chapter-mark"
                style={{ left: percent(chapter.start) }}
              />
            ))}
            <input
              aria-label="Seek video"
              aria-valuetext={
                live
                  ? `${mediaClock(state.end - state.time)} behind live`
                  : `${mediaClock(state.time)} of ${mediaClock(state.end)}`
              }
              type="range"
              min={state.start}
              max={seekable ? state.end : state.start + 1}
              step="0.1"
              value={state.time}
              disabled={!seekable}
              onChange={(event) => jump(Number(event.target.value))}
            />
          </div>
        </div>
        <div className="vod-control-row">
          <button
            type="button"
            className="vod-icon"
            aria-label={state.paused ? "Play" : "Pause"}
            title={state.paused ? "Play (K)" : "Pause (K)"}
            onClick={() => toggle()}
          >
            {state.paused ? (
              <Play size={20} fill="currentColor" />
            ) : (
              <Pause size={20} fill="currentColor" />
            )}
          </button>
          <button
            type="button"
            className="vod-icon vod-skip"
            aria-label="Back 10 seconds"
            title="Back 10 seconds (J)"
            disabled={!seekable}
            onClick={() => jump(state.time - SEEK_STEP)}
          >
            <Rewind size={17} />
          </button>
          <button
            type="button"
            className="vod-icon vod-skip"
            aria-label="Forward 10 seconds"
            title="Forward 10 seconds (L)"
            disabled={!seekable}
            onClick={() => jump(state.time + SEEK_STEP)}
          >
            <FastForward size={17} />
          </button>
          <div className="vod-volume">
            <button
              type="button"
              className="vod-icon"
              aria-label={state.muted ? "Unmute" : "Mute"}
              title="Mute (M)"
              onClick={() => setAudio({ muted: !video.current?.muted })}
            >
              {state.muted || state.volume === 0 ? <VolumeX size={19} /> : <Volume2 size={19} />}
            </button>
            <input
              type="range"
              aria-label="Volume"
              min="0"
              max="1"
              step=".01"
              value={state.muted ? 0 : state.volume}
              onChange={(event) => setAudio({ volume: Number(event.target.value), muted: false })}
            />
          </div>
          {live ? (
            <button
              type="button"
              className={`vod-live${atLiveEdge ? " is-live" : ""}`}
              disabled={!seekable}
              title={atLiveEdge ? "Watching live" : "Jump to live"}
              onClick={goLive}
            >
              <span aria-hidden="true" />
              {atLiveEdge ? "Live" : "Go live"}
            </button>
          ) : (
            <time className="vod-time">
              {mediaClock(state.time)}
              <span> / {mediaClock(state.end)}</span>
            </time>
          )}
          {playing && <span className="vod-chapter-name">{playing.title}</span>}
          <div className="vod-control-end">
            <SettingsMenu settings={settings} />
            {document.pictureInPictureEnabled && (
              <button
                type="button"
                className="vod-icon vod-pip"
                onClick={togglePictureInPicture}
                aria-label={pictureInPicture ? "Exit picture-in-picture" : "Picture-in-picture"}
                aria-pressed={pictureInPicture}
                title="Picture-in-picture"
              >
                <PictureInPicture2 size={19} />
              </button>
            )}
            <button
              type="button"
              className="vod-icon"
              onClick={onTheater}
              aria-label={theater ? "Exit theater mode" : "Theater mode"}
              aria-pressed={theater}
              title="Theater mode"
            >
              <RectangleHorizontal size={19} />
            </button>
            <button
              type="button"
              className="vod-icon"
              onClick={toggleFullscreen}
              aria-label={fullscreen ? "Exit fullscreen" : "Fullscreen"}
              title="Fullscreen (F)"
            >
              {fullscreen ? <Minimize size={19} /> : <Maximize size={19} />}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
