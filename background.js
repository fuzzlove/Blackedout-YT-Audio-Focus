chrome.runtime.onMessage.addListener((message, sender) => {
  if (!message || message.type !== "YT_AUDIO_FOCUS_CLOSE_THIS_TAB") {
    return;
  }

  // Safety: closing the YouTube tab stops audio playback.
  // This handler is optional plumbing only and must never be default behavior.
  // Content scripts should send this message only after an explicit user opt-in.
  const tabId = sender && sender.tab && sender.tab.id;
  if (typeof tabId !== "number") {
    return;
  }

  chrome.tabs.remove(tabId);
});
