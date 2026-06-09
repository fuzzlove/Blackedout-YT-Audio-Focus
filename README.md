# Blackedout Youtube Audio Focus

Blackedout Youtube Audio Focus is an Opera/Chromium Manifest V3 extension for reducing visual distraction on YouTube. It is intended as an accessibility/focus aid for users with ADD/ADHD who want to listen to audio and use captions or lyrics without being pulled into video, thumbnails, previews, or other visual motion.

By default, the extension does **not** close YouTube tabs. Closing the YouTube tab stops playback, so the default behavior is to keep the tab open, keep audio playing, and aggressively black out distracting visuals.

## Supported Pages

- `https://www.youtube.com/watch*`
- `https://m.youtube.com/watch*`

Desktop YouTube is the primary target. Mobile YouTube and YouTube's in-page mini player are handled on a best-effort basis.

## Install in Opera

1. Open Opera and go to `opera://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select this extension folder.
5. Open or refresh YouTube.

## Use

1. Open a YouTube video.
2. Leave **Strict Focus Mode** on for the strongest self-healing blackout behavior.
3. Click **Audio Only** in or near the player controls.
4. The player visual area turns black while audio continues.
5. Captions, subtitles, lyrics, progress, volume, settings, and fullscreen controls remain usable.
6. Click **Show Video** to restore the normal video display.

The extension does not close YouTube by default. It keeps the audio tab open and hides preview video imagery. Closing the tab is not recommended because it stops playback.

The settings are stored with `chrome.storage.local`, so the extension remembers the last chosen state.

## How It Works

- The extension uses a content script and a Manifest V3 background service worker.
- It adds a persisted **Strict Focus Mode** setting, enabled by default.
- The close-when-backgrounded setting is disabled by default and stale enabled values are reset to false because closing the YouTube tab stops audio playback.
- It injects a permanent `#yt-audio-focus-blackout` overlay directly inside the YouTube player root.
- The overlay covers video, thumbnails, poster frames, paused frames, previews, storyboards, hover previews, end screens, and ad preview visuals.
- The normal player blackout overlay sits below captions and controls, uses `pointer-events: none`, and should not block play/pause, seek, volume, captions, settings, theater, fullscreen, or playlist controls.
- The main video element is not removed or paused. It is kept playing in the original YouTube tab for audio and made visually transparent.
- YouTube mini-player, bottom-right floating video UI, and detectable Picture-in-Picture surfaces are suppressed while Audio Only is enabled.
- A root class, `yt-audio-focus-enabled`, activates defensive CSS that suppresses visual-only YouTube layers.
- Visual media layers and caption/control layers are handled separately so subtitles are not hidden with thumbnails or previews.
- Captions and controls are rescued after every suppression pass and raised above the blackout overlay with higher `z-index` values.
- Captions and controls remain available while the YouTube tab is active.
- Strict Focus Mode listens for tab visibility/focus changes, YouTube SPA navigation, player updates, and media playback events.
- A dedicated observer watches for inserted mini-player, floating video, and extra video nodes and suppresses them immediately.
- Opera may create tab thumbnails and previews from the page surface when a tab is created, switched, or hovered.
- When the tab becomes hidden or backgrounded, the extension forces the entire page and YouTube player surface black and adds `#yt-audio-focus-page-blackout` so Opera captures a black preview instead of video imagery.
- In this background-preview state, captions may also be hidden because the user is not actively reading the tab.
- When the tab becomes visible again, the full-page preview overlay is removed immediately, captions and controls are restored, and video visuals remain hidden.
- Backgrounding or opening a new tab does not close YouTube. The content script applies black preview protection and suppresses floating video surfaces instead.
- A `MutationObserver` watches the player so the overlay is recreated if YouTube removes or replaces it.
- While Audio Only and Strict Focus Mode are enabled, a safety check runs every 250ms for the first 10 seconds after enabling/navigation/focus changes, then every 1000ms.

## Known Limitations

- YouTube changes its DOM often, so some selector maintenance may be needed over time.
- Browser-level Picture-in-Picture windows are controlled by the browser/OS and cannot be restyled by this content script.
- The extension does not reduce network usage because YouTube still streams video data; it only suppresses the visuals.
- Closing the YouTube tab is not recommended because it stops playback.
- The default behavior does not close tabs, pause, mute, or reload videos.

## Privacy

This extension does not collect, transmit, sell, or store personal data. It only stores local Audio Only, Strict Focus Mode, and Close YouTube tab when backgrounded preferences using `chrome.storage.local`.
