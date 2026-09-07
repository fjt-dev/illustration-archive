import { initTheme } from "./theme.js";
import { formatBytes } from "./utils.js";
import { onIncludeImagesChanged, shouldIncludeImages } from "./settings.js";
import { localizeDocument, message } from "./i18n.js";

localizeDocument();
await initTheme();

const status = document.querySelector("#status");
const save = document.querySelector("#save");

updateRecordMode(await shouldIncludeImages());
onIncludeImagesChanged(updateRecordMode);

function updateRecordMode(includeImages) {
  document.querySelector("#record-mode").textContent = includeImages
    ? message("metadataAndImages")
    : message("metadataOnly");
}

save.addEventListener("click", async () => {
  save.disabled = true;
  status.textContent = message("gettingArtworkInfo");
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !tab.url?.match(/^https:\/\/www\.pixiv\.net\/artworks\//)) {
      throw new Error(message("openPixivArtworkPage"));
    }
    const extracted = await getCurrentWork(tab.id);
    if (!extracted?.ok) throw new Error(extracted?.error || message("artworkInfoFailed"));
    status.textContent = message("recordingArtwork", extracted.work.title);
    const result = await chrome.runtime.sendMessage({ type: "ARCHIVE_WORK", work: extracted.work });
    if (!result?.ok) throw new Error(result?.error || message("recordFailed"));
    status.textContent = result.imageCount > 0
      ? message("recordedImages", [String(result.imageCount), formatBytes(result.byteSize)])
      : message("recordedMetadata");
  } catch (error) {
    status.textContent = error.message;
  } finally {
    save.disabled = false;
  }
});

document.querySelector("#archive").addEventListener("click", () => chrome.runtime.openOptionsPage());

async function getCurrentWork(tabId) {
  try {
    return await chrome.tabs.sendMessage(tabId, { type: "GET_CURRENT_WORK" });
  } catch (error) {
    if (!String(error?.message).includes("Receiving end does not exist")) throw error;
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["src/content.js"]
    });
    return chrome.tabs.sendMessage(tabId, { type: "GET_CURRENT_WORK" });
  }
}
