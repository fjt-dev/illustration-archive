import { initTheme } from "./theme.js";
import { formatBytes } from "./utils.js";
import { isAutoSaveEnabled, onAutoSaveChanged } from "./settings.js";

await initTheme();

const status = document.querySelector("#status");
const save = document.querySelector("#save");

updateAutoSaveStatus(await isAutoSaveEnabled());
onAutoSaveChanged(updateAutoSaveStatus);

function updateAutoSaveStatus(enabled) {
  const status = document.querySelector("#auto-save-status");
  status.textContent = enabled ? "オン" : "オフ";
  status.classList.toggle("enabled", enabled);
}

save.addEventListener("click", async () => {
  save.disabled = true;
  status.textContent = "作品情報を取得しています…";
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !tab.url?.match(/^https:\/\/www\.pixiv\.net\/artworks\//)) {
      throw new Error("pixivの作品ページを開いてください");
    }
    const extracted = await getCurrentWork(tab.id);
    if (!extracted?.ok) throw new Error(extracted?.error || "作品情報を取得できませんでした");
    status.textContent = `${extracted.work.title} を保存しています…`;
    const result = await chrome.runtime.sendMessage({ type: "ARCHIVE_WORK", work: extracted.work });
    if (!result?.ok) throw new Error(result?.error || "保存に失敗しました");
    status.textContent = `${result.imageCount}枚・${formatBytes(result.byteSize)}を保存しました。`;
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
