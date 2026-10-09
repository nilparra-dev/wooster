# Replay interface

The page is a player for finished broadcasts. Its main action is watching, with
archived chat following the same clock. It must feel familiar to a Twitch viewer.

## Constraints

- Video and chat remain usable independently. Empty or unavailable chat must
  explain the state without interrupting video.
- Desktop fits the viewport. New messages scroll inside chat, never grow the page.
- Video has its own visible, keyboard-accessible controls. Fullscreen contains
  both the video and those controls.
- Reconnecting and changing quality keep playback position and audio preferences.
- Search, sync offset and manual chat import remain available without dominating
  the viewing experience. Chat is read-only, so there is no fake message composer.
- Mobile stacks video and a bounded chat panel. No horizontal page scrolling.
- Use real metadata. Do not invent viewer counts, badges, live status or channels.

## Visual decisions

Three treatments were compared in local browser previews: compact charcoal,
light navigation over dark media, and cinema with hidden metadata. The compact
version keeps broadcast identity visible and preserves more width for chat.
Theater mode provides the cinema behavior as a viewing option.

The palette uses #0e0e10 for the canvas, #18181b for panels, #2c2c31 for borders,
#efeff1 for text, #adadb8 for secondary text and #bf94ff for actions and progress.
Inter is the body face; Inter Tight is reserved for the wordmark. Numeric clocks
use tabular figures. Most labels are 11–13 px, chat is 13 px, titles are 17 px.

The screen has one compact navigation bar, a large video area and a 340 px chat
column. The controls share one button treatment and a thin playback timeline.
The chat keeps username colors and clickable time markers. There is no hero,
decorative waveform, promotional footer or artificial activity feed.

Kumo was reviewed as a reference for consistent components and accessibility,
not added as a runtime dependency. The supplied design article informed the
whole-page review, removal of redundant elements and comparison of variants.

## Verification and remaining polish

`frontend/test/replay.browser.mjs` generates a real video fixture locally and
tests custom playback controls plus long, continuously changing chat content.
It requires no external media or Twitch availability. CI runs the same check.
Real recovered HLS playback is also checked locally when a VOD is available.

Emote and badge images come from Twitch through the watch server, by the IDs
stored in the archive and the badge sets Twitch reports for the channel. The UI
does not fabricate replacements: an image that is missing falls back to the
emote's name or the badge's tooltip. Keeping the images with the archive, for
offline replay, is still a separate feature.

The marks above the timeline count the archive's messages per slice of the
video. They are data, not decoration, and are absent when there is no chat.

The controls float over the video and step aside while it plays, as viewers
of Twitch expect. They never hide from someone using them: a paused video, an
open menu, a resting pointer or keyboard focus inside the bar keeps them up.
The channel, title, category and chapters shown are the ones Twitch reports;
nothing is shown for a broadcast Twitch no longer describes.
