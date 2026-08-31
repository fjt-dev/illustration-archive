import { getWork, saveArchive, updateWorkMetadata } from "./db.js";
import { getArchiveFolder, saveArchiveToFolder } from "./folder.js";
import { hasUsageConsent, shouldIncludeImages } from "./settings.js";

const CONTENT_SCRIPT_VERSION = 6;

chrome.runtime.onInstalled.addListener((details) => {
  ensureArtworkTabsConnected();
  if (details.reason === "install") chrome.runtime.openOptionsPage();
});
ensureArtworkTabsConnected();

async function ensureArtworkTabsConnected() {
  const tabs = await chrome.tabs.query({ url: "https://www.pixiv.net/*" });
  await Promise.allSettled(tabs
    .filter((tab) => tab.id)
    .map(async (tab) => {
      try {
        const response = await chrome.tabs.sendMessage(tab.id, { type: "PING" });
        if (response?.version !== CONTENT_SCRIPT_VERSION) throw new Error("Outdated content script");
      } catch {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ["src/content.js"]
        });
      }
    }));
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "COMPLETE_WORK_METADATA") {
    completeStoredWorkMetadata(message.workId)
      .then((metadata) => sendResponse({ ok: true, metadata }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message.type !== "ARCHIVE_WORK") return false;
  archiveWork(message.work)
    .then((result) => sendResponse({ ok: true, ...result }))
    .catch((error) => sendResponse({ ok: false, error: error.message }));
  return true;
});

async function archiveWork(work, { metadataResolved = false } = {}) {
  if (!work?.id) throw new Error("作品IDを取得できませんでした");
  if (!await hasUsageConsent()) {
    throw new Error("記録一覧で利用上の注意を確認し、同意してください");
  }
  const includeImages = await shouldIncludeImages();
  if (includeImages) {
    const folder = await getArchiveFolder();
    if (!folder) throw new Error("先に記録一覧から記録先フォルダーを選択してください");
    if (await folder.queryPermission({ mode: "readwrite" }) !== "granted") {
      throw new Error("記録一覧から記録先フォルダーへのアクセスを再許可してください");
    }
  }
  const images = [];
  let imageReferences;
  if (includeImages) {
    if (!metadataResolved) work = await enrichWorkMetadata(work);
    imageReferences = await getImageReferences(work.id, { required: true });
    images.push(...await downloadImages(imageReferences.originalImageUrls));
  } else {
    if (!metadataResolved) work = await enrichWorkMetadata(work);
    imageReferences = embeddedImageReferences(work);
  }

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

function embeddedImageReferences(work) {
  const originalImageUrls = Array.isArray(work.originalImageUrls)
    ? work.originalImageUrls.filter((url) => typeof url === "string" && url.startsWith("https://i.pximg.net/"))
    : [];
  const originalImageFileNames = Array.isArray(work.originalImageFileNames)
    ? work.originalImageFileNames.filter(Boolean)
    : originalImageUrls.map(imageFileName).filter(Boolean);
  return { originalImageUrls, originalImageFileNames };
}

async function enrichWorkMetadata(work, { required = false } = {}) {
  if (!needsMetadataFallback(work)) return work;
  try {
    const details = await getArtworkDetails(work.id);
    return { ...work, ...metadataFromDetails(details, work) };
  } catch (error) {
    if (required) throw error;
    console.warn("Illustration Archive: metadata completion failed", error);
    return work;
  }
}

function needsMetadataFallback(work) {
  if (work.metadataComplete === true) return false;
  return !work.creatorId
    || !work.creatorName
    || !work.postedAt
    || !Array.isArray(work.tags)
    || work.tags.length === 0;
}

function metadataForStorage(work) {
  return {
    title: work.title,
    creatorId: work.creatorId,
    creatorName: work.creatorName,
    description: work.description,
    tags: work.tags,
    postedAt: work.postedAt,
    pageCount: work.pageCount,
    sourceUrl: work.sourceUrl,
    originalImageUrls: work.originalImageUrls,
    originalImageFileNames: work.originalImageFileNames,
    metadataComplete: work.metadataComplete === true
  };
}

async function completeStoredWorkMetadata(workId) {
  const work = await getWork(workId);
  if (!work) throw new Error("記録済み作品が見つかりませんでした");
  const enrichedWork = await enrichWorkMetadata(work, { required: true });
  const metadata = metadataForStorage(enrichedWork);
  await updateWorkMetadata(workId, metadata);
  return metadata;
}

async function getArtworkDetails(workId) {
  const response = await fetch(`https://www.pixiv.net/ajax/illust/${workId}?_=${Date.now()}`, {
    credentials: "include",
    cache: "no-store"
  });
  if (!response.ok) throw new Error(`不足している作品情報の取得に失敗しました (${response.status})`);
  const data = await response.json();
  if (data.error || !data.body) throw new Error(data.message || "不足している作品情報を取得できませんでした");
  return data.body;
}

function metadataFromDetails(details, fallback = {}) {
  return {
    title: details.title || fallback.title,
    creatorId: String(details.userId || fallback.creatorId || ""),
    creatorName: details.userName || fallback.creatorName || "",
    description: details.description || fallback.description || "",
    tags: details.tags?.tags?.map((tag) => tag.tag)
      || (Array.isArray(details.tags) ? details.tags : fallback.tags)
      || [],
    postedAt: details.createDate || fallback.postedAt || null,
    pageCount: Number(details.pageCount || fallback.pageCount || 0),
    metadataComplete: true
  };
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
