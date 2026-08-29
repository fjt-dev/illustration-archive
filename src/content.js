(() => {
if (globalThis.__ILLUSTRATION_ARCHIVE_LOADED__) return;
globalThis.__ILLUSTRATION_ARCHIVE_LOADED__ = true;

function parsePreload() {
  const node = document.querySelector("#meta-preload-data");
  if (!node?.content) return null;
  try { return JSON.parse(node.content); } catch { return null; }
}

function currentWork() {
  const id = location.pathname.match(/\/artworks\/(\d+)/)?.[1];
  if (!id) throw new Error("作品IDを取得できませんでした");

  const preload = parsePreload();
  const illust = preload?.illust?.[id];
  return {
    id,
    sourceUrl: location.href,
    title: illust?.title || document.querySelector("h1")?.textContent?.trim() || `pixiv ${id}`,
    creatorId: String(illust?.userId || ""),
    creatorName: illust?.userName || "",
    description: illust?.description || "",
    tags: illust?.tags?.tags?.map((tag) => tag.tag) || [],
    postedAt: illust?.createDate || null,
    pageCount: Number(illust?.pageCount || 0)
  };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "PING") {
    sendResponse({ ok: true });
    return false;
  }
  if (message.type !== "GET_CURRENT_WORK") return false;
  try { sendResponse({ ok: true, work: currentWork() }); }
  catch (error) { sendResponse({ ok: false, error: error.message }); }
  return false;
});

let autoRecordTimer;
let disposed = false;

function scheduleAutoRecord(delay = 700) {
  if (disposed) return;
  clearTimeout(autoRecordTimer);
  autoRecordTimer = setTimeout(async () => {
    if (disposed) return;
    try {
      const work = currentWork();
      const result = await chrome.runtime.sendMessage({
        type: "AUTO_ARCHIVE_WORK",
        work,
        bookmarkAction: true
      });
      if (!result?.ok) {
        showNotice(result?.error || "自動記録に失敗しました", true);
        return;
      }
      if (result?.ok && !result.skipped) showSavedNotice();
    } catch (error) {
      if (isInvalidatedContext(error)) {
        dispose();
        return;
      }
      console.warn("Illustration Archive: automatic recording failed", error);
    }
  }, delay);
}

function isInvalidatedContext(error) {
  return String(error?.message || error).includes("Extension context invalidated");
}

function dispose() {
  disposed = true;
  clearTimeout(autoRecordTimer);
  document.removeEventListener("click", handlePageClick, true);
}

function showSavedNotice() {
  showNotice("作品を記録しました");
}

function showNotice(message, isError = false) {
  document.querySelector("[data-illustration-archive-notice]")?.remove();
  const notice = document.createElement("div");
  notice.dataset.illustrationArchiveNotice = "";
  notice.textContent = message;
  Object.assign(notice.style, {
    position: "fixed", right: "20px", bottom: "20px", zIndex: "2147483647",
    padding: "10px 14px", borderRadius: "10px", color: "white",
    background: isError ? "rgba(156, 45, 58, .96)" : "rgba(22, 27, 34, .94)",
    boxShadow: "0 8px 30px rgba(0,0,0,.3)",
    font: "13px system-ui, sans-serif"
  });
  document.body.append(notice);
  setTimeout(() => notice.remove(), 2500);
}

function handlePageClick(event) {
  if (!isBookmarkAction(event)) return;
  scheduleAutoRecord(850);
}

function isBookmarkAction(event) {
  if (!(event.target instanceof Element)) return false;
  const control = event.target.closest("button, [role='button']");
  if (!control) return false;
  const label = [
    control.getAttribute("aria-label"),
    control.getAttribute("title"),
    control.textContent
  ].filter(Boolean).join(" ");
  return !/解除|削除|remove|unbookmark/i.test(label)
    && /ブックマーク|いいね|bookmark|like/i.test(label);
}

document.addEventListener("click", handlePageClick, true);
})();
