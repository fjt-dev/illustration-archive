import { getWork, saveArchive, updateWorkMetadata } from "./db.js";
import { getArchiveFolder, saveArchiveToFolder } from "./folder.js";
import { hasUsageConsent, shouldIncludeImages } from "./settings.js";
import { message } from "./i18n.js";

const CONTENT_SCRIPT_VERSION = 9;
const IMAGE_HEADER_RULE_ID = 1;
const MAX_IMAGE_COUNT = 200;
const MAX_IMAGE_BYTES = 32 * 1024 * 1024;
const MAX_TOTAL_IMAGE_BYTES = 256 * 1024 * 1024;
const activeArchives = new Set();

const imageHeaderRuleReady = configureImageHeaderRule();
imageHeaderRuleReady.catch((error) => {
  console.error("Illustration Archive: could not configure image request headers", error);
});

async function configureImageHeaderRule() {
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [IMAGE_HEADER_RULE_ID],
    addRules: [{
      id: IMAGE_HEADER_RULE_ID,
      priority: 1,
      action: {
        type: "modifyHeaders",
        requestHeaders: [{
          header: "Referer",
          operation: "set",
          value: "https://www.pixiv.net/"
        }]
      },
      condition: {
        urlFilter: "|https://i.pximg.net/",
        requestDomains: ["i.pximg.net"],
        initiatorDomains: [chrome.runtime.id],
        resourceTypes: ["xmlhttprequest"]
      }
    }]
  });
}

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

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request?.type === "COMPLETE_WORK_METADATA") {
    if (!isExtensionPageSender(sender, "src/archive.html")) {
      sendResponse({ ok: false, error: message("invalidMessageSender") });
      return false;
    }
    completeStoredWorkMetadata(request.workId)
      .then((metadata) => sendResponse({ ok: true, metadata }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (request?.type !== "ARCHIVE_WORK") return false;
  if (!isArchiveSender(sender)) {
    sendResponse({ ok: false, error: message("invalidMessageSender") });
    return false;
  }
  archiveWorkOnce(request.work)
    .then((result) => sendResponse({ ok: true, ...result }))
    .catch((error) => sendResponse({ ok: false, error: error.message }));
  return true;
});

function isExtensionPageSender(sender, path) {
  return sender?.id === chrome.runtime.id && sender.url === chrome.runtime.getURL(path);
}

function isArchiveSender(sender) {
  if (sender?.id !== chrome.runtime.id) return false;
  if (isExtensionPageSender(sender, "src/popup.html")) return true;
  if (sender.frameId !== 0 || !Number.isInteger(sender.tab?.id)) return false;
  const url = sender.tab.url || sender.url || "";
  return /^https:\/\/www\.pixiv\.net\/artworks\/\d+(?:[/?#]|$)/.test(url);
}

async function archiveWorkOnce(rawWork) {
  const work = normalizeWork(rawWork);
  if (activeArchives.has(work.id)) throw new Error(message("archiveAlreadyInProgress"));
  activeArchives.add(work.id);
  try {
    return await archiveWork(work);
  } finally {
    activeArchives.delete(work.id);
  }
}

async function archiveWork(work, { metadataResolved = false } = {}) {
  if (!await hasUsageConsent()) {
    throw new Error(message("consentRequired"));
  }
  const includeImages = await shouldIncludeImages();
  if (includeImages) {
    const folder = await getArchiveFolder();
    if (!folder) throw new Error(message("chooseFolderFirst"));
    if (await folder.queryPermission({ mode: "readwrite" }) !== "granted") {
      throw new Error(message("restoreFolderAccessRequired"));
    }
  }
  const images = [];
  let imageReferences;
  if (includeImages) {
    await imageHeaderRuleReady;
    if (!metadataResolved) work = normalizeWork(await enrichWorkMetadata(work));
    imageReferences = await getImageReferences(work.id, { required: true });
    images.push(...await downloadImages(imageReferences.originalImageUrls));
  } else {
    if (!metadataResolved) work = normalizeWork(await enrichWorkMetadata(work));
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
      ? message("chooseFolderFirst")
      : message("folderWriteFailed", folder.reason || message("checkPermission")));
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

function normalizeWork(work) {
  const id = String(work?.id || "");
  if (!/^\d{1,20}$/.test(id)) throw new Error(message("artworkIdFailed"));
  const tags = Array.isArray(work.tags)
    ? work.tags.slice(0, 1000).map((tag) => safeString(tag, 500)).filter(Boolean)
    : [];
  const originalImageUrls = Array.isArray(work.originalImageUrls)
    ? work.originalImageUrls.slice(0, MAX_IMAGE_COUNT).filter(isPixivImageUrl)
    : [];
  const originalImageFileNames = Array.isArray(work.originalImageFileNames)
    ? work.originalImageFileNames.slice(0, MAX_IMAGE_COUNT).map((name) => safeString(name, 1000)).filter(Boolean)
    : [];
  return {
    id,
    sourceUrl: `https://www.pixiv.net/artworks/${id}`,
    title: safeString(work.title, 1000) || `pixiv ${id}`,
    creatorId: safeString(work.creatorId, 100),
    creatorName: safeString(work.creatorName, 1000),
    description: safeString(work.description, 100000),
    tags,
    postedAt: safeString(work.postedAt, 100),
    pageCount: Math.max(0, Math.min(10000, Number(work.pageCount) || 0)),
    originalImageUrls,
    originalImageFileNames,
    metadataComplete: work.metadataComplete === true
  };
}

function safeString(value, maxLength) {
  return typeof value === "string" ? value.slice(0, maxLength) : "";
}

function isPixivImageUrl(value) {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "i.pximg.net";
  } catch {
    return false;
  }
}

function embeddedImageReferences(work) {
  const originalImageUrls = Array.isArray(work.originalImageUrls)
    ? work.originalImageUrls.filter(isPixivImageUrl)
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
  if (!work) throw new Error(message("archivedArtworkNotFound"));
  const enrichedWork = normalizeWork(await enrichWorkMetadata(work, { required: true }));
  const metadata = metadataForStorage(enrichedWork);
  await updateWorkMetadata(workId, metadata);
  return metadata;
}

async function getArtworkDetails(workId) {
  const response = await fetch(`https://www.pixiv.net/ajax/illust/${workId}?_=${Date.now()}`, {
    credentials: "include",
    cache: "no-store"
  });
  if (!response.ok) throw new Error(message("missingArtworkInfoFailedStatus", String(response.status)));
  const data = await response.json();
  if (data.error || !data.body) throw new Error(data.message || message("missingArtworkInfoFailed"));
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
  let totalBytes = 0;
  if (urls.length > MAX_IMAGE_COUNT) throw new Error(message("tooManyImages"));
  for (const url of urls) {
    const response = await fetch(url, { credentials: "include" });
    if (!response.ok) throw new Error(message("imageDownloadFailedStatus", String(response.status)));
    const declaredBytes = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredBytes) && declaredBytes > MAX_IMAGE_BYTES) {
      throw new Error(message("imageTooLarge"));
    }
    if (Number.isFinite(declaredBytes) && totalBytes + declaredBytes > MAX_TOTAL_IMAGE_BYTES) {
      throw new Error(message("archiveTooLarge"));
    }
    const blob = await response.blob();
    if (!/^image\/(?:jpeg|png|gif|webp)$/i.test(blob.type)) {
      throw new Error(message("unsupportedImageType"));
    }
    if (blob.size > MAX_IMAGE_BYTES) throw new Error(message("imageTooLarge"));
    totalBytes += blob.size;
    if (totalBytes > MAX_TOTAL_IMAGE_BYTES) throw new Error(message("archiveTooLarge"));
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
    throw new Error(message("artworkPageInfoFailedStatus", String(response.status)));
  }

  const data = await response.json();
  if (data.error || !Array.isArray(data.body)) {
    throw new Error(data.message || message("artworkPageInfoFailed"));
  }

  const urls = data.body
    .map((page) => page?.urls?.original)
    .filter(isPixivImageUrl);

  if (urls.length === 0) throw new Error(message("artworkImagesFailed"));
  if (urls.length > MAX_IMAGE_COUNT) throw new Error(message("tooManyImages"));
  return urls;
}
