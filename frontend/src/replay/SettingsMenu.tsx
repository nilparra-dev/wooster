import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Check, ChevronLeft, ChevronRight, Settings } from "lucide-react";

export interface Setting {
  /** Accessible name of the setting, e.g. "Playback speed". */
  label: string;
  value: string;
  options: readonly { value: string; label: string }[];
  onChange: (value: string) => void;
}

/**
 * The control bar's settings: a gear that opens a list of settings, each of
 * which opens its choices. It stands in for native <select> elements, whose
 * popups the page cannot style and which some browsers do not draw in
 * fullscreen.
 */
export function SettingsMenu({
  settings,
  disabled,
}: {
  settings: readonly Setting[];
  disabled?: boolean;
}) {
  // Closed, the list of settings, or the choices of the setting at an index.
  const [view, setView] = useState<"closed" | "settings" | number>("closed");
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const id = useId();
  const open = view !== "closed";
  const chosen = typeof view === "number" ? settings[view] : undefined;

  useEffect(() => {
    if (view === "closed") return;
    const items = Array.from(list.current?.querySelectorAll<HTMLButtonElement>("button") ?? []);
    (items.find((item) => item.getAttribute("aria-checked") === "true") ?? items[0])?.focus();
  }, [view]);

  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setView("closed");
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [open]);

  function close() {
    setView("closed");
    trigger.current?.focus();
  }

  function handleKey(event: KeyboardEvent<HTMLDivElement>) {
    const items = Array.from(list.current?.querySelectorAll<HTMLButtonElement>("button") ?? []);
    const at = items.findIndex((item) => item === document.activeElement);
    let next: number;
    if (event.key === "ArrowDown") next = (at + 1) % items.length;
    else if (event.key === "ArrowUp") next = (at - 1 + items.length) % items.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = items.length - 1;
    else if (event.key === "Escape" || (event.key === "ArrowLeft" && chosen)) {
      // Stop here: Escape steps out of the menu, not out of theater mode.
      event.stopPropagation();
      event.preventDefault();
      if (chosen) setView("settings");
      else close();
      return;
    } else if (event.key === "Tab") {
      setView("closed");
      return;
    } else return;
    event.preventDefault();
    items[next]?.focus();
  }

  return (
    <div ref={root} className="vod-menu">
      <button
        ref={trigger}
        type="button"
        className="vod-icon"
        aria-label="Settings"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        title="Settings"
        disabled={disabled || settings.length === 0}
        onClick={() => setView(open ? "closed" : "settings")}
      >
        <Settings size={19} />
      </button>
      {open && (
        <div
          ref={list}
          id={id}
          role="menu"
          aria-label={chosen?.label ?? "Settings"}
          className="vod-menu-list"
          onKeyDown={handleKey}
        >
          {chosen ? (
            <>
              <button
                type="button"
                role="menuitem"
                className="vod-menu-back"
                onClick={() => setView("settings")}
              >
                <ChevronLeft size={14} aria-hidden="true" />
                {chosen.label}
              </button>
              {chosen.options.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  role="menuitemradio"
                  aria-checked={option.value === chosen.value}
                  onClick={() => {
                    chosen.onChange(option.value);
                    close();
                  }}
                >
                  <Check size={13} aria-hidden="true" />
                  {option.label}
                </button>
              ))}
            </>
          ) : (
            settings.map((setting, index) => (
              <button
                key={setting.label}
                type="button"
                role="menuitem"
                aria-haspopup="menu"
                onClick={() => setView(index)}
              >
                {setting.label}
                <span>
                  {setting.options.find((option) => option.value === setting.value)?.label ??
                    setting.value}
                  <ChevronRight size={14} aria-hidden="true" />
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
