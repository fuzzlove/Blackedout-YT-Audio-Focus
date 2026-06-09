(function () {
  "use strict";

  const DEBUG = false;
  const DEFAULTS = {
    enabled: false,
    strictFocusMode: true,
    closeWhenBackgrounded: false
  };
  // Safety: closing the YouTube tab stops audio playback.
  // Default must remain false. Study Focus Audio Mode should hide previews, not close tabs.
  const STORAGE_KEY = "youtubeAudioFocusEnabled";
  const STRICT_STORAGE_KEY = "youtubeAudioFocusStrictFocusMode";
  const CLOSE_WHEN_BACKGROUNDED_STORAGE_KEY =
    "youtubeAudioFocusCloseWhenBackgrounded";
  const ENABLED_CLASS = "yt-audio-focus-enabled";
  const STRICT_CLASS = "yt-audio-focus-strict";
  const BACKGROUND_BLACKOUT_CLASS = "yt-audio-focus-background-blackout";
  const VIDEO_HIDDEN_CLASS = "yaudiofocus-video-hidden";
  const SUPPRESSED_CLASS = "yt-audio-focus-suppressed";
  const PRESERVED_CLASS = "yt-audio-focus-preserved";
  const OVERLAY_ID = "yt-audio-focus-blackout";
  const PAGE_BLACKOUT_ID = "yt-audio-focus-page-blackout";
  const BUTTON_CLASS = "yaudiofocus-toggle";
  const STRICT_BUTTON_CLASS = "yt-audio-focus-strict-toggle";
  const CLOSE_BUTTON_CLASS = "yt-audio-focus-close-toggle";
  const MOBILE_BUTTON_CLASS = "yaudiofocus-toggle-mobile";

  const CAPTION_SELECTOR = [
    ".ytp-caption-window-container",
    ".caption-window",
    ".captions-text",
    ".ytp-caption-segment",
    ".ytp-caption-window-rollup",
    ".ytp-caption-window-bottom",
    ".ytp-caption-window-top"
  ].join(", ");

  const CONTROL_SELECTOR = [
    ".ytp-chrome-bottom",
    ".ytp-chrome-top",
    ".ytp-progress-bar-container",
    ".ytp-left-controls",
    ".ytp-right-controls",
    ".ytp-next-button",
    ".ytp-prev-button",
    ".ytp-play-button",
    ".ytp-volume-area",
    ".ytp-subtitles-button",
    ".ytp-settings-button",
    ".ytp-size-button",
    ".ytp-fullscreen-button",
    ".ytp-playlist-menu-button",
    ".ytp-autonav-toggle-button",
    ".ytp-settings-menu",
    ".ytp-popup",
    ".ytp-menuitem",
    ".ytp-panel",
    ".ytp-gradient-bottom",
    ".ytp-gradient-top",
    `.${BUTTON_CLASS}`,
    `.${STRICT_BUTTON_CLASS}`,
    `.${CLOSE_BUTTON_CLASS}`
  ].join(", ");

  const PRESERVE_SELECTOR = `${CAPTION_SELECTOR}, ${CONTROL_SELECTOR}`;

  const VISUAL_SELECTOR = [
    "video.html5-main-video",
    ".html5-main-video",
    ".ytp-cued-thumbnail-overlay",
    ".ytp-cued-thumbnail-overlay-image",
    ".ytp-storyboard",
    ".ytp-storyboard-framepreview",
    ".ytp-videowall-still",
    ".ytp-videowall-still-image",
    ".ytp-endscreen-content",
    ".ytp-pause-overlay",
    ".ytp-preview",
    ".ytp-ad-preview-container"
  ].join(", ");

  const FLOATING_VIDEO_SELECTOR = [
    ".ytp-miniplayer",
    ".ytp-miniplayer-ui",
    ".ytp-player-minimized",
    "ytd-miniplayer",
    "#movie_player.ytp-player-minimized",
    ".ytp-pip-button",
    "[pictureinpicture]",
    "video[pictureinpicture]"
  ].join(", ");

  const MINI_PLAYER_CLOSE_SELECTOR = [
    ".ytp-miniplayer-close-button",
    "button[aria-label*='Close']",
    "button[title*='Close']"
  ].join(", ");

  const SELF_HEAL_EVENTS = [
    "focus",
    "blur",
    "pageshow",
    "pagehide",
    "freeze",
    "yt-navigate-start",
    "yt-navigate-finish",
    "yt-player-updated",
    "yt-page-data-updated"
  ];

  const MEDIA_EVENTS = [
    "play",
    "pause",
    "loadeddata",
    "loadedmetadata",
    "canplay",
    "seeked"
  ];

  const FLOATING_SUPPRESSION_THROTTLE_MS = 250;

  let enabled = false;
  let strictFocusMode = true;
  let closeWhenBackgrounded = false;
  let closeRequestSent = false;
  let lastUrl = location.href;
  let playerObserver = null;
  let floatingSurfaceObserver = null;
  let floatingSurfaceMoviePlayer = null;
  let documentObserver = null;
  let reapplyTimer = null;
  let fastInterval = null;
  let fastIntervalStopTimer = null;
  let slowInterval = null;
  let applying = false;
  let suppressingFloatingSurfaces = false;
  let floatingSuppressionTimer = null;
  let lastFloatingSuppressionAt = 0;
  let lastApplyAt = 0;

  const storage =
    typeof chrome !== "undefined" && chrome.storage && chrome.storage.local;

  function debugLog(...args) {
    if (DEBUG) {
      console.log("[Blackedout Youtube Audio Focus]", ...args);
    }
  }

  function isYoutubePage() {
    return location.hostname.endsWith("youtube.com");
  }

  function isWatchPage() {
    return isYoutubePage() && location.pathname === "/watch";
  }

  function readSettings(callback) {
    if (!storage) {
      callback(
        DEFAULTS.enabled,
        DEFAULTS.strictFocusMode,
        DEFAULTS.closeWhenBackgrounded
      );
      return;
    }

    storage.get(
      {
        [STORAGE_KEY]: DEFAULTS.enabled,
        [STRICT_STORAGE_KEY]: DEFAULTS.strictFocusMode,
        [CLOSE_WHEN_BACKGROUNDED_STORAGE_KEY]: DEFAULTS.closeWhenBackgrounded
      },
      (items) => {
        if (items[CLOSE_WHEN_BACKGROUNDED_STORAGE_KEY] === true) {
          storage.set({
            [CLOSE_WHEN_BACKGROUNDED_STORAGE_KEY]:
              DEFAULTS.closeWhenBackgrounded
          });
        }

        callback(
          Boolean(items[STORAGE_KEY]),
          Boolean(items[STRICT_STORAGE_KEY]),
          DEFAULTS.closeWhenBackgrounded
        );
      }
    );
  }

  function saveSetting(value) {
    if (storage) {
      storage.set({ [STORAGE_KEY]: value });
    }
  }

  function saveStrictFocusMode(value) {
    if (storage) {
      storage.set({ [STRICT_STORAGE_KEY]: value });
    }
  }

  function saveCloseWhenBackgrounded(value) {
    if (storage) {
      storage.set({
        [CLOSE_WHEN_BACKGROUNDED_STORAGE_KEY]:
          value === true && closeWhenBackgrounded === true
      });
    }
  }

  function isStrictActive() {
    return enabled && strictFocusMode;
  }

  function getMoviePlayer() {
    return document.querySelector("#movie_player");
  }

  function getPrimaryPlayerRoot() {
    return (
      getMoviePlayer() ||
      document.querySelector(".html5-video-player") ||
      document.querySelector("#player-container") ||
      document.querySelector("#player") ||
      document.querySelector("ytd-miniplayer")
    );
  }

  function getPlayerRoots() {
    return Array.from(
      new Set(
        [
          getMoviePlayer(),
          document.querySelector(".html5-video-player"),
          document.querySelector("#player-container"),
          document.querySelector("#player"),
          document.querySelector("ytd-miniplayer")
        ].filter(Boolean)
      )
    );
  }

  function getVideos() {
    return Array.from(
      new Set([
        ...document.querySelectorAll("video.html5-main-video"),
        ...document.querySelectorAll("video")
      ])
    );
  }

  function getMainPlayerRoot() {
    return getMoviePlayer() || document.querySelector(".html5-video-player");
  }

  function hideNodeForFocusMode(node) {
    node.classList.add(SUPPRESSED_CLASS);
    node.style.setProperty("opacity", "0", "important");
    node.style.setProperty("visibility", "hidden", "important");
    node.style.setProperty("pointer-events", "none", "important");
    node.style.setProperty("filter", "brightness(0)", "important");
    node.style.setProperty("background", "#000", "important");
  }

  function forceBlackBackground() {
    document.documentElement.classList.toggle(ENABLED_CLASS, enabled);
    document.documentElement.classList.toggle(STRICT_CLASS, isStrictActive());

    getPlayerRoots().forEach((root) => {
      root.classList.toggle(ENABLED_CLASS, enabled);
      root.classList.toggle(STRICT_CLASS, isStrictActive());
      if (enabled) {
        root.style.setProperty("background", "#000", "important");
        root.style.setProperty("position", "relative", "important");
      } else {
        root.style.removeProperty("background");
      }
    });
  }

  function ensureFullPageBlackoutOverlay() {
    let overlay = document.getElementById(PAGE_BLACKOUT_ID);
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.id = PAGE_BLACKOUT_ID;
      overlay.setAttribute("aria-hidden", "true");
      overlay.dataset.ytAudioFocusPageOverlay = "true";
      (document.body || document.documentElement).appendChild(overlay);
    }

    overlay.style.setProperty("position", "fixed", "important");
    overlay.style.setProperty("inset", "0", "important");
    overlay.style.setProperty("background", "#000", "important");
    overlay.style.setProperty("z-index", "2147483647", "important");
    overlay.style.setProperty("pointer-events", "none", "important");
    overlay.style.setProperty("display", "block", "important");
    return overlay;
  }

  function removeFullPageBlackoutOverlay() {
    document.querySelectorAll(`#${PAGE_BLACKOUT_ID}`).forEach((overlay) => {
      overlay.remove();
    });
  }

  function applyBackgroundBlackoutForOperaPreview() {
    if (!enabled) {
      return;
    }

    if (!document.hidden) {
      document.documentElement.classList.remove(BACKGROUND_BLACKOUT_CLASS);
      removeFullPageBlackoutOverlay();
      ensureFocusModeApplied();
      rescueCaptionsAndControls();
      return;
    }

    document.documentElement.classList.add(ENABLED_CLASS);
    document.documentElement.classList.add(BACKGROUND_BLACKOUT_CLASS);
    ensureFocusModeApplied();
    void suppressFloatingVideoSurfaces();
    ensureFullPageBlackoutOverlay();
  }

  function restoreActiveTabFocusView() {
    document.documentElement.classList.remove(BACKGROUND_BLACKOUT_CLASS);
    removeFullPageBlackoutOverlay();
    closeRequestSent = false;
    ensureFocusModeApplied();
    void suppressFloatingVideoSurfaces();
    rescueCaptionsAndControls();
  }

  function requestCloseCurrentTab() {
    if (
      closeWhenBackgrounded !== true ||
      closeRequestSent ||
      typeof chrome === "undefined" ||
      !chrome.runtime ||
      !chrome.runtime.sendMessage
    ) {
      return;
    }

    closeRequestSent = true;
    chrome.runtime.sendMessage({ type: "YT_AUDIO_FOCUS_CLOSE_THIS_TAB" });
  }

  function handleBackgroundedForPreview() {
    if (!enabled) {
      return;
    }

    // Do not close the YouTube tab here. Backgrounding/opening a new tab must
    // keep audio playing and only hide visual preview surfaces.
    applyBackgroundBlackoutForOperaPreview();
  }

  function ensureOverlay() {
    const player = getMoviePlayer() || getPrimaryPlayerRoot();
    if (!player) {
      return null;
    }

    document.querySelectorAll(`#${OVERLAY_ID}`).forEach((overlay) => {
      if (overlay.parentElement !== player) {
        overlay.remove();
      }
    });

    let overlay = player.querySelector(`:scope > #${OVERLAY_ID}`);
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.id = OVERLAY_ID;
      overlay.setAttribute("aria-hidden", "true");
      overlay.dataset.ytAudioFocusOverlay = "true";
      player.appendChild(overlay);
      debugLog("overlay recreated");
    }

    overlay.style.setProperty("pointer-events", "none", "important");
    overlay.style.setProperty("z-index", "20", "important");
    return overlay;
  }

  function isCaptionOrControl(node) {
    return Boolean(node.closest(PRESERVE_SELECTOR));
  }

  function containsCaptionOrControl(node) {
    return Boolean(node.querySelector && node.querySelector(PRESERVE_SELECTOR));
  }

  function clearVideoPoster() {
    getVideos().forEach((video) => {
      if (enabled) {
        video.poster = "";
        video.removeAttribute("poster");
        video.classList.add(VIDEO_HIDDEN_CLASS);
        video.style.setProperty("opacity", "0", "important");
        video.style.setProperty("visibility", "hidden", "important");
        video.style.setProperty("filter", "brightness(0)", "important");
        video.style.setProperty("background", "#000", "important");
      } else {
        video.classList.remove(VIDEO_HIDDEN_CLASS);
        video.style.removeProperty("opacity");
        video.style.removeProperty("visibility");
        video.style.removeProperty("filter");
        video.style.removeProperty("background");
      }
    });
  }

  async function suppressFloatingVideoSurfaces() {
    if (!enabled || suppressingFloatingSurfaces) {
      return;
    }

    suppressingFloatingSurfaces = true;
    try {
      if (document.pictureInPictureElement && document.exitPictureInPicture) {
        try {
          await document.exitPictureInPicture();
        } catch (error) {
          debugLog("unable to exit picture-in-picture", error);
        }
      }

      const mainPlayer = getMainPlayerRoot();
      document.querySelectorAll(FLOATING_VIDEO_SELECTOR).forEach((node) => {
        if (node.classList) {
          node.classList.remove("ytp-player-minimized");
          node.classList.remove("ytp-miniplayer");
          node.classList.remove("ytp-miniplayer-ui");
        }

        if (node === mainPlayer || node.id === "movie_player") {
          node.style.setProperty("background", "#000", "important");
          node.style.setProperty("position", "relative", "important");
          return;
        }

        hideNodeForFocusMode(node);
      });

      document
        .querySelectorAll(
          "ytd-miniplayer, .ytp-miniplayer, .ytp-miniplayer-ui, #movie_player.ytp-player-minimized"
        )
        .forEach((container) => {
          const closeButton = container.querySelector(MINI_PLAYER_CLOSE_SELECTOR);
          if (closeButton && typeof closeButton.click === "function") {
            closeButton.click();
          }
        });

      document.querySelectorAll(".ytp-miniplayer-close-button").forEach((button) => {
        if (typeof button.click === "function") {
          button.click();
        }
      });

      document.querySelectorAll("video").forEach((video) => {
        if (!mainPlayer || !mainPlayer.contains(video)) {
          hideNodeForFocusMode(video);
        }
      });
      lastFloatingSuppressionAt = Date.now();
    } finally {
      suppressingFloatingSurfaces = false;
    }
  }

  function scheduleFloatingVideoSuppression(immediate) {
    if (!enabled) {
      return;
    }

    if (immediate) {
      window.clearTimeout(floatingSuppressionTimer);
      floatingSuppressionTimer = null;
      void suppressFloatingVideoSurfaces();
      return;
    }

    const elapsed = Date.now() - lastFloatingSuppressionAt;
    if (elapsed >= FLOATING_SUPPRESSION_THROTTLE_MS) {
      void suppressFloatingVideoSurfaces();
      return;
    }

    if (!floatingSuppressionTimer) {
      floatingSuppressionTimer = window.setTimeout(() => {
        floatingSuppressionTimer = null;
        void suppressFloatingVideoSurfaces();
      }, FLOATING_SUPPRESSION_THROTTLE_MS - elapsed);
    }
  }

  function suppressVisuals() {
    if (!enabled) {
      document.querySelectorAll(`.${SUPPRESSED_CLASS}`).forEach((node) => {
        node.classList.remove(SUPPRESSED_CLASS);
        node.style.removeProperty("opacity");
        node.style.removeProperty("visibility");
        node.style.removeProperty("pointer-events");
        node.style.removeProperty("filter");
        node.style.removeProperty("background");
        node.style.removeProperty("z-index");
      });
      clearVideoPoster();
      return;
    }

    getPlayerRoots().forEach((root) => {
      root.querySelectorAll(VISUAL_SELECTOR).forEach((node) => {
        if (isCaptionOrControl(node) || containsCaptionOrControl(node)) {
          return;
        }

        node.classList.add(SUPPRESSED_CLASS);
        node.style.setProperty("opacity", "0", "important");
        node.style.setProperty("visibility", "hidden", "important");
        node.style.setProperty("filter", "brightness(0)", "important");
        node.style.setProperty("background", "#000", "important");
        node.style.setProperty("z-index", "1", "important");
        debugLog("visual suppressed", node);
      });
    });

    const moviePlayer = getMoviePlayer();
    if (moviePlayer) {
      moviePlayer.querySelectorAll("img").forEach((image) => {
        if (isCaptionOrControl(image)) {
          return;
        }

        image.classList.add(SUPPRESSED_CLASS);
        image.style.setProperty("opacity", "0", "important");
        image.style.setProperty("visibility", "hidden", "important");
        image.style.setProperty("filter", "brightness(0)", "important");
      });
    }

    clearVideoPoster();
  }

  function rescueCaptionsAndControls() {
    getPlayerRoots().forEach((root) => {
      root.querySelectorAll(CAPTION_SELECTOR).forEach((node) => {
        node.classList.add(PRESERVED_CLASS);
        node.classList.remove(SUPPRESSED_CLASS);
        node.style.setProperty("display", "block", "important");
        node.style.setProperty("opacity", "1", "important");
        node.style.setProperty("visibility", "visible", "important");
        node.style.setProperty("pointer-events", "auto", "important");
        node.style.setProperty("z-index", "40", "important");
      });

      root.querySelectorAll(CONTROL_SELECTOR).forEach((node) => {
        node.classList.add(PRESERVED_CLASS);
        node.classList.remove(SUPPRESSED_CLASS);
        node.style.setProperty("opacity", "1", "important");
        node.style.setProperty("visibility", "visible", "important");
        node.style.setProperty("pointer-events", "auto", "important");
        node.style.setProperty("z-index", "50", "important");
      });
    });
  }

  function clearFocusMode() {
    stopSafetyIntervals();
    if (playerObserver) {
      playerObserver.disconnect();
      playerObserver = null;
    }
    if (floatingSurfaceObserver) {
      floatingSurfaceObserver.disconnect();
      floatingSurfaceObserver = null;
      floatingSurfaceMoviePlayer = null;
    }
    document.documentElement.classList.remove(
      ENABLED_CLASS,
      STRICT_CLASS,
      BACKGROUND_BLACKOUT_CLASS
    );
    removeFullPageBlackoutOverlay();
    window.clearTimeout(floatingSuppressionTimer);
    floatingSuppressionTimer = null;
    suppressingFloatingSurfaces = false;
    document.querySelectorAll(`#${OVERLAY_ID}`).forEach((overlay) => {
      overlay.remove();
    });
    suppressVisuals();
    getPlayerRoots().forEach((root) => {
      root.classList.remove(ENABLED_CLASS, STRICT_CLASS);
      root.style.removeProperty("background");
    });
    document.querySelectorAll(`.${PRESERVED_CLASS}`).forEach((node) => {
      node.classList.remove(PRESERVED_CLASS);
      node.style.removeProperty("display");
      node.style.removeProperty("opacity");
      node.style.removeProperty("visibility");
      node.style.removeProperty("pointer-events");
      node.style.removeProperty("z-index");
    });
  }

  function ensureFocusModeApplied() {
    if (applying || !isYoutubePage()) {
      return;
    }

    applying = true;
    injectButtons();

    if (!enabled) {
      clearFocusMode();
      updateButtons();
      applying = false;
      return;
    }

    forceBlackBackground();
    ensureOverlay();
    suppressVisuals();
    scheduleFloatingVideoSuppression(false);
    rescueCaptionsAndControls();
    startPlayerObserver();
    startFloatingSurfaceObserver();
    if (isStrictActive()) {
      startSlowSafetyInterval();
    } else {
      stopSafetyIntervals();
    }
    updateButtons();
    applying = false;
    lastApplyAt = Date.now();
  }

  function scheduleApply(delay) {
    window.clearTimeout(reapplyTimer);
    reapplyTimer = window.setTimeout(ensureFocusModeApplied, delay || 0);
  }

  function restartFastSafetyWindow() {
    if (!isStrictActive()) {
      return;
    }

    if (fastInterval) {
      window.clearInterval(fastInterval);
    }
    if (fastIntervalStopTimer) {
      window.clearTimeout(fastIntervalStopTimer);
    }

    fastInterval = window.setInterval(ensureFocusModeApplied, 250);
    fastIntervalStopTimer = window.setTimeout(() => {
      window.clearInterval(fastInterval);
      fastInterval = null;
      fastIntervalStopTimer = null;
    }, 10000);
  }

  function startSlowSafetyInterval() {
    if (!slowInterval && isStrictActive()) {
      slowInterval = window.setInterval(ensureFocusModeApplied, 1000);
    }
  }

  function stopSafetyIntervals() {
    if (fastInterval) {
      window.clearInterval(fastInterval);
      fastInterval = null;
    }
    if (fastIntervalStopTimer) {
      window.clearTimeout(fastIntervalStopTimer);
      fastIntervalStopTimer = null;
    }
    if (slowInterval) {
      window.clearInterval(slowInterval);
      slowInterval = null;
    }
  }

  function startPlayerObserver() {
    const root = getMoviePlayer() || document.querySelector(".html5-video-player");
    if (!root) {
      return;
    }

    if (playerObserver && playerObserver.target === root) {
      return;
    }

    if (playerObserver) {
      playerObserver.disconnect();
    }

    playerObserver = new MutationObserver(() => {
      if (!isStrictActive() || applying || Date.now() - lastApplyAt < 75) {
        return;
      }
      scheduleFloatingVideoSuppression(false);
      scheduleApply(0);
    });
    playerObserver.observe(root, {
      attributes: true,
      childList: true,
      subtree: true
    });
    playerObserver.target = root;
  }

  function startFloatingSurfaceObserver() {
    if (!document.body) {
      return;
    }

    if (!floatingSurfaceObserver) {
      floatingSurfaceObserver = new MutationObserver((mutations) => {
        if (!enabled) {
          return;
        }

        const shouldSuppress = mutations.some((mutation) =>
          Array.from(mutation.addedNodes).some((node) => {
            if (node.nodeType !== Node.ELEMENT_NODE) {
              return false;
            }

            return (
              node.matches(FLOATING_VIDEO_SELECTOR) ||
              node.matches("video") ||
              Boolean(node.querySelector(FLOATING_VIDEO_SELECTOR)) ||
              Boolean(node.querySelector("video"))
            );
          })
        );

        if (shouldSuppress) {
          scheduleFloatingVideoSuppression(false);
        }
      });

      floatingSurfaceObserver.observe(document.body, {
        childList: true,
        subtree: true
      });
    }

    const moviePlayer = getMoviePlayer();
    if (moviePlayer && floatingSurfaceMoviePlayer !== moviePlayer) {
      floatingSurfaceObserver.disconnect();
      floatingSurfaceObserver.observe(document.body, {
        childList: true,
        subtree: true
      });
      floatingSurfaceObserver.observe(moviePlayer, {
        childList: true,
        subtree: true
      });
      floatingSurfaceMoviePlayer = moviePlayer;
    }
  }

  function handleNavigation() {
    if (lastUrl === location.href) {
      return false;
    }

    lastUrl = location.href;
    restartFastSafetyWindow();
    ensureFocusModeApplied();
    return true;
  }

  function updateButtons() {
    document.querySelectorAll(`.${BUTTON_CLASS}`).forEach((button) => {
      button.textContent = enabled ? "Show Video" : "Audio Only";
      button.setAttribute("aria-pressed", String(enabled));
      button.title = enabled ? "Show Video" : "Audio Only";
    });

    document.querySelectorAll(`.${STRICT_BUTTON_CLASS}`).forEach((button) => {
      button.textContent = strictFocusMode
        ? "Strict Focus: On"
        : "Strict Focus: Off";
      button.setAttribute("aria-pressed", String(strictFocusMode));
      button.title = "Strict Focus Mode";
    });

    document.querySelectorAll(`.${CLOSE_BUTTON_CLASS}`).forEach((button) => {
      button.textContent = closeWhenBackgrounded
        ? "Close BG: On"
        : "Close BG: Off";
      button.setAttribute("aria-pressed", String(closeWhenBackgrounded));
      button.title =
        "Close YouTube tab when backgrounded. This stops playback.";
    });
  }

  function setFocusModeEnabled(nextEnabled) {
    enabled = Boolean(nextEnabled);
    saveSetting(enabled);
    if (enabled) {
      restartFastSafetyWindow();
      ensureFocusModeApplied();
      return;
    }

    closeRequestSent = false;
    clearFocusMode();
    updateButtons();
  }

  function createButton(extraClass) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `${BUTTON_CLASS}${extraClass ? ` ${extraClass}` : ""}`;
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      setFocusModeEnabled(!enabled);
    });
    return button;
  }

  function createStrictButton(extraClass) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `${STRICT_BUTTON_CLASS}${extraClass ? ` ${extraClass}` : ""}`;
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      strictFocusMode = !strictFocusMode;
      saveStrictFocusMode(strictFocusMode);
      restartFastSafetyWindow();
      ensureFocusModeApplied();
    });
    return button;
  }

  function createCloseWhenBackgroundedButton(extraClass) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `${CLOSE_BUTTON_CLASS}${extraClass ? ` ${extraClass}` : ""}`;
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      closeWhenBackgrounded = !closeWhenBackgrounded;
      saveCloseWhenBackgrounded(closeWhenBackgrounded);
      updateButtons();
    });
    return button;
  }

  function injectButtons() {
    if (!isYoutubePage()) {
      return;
    }

    const controls = document.querySelector(".ytp-left-controls");
    if (controls) {
      let button = controls.querySelector(`.${BUTTON_CLASS}`);
      if (!button) {
        button = createButton("");
        const timeDisplay = controls.querySelector(".ytp-time-display");
        if (timeDisplay && timeDisplay.nextSibling) {
          controls.insertBefore(button, timeDisplay.nextSibling);
        } else {
          controls.appendChild(button);
        }
      }

      if (!controls.querySelector(`.${STRICT_BUTTON_CLASS}`)) {
        controls.insertBefore(createStrictButton(""), button.nextSibling);
      }
      updateButtons();
      return;
    }

    const player = getPrimaryPlayerRoot();
    if ((isWatchPage() || player) && player) {
      updateButtons();
    }
  }

  function addEventListeners() {
    document.addEventListener("visibilitychange", () => {
      if (enabled && document.hidden) {
        handleBackgroundedForPreview();
        scheduleFloatingVideoSuppression(true);
      } else if (enabled && !document.hidden) {
        restoreActiveTabFocusView();
        scheduleFloatingVideoSuppression(true);
        restartFastSafetyWindow();
      } else {
        restartFastSafetyWindow();
        ensureFocusModeApplied();
      }
    });

    SELF_HEAL_EVENTS.forEach((eventName) => {
      window.addEventListener(eventName, () => {
        if (
          eventName === "blur" ||
          eventName === "pagehide" ||
          eventName === "freeze"
        ) {
          handleBackgroundedForPreview();
          scheduleFloatingVideoSuppression(true);
          return;
        }

        if (eventName === "pageshow" || eventName === "focus") {
          restoreActiveTabFocusView();
          scheduleFloatingVideoSuppression(true);
        }

        if (
          eventName === "yt-navigate-start" ||
          eventName === "yt-navigate-finish" ||
          eventName === "yt-player-updated" ||
          eventName === "yt-page-data-updated"
        ) {
          if (document.hidden) {
            handleBackgroundedForPreview();
            scheduleFloatingVideoSuppression(true);
            return;
          }
        }

        restartFastSafetyWindow();
        ensureFocusModeApplied();
        scheduleFloatingVideoSuppression(false);
      });
    });

    MEDIA_EVENTS.forEach((eventName) => {
      document.addEventListener(
        eventName,
        () => {
          ensureFocusModeApplied();
          scheduleFloatingVideoSuppression(false);
        },
        true
      );
    });

    document.addEventListener(
      "timeupdate",
      () => {
        scheduleFloatingVideoSuppression(false);
      },
      true
    );
  }

  function startDocumentObserver() {
    if (documentObserver) {
      return;
    }

    documentObserver = new MutationObserver(() => {
      if (handleNavigation() && isStrictActive()) {
        scheduleApply(0);
      }
    });
    documentObserver.observe(document.documentElement, {
      childList: true,
      subtree: true
    });
  }

  function initialize() {
    readSettings((enabledValue, strictValue, closeValue) => {
      enabled = enabledValue;
      strictFocusMode = strictValue;
      closeWhenBackgrounded = closeValue;
      restartFastSafetyWindow();
      if (enabled && document.hidden) {
        handleBackgroundedForPreview();
      } else {
        ensureFocusModeApplied();
      }
    });

    addEventListeners();
    startDocumentObserver();

    if (
      typeof chrome !== "undefined" &&
      chrome.storage &&
      chrome.storage.onChanged
    ) {
      chrome.storage.onChanged.addListener((changes, areaName) => {
        if (
          areaName !== "local" ||
          (!changes[STORAGE_KEY] &&
            !changes[STRICT_STORAGE_KEY] &&
            !changes[CLOSE_WHEN_BACKGROUNDED_STORAGE_KEY])
        ) {
          return;
        }

        if (changes[STORAGE_KEY]) {
          enabled = Boolean(changes[STORAGE_KEY].newValue);
        }
        if (changes[STRICT_STORAGE_KEY]) {
          strictFocusMode = Boolean(changes[STRICT_STORAGE_KEY].newValue);
        }
        if (changes[CLOSE_WHEN_BACKGROUNDED_STORAGE_KEY]) {
          closeWhenBackgrounded = DEFAULTS.closeWhenBackgrounded;
          if (changes[CLOSE_WHEN_BACKGROUNDED_STORAGE_KEY].newValue === true) {
            storage.set({
              [CLOSE_WHEN_BACKGROUNDED_STORAGE_KEY]:
                DEFAULTS.closeWhenBackgrounded
            });
          }
        }
        restartFastSafetyWindow();
        if (enabled && document.hidden) {
          handleBackgroundedForPreview();
        } else {
          ensureFocusModeApplied();
        }
      });
    }
  }

  initialize();
})();
