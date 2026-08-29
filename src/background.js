import { getImages, getWork, saveArchive, updateWorkMetadata } from "./db.js";
import { getArchiveFolder, getArchiveFolderSelectionId, saveArchiveToFolder } from "./folder.js";
import { hasUsageConsent, isAutoSaveEnabled, shouldIncludeImages } from "./settings.js";

chrome.runtime.onInstalled.addListener((details) => {
  ensureArtworkTabsConnected();
  if (details.reason === "install") chrome.runtime.openOptionsPage();
});
ensureArtworkTabsConnected();

async function ensureArtworkTabsConnected() {
  const tabs = await chrome.tabs.query({ url: "https://www.pixiv.net/artworks/*" });
  await Promise.allSettled(tabs
    .filter((tab) => tab.id)
    .map(async (tab) => {
      try {
        await chrome.tabs.sendMessage(tab.id, { type: "PING" });
      } catch {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ["src/content.js"]
        });
      }
    }));
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "REFRESH_WORK_METADATA") {
    refreshWorkMetadata(message.workId)
      .then((metadata) => sendResponse({ ok: true, metadata }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message.type !== "ARCHIVE_WORK" && message.type !== "AUTO_ARCHIVE_WORK") return false;
  const operation = message.type === "AUTO_ARCHIVE_WORK"
    ? archiveIfBookmarked(message.work, message.bookmarkAction)
    : archiveWork(message.work);
  operation
    .then((result) => sendResponse({ ok: true, ...result }))
    .catch((error) => sendResponse({ ok: false, error: error.message }));
  return true;
});

async function archiveIfBookmarked(work, bookmarkAction = false) {
  if (!work?.id) throw new Error("作品IDを取得できませんでした");
  if (!await hasUsageConsent()) {
    return { skipped: true, reason: "usage-consent-required" };
  }
  if (!await isAutoSaveEnabled()) {
    return { skipped: true, reason: "auto-save-disabled" };
  }
  const existingWork = await getWork(work.id);
  if (existingWork) return syncExistingWorkToFolder(existingWork);

  const details = await getArtworkDetails(work.id);
  if (!bookmarkAction && !details.bookmarkData) return { skipped: true, reason: "not-bookmarked" };

  const merged = {
    ...work,
    ...metadataFromDetails(details, work)
  };
  return archiveWork(merged, details);
}

async function archiveWork(work, suppliedDetails) {
  if (!work?.id) throw new Error("作品IDを取得できませんでした");
  if (!await hasUsageConsent()) {
    throw new Error("記録一覧で利用上の注意を確認し、同意してください");
  }

  const details = suppliedDetails || await getArtworkDetails(work.id);
  work = { ...work, ...metadataFromDetails(details, work) };

  const images = [];
  const includeImages = await shouldIncludeImages();
  const imageReferences = await getImageReferences(work.id, { required: includeImages });
  if (includeImages) images.push(...await downloadImages(imageReferences.originalImageUrls));

  const storedWork = {
    ...work,
    includesImages: includeImages,
    ...imageReferences
  };
  delete storedWork.imageUrls;
  let folder;
  try {
    folder = await saveArchiveToFolder(storedWork, images);
  } catch (error) {
    folder = { saved: false, reason: error.message };
  }
  if (includeImages && !folder.saved) {
    throw new Error(folder.reason === "not-configured"
      ? "先に記録一覧から記録先フォルダーを選択してください"
      : `記録先フォルダーへ書き込めませんでした: ${folder.reason || "権限を確認してください"}`);
  }
  await saveArchive({
    ...storedWork,
    ...(folder.saved ? {
      folderSelectionId: folder.folderSelectionId,
      folderName: folder.folderName,
      folderDirectoryName: folder.folderDirectoryName,
      imageFiles: folder.imageFiles
    } : {
      folderSelectionId: null,
      folderName: null,
      folderDirectoryName: null,
      imageFiles: []
    })
  }, images, { storeImages: false });
  return {
    imageCount: images.length,
    byteSize: images.reduce((n, x) => n + x.blob.size, 0),
    folderSaved: folder.saved,
    folderReason: folder.reason
  };
}

async function syncExistingWorkToFolder(work) {
  const folder = await getArchiveFolder();
  const selectionId = await getArchiveFolderSelectionId();
  if (!folder || !selectionId) return { skipped: true, reason: "already-saved" };

  if (work.folderSelectionId === selectionId) {
    return { skipped: true, reason: "already-saved" };
  }

  const images = await getImages(work.id);
  if (!images.length) return { skipped: true, reason: "images-missing" };
  const folderResult = await saveArchiveToFolder(work, images);
  if (!folderResult.saved) {
    return { skipped: true, reason: folderResult.reason };
  }

  await updateWorkMetadata(work.id, {
    folderSelectionId: folderResult.folderSelectionId,
    folderName: folderResult.folderName,
    folderDirectoryName: folderResult.folderDirectoryName,
    imageFiles: folderResult.imageFiles
  });
  return {
    imageCount: images.length,
    byteSize: work.byteSize || images.reduce((sum, image) => sum + image.blob.size, 0),
    folderSaved: true,
    syncedExisting: true
  };
}

async function getArtworkDetails(workId) {
  const response = await fetch(`https://www.pixiv.net/ajax/illust/${workId}?_=${Date.now()}`, {
    credentials: "include",
    cache: "no-store"
  });
  if (!response.ok) throw new Error(`作品情報の取得に失敗しました (${response.status})`);
  const data = await response.json();
  if (data.error || !data.body) throw new Error(data.message || "作品情報を取得できませんでした");
  return data.body;
}

function metadataFromDetails(details, fallback = {}) {
  return {
    title: details.title || fallback.title,
    creatorId: String(details.userId || fallback.creatorId || ""),
    creatorName: details.userName || fallback.creatorName || "",
    description: details.description || fallback.description || "",
    tags: details.tags?.tags?.map((tag) => tag.tag) || fallback.tags || [],
    postedAt: details.createDate || fallback.postedAt || null,
    pageCount: Number(details.pageCount || fallback.pageCount || 0)
  };
}

async function refreshWorkMetadata(workId) {
  if (!workId) throw new Error("作品IDがありません");
  const details = await getArtworkDetails(workId);
  const metadata = {
    ...metadataFromDetails(details),
    ...await getImageReferences(workId)
  };
  await updateWorkMetadata(workId, metadata);
  return metadata;
}

async function getImageReferences(workId, { required = false } = {}) {
  let originalImageUrls = [];
  try {
    originalImageUrls = await getArtworkImageUrls(workId);
  } catch (error) {
    if (required) throw error;
  }
  return {
    originalImageUrls,
    originalImageFileNames: originalImageUrls.map(imageFileName).filter(Boolean)
  };
}

function imageFileName(url) {
  try { return decodeURIComponent(new URL(url).pathname.split("/").pop() || ""); }
  catch { return ""; }
}

async function downloadImages(urls) {
  const images = [];
  for (const url of urls) {
    const response = await fetch(url, { credentials: "include" });
    if (!response.ok) throw new Error(`画像取得に失敗しました (${response.status})`);
    const blob = await response.blob();
    images.push({ blob, mimeType: blob.type || "application/octet-stream" });
  }
  return images;
}

async function getArtworkImageUrls(workId) {
  const response = await fetch(`https://www.pixiv.net/ajax/illust/${workId}/pages?_=${Date.now()}`, {
    credentials: "include",
    cache: "no-store"
  });
  if (!response.ok) {
    throw new Error(`作品ページ情報の取得に失敗しました (${response.status})`);
  }

  const data = await response.json();
  if (data.error || !Array.isArray(data.body)) {
    throw new Error(data.message || "作品ページ情報を取得できませんでした");
  }

  const urls = data.body
    .map((page) => page?.urls?.original)
    .filter((url) => typeof url === "string" && url.startsWith("https://i.pximg.net/"));

  if (urls.length === 0) throw new Error("作品画像を取得できませんでした");
  return urls;
}
