import { deleteImages, deleteWork, getImages, listWorks, updateWorkMetadata } from "./db.js";
import {
  chooseArchiveFolder,
  getArchiveFolder,
  getArchiveFolderPermission,
  readArchiveImagesFromFolder,
  requestArchiveFolderPermission,
  saveArchiveToFolder
} from "./folder.js";
import { initTheme, setTheme } from "./theme.js";
import { formatBytes } from "./utils.js";
import { createArchiveViewer } from "./archive-viewer.js";
import {
  completeOnboarding,
  disableImageRecording,
  enableImageRecording,
  getFirstRunState,
  recordUsageConsent,
  shouldIncludeImages
} from "./settings.js";

const themeButton = document.querySelector("#theme-toggle");
const themeMenu = document.querySelector("#theme-menu");
const searchInput = document.querySelector("#search");
const sortSelect = document.querySelector("#sort-select");
const tagFilters = document.querySelector("#tag-filters");
let selectedTheme = await initTheme(themeButton);
updateThemeOptions();
themeMenu.addEventListener("click", async (event) => {
  const option = event.target.closest("[data-theme-value]");
  if (!option) return;
  selectedTheme = await setTheme(option.dataset.themeValue, themeButton);
  updateThemeOptions();
  themeMenu.removeAttribute("open");
  themeButton.focus();
});

function updateThemeOptions() {
  themeMenu.querySelectorAll("[data-theme-value]").forEach((option) => {
    option.setAttribute("aria-checked", String(option.dataset.themeValue === selectedTheme));
  });
}

const grid = document.querySelector("#works");
const summary = document.querySelector("#summary");
const viewer = document.querySelector("#viewer");
const metadataViewer = document.querySelector("#metadata-viewer");
const onboarding = document.querySelector("#onboarding");
const usageConsent = document.querySelector("#usage-consent");
const shortcutsDialog = document.querySelector("#shortcuts-dialog");
const archiveIncludeImages = document.querySelector("#archive-include-images");
const imageRecordingConsent = document.querySelector("#image-recording-consent");
const restoreFolderAccess = document.querySelector("#restore-folder-access");
const archiveViewer = createArchiveViewer(
  viewer,
  document.querySelector("#viewer-content"),
  metadataViewer,
  document.querySelector("#metadata-content"),
  document.querySelector("#viewer-fullscreen")
);
let works = await listWorks();
let visibleWorks = works;
let searchQuery = "";
const activeTags = new Set();
let favoriteOnly = false;
let sortOrder = sortSelect.value;
const selectedIds = new Set();

function compareDates(a, b, direction) {
  const aTime = a ? new Date(a).getTime() : NaN;
  const bTime = b ? new Date(b).getTime() : NaN;
  const aValid = !Number.isNaN(aTime);
  const bValid = !Number.isNaN(bTime);
  if (!aValid && !bValid) return 0;
  if (!aValid) return 1;
  if (!bValid) return -1;
  return direction === "desc" ? bTime - aTime : aTime - bTime;
}

const sortComparators = {
  "archived-desc": (a, b) => compareDates(a.archivedAt, b.archivedAt, "desc"),
  "archived-asc": (a, b) => compareDates(a.archivedAt, b.archivedAt, "asc"),
  "posted-desc": (a, b) => compareDates(a.postedAt, b.postedAt, "desc"),
  "posted-asc": (a, b) => compareDates(a.postedAt, b.postedAt, "asc"),
  "title-asc": (a, b) => (a.title || "").localeCompare(b.title || "", "ja"),
  "creator-asc": (a, b) => (a.creatorName || "").localeCompare(b.creatorName || "", "ja"),
  "size-desc": (a, b) => (b.byteSize || 0) - (a.byteSize || 0)
};

applyFilters();
const initialFolder = await getArchiveFolder();
showFolderName(initialFolder);
await updateFolderAccess(initialFolder);
archiveIncludeImages.checked = await shouldIncludeImages();

archiveIncludeImages.addEventListener("change", async () => {
  if (!archiveIncludeImages.checked) {
    await disableImageRecording();
    return;
  }
  archiveIncludeImages.checked = false;
  imageRecordingConsent.showModal();
});

document.querySelector("#image-consent-cancel").addEventListener("click", () => {
  archiveIncludeImages.checked = false;
  imageRecordingConsent.close();
});

document.querySelector("#image-consent-agree").addEventListener("click", async () => {
  await enableImageRecording();
  archiveIncludeImages.checked = true;
  imageRecordingConsent.close();
});

const firstRunState = await getFirstRunState();
if (!firstRunState.hasUsageConsent) {
  usageConsent.showModal();
} else if (!firstRunState.onboardingCompleted) {
  onboarding.showModal();
}

searchInput.addEventListener("input", (event) => {
  searchQuery = event.target.value.trim().toLocaleLowerCase();
  applyFilters();
});
sortSelect.addEventListener("change", () => {
  sortOrder = sortSelect.value;
  applyFilters();
});
document.querySelector("#close").addEventListener("click", () => archiveViewer.close());
document.querySelector("#close-metadata").addEventListener("click", () => metadataViewer.close());
document.querySelector("#open-shortcuts").addEventListener("click", () => shortcutsDialog.showModal());
document.querySelector("#close-shortcuts").addEventListener("click", () => shortcutsDialog.close());
document.querySelector("#open-guide").addEventListener("click", () => onboarding.showModal());
document.querySelector("#onboarding-close").addEventListener("click", () => {
  onboarding.close();
});
onboarding.addEventListener("close", () => completeOnboarding());
usageConsent.addEventListener("cancel", (event) => event.preventDefault());
document.querySelector("#usage-consent-agree").addEventListener("click", async () => {
  await recordUsageConsent();
  usageConsent.close();
  onboarding.showModal();
});

document.addEventListener("click", (event) => {
  if (themeMenu.open && !themeMenu.contains(event.target)) themeMenu.removeAttribute("open");
  document.querySelectorAll(".card-menu[open]").forEach((menu) => {
    if (!menu.contains(event.target)) menu.removeAttribute("open");
  });
});
document.addEventListener("keydown", (event) => {
  const editing = event.target.matches("input, textarea, [contenteditable='true']");
  if (event.key === "Escape" && !viewer.hidden && !metadataViewer.open) {
    event.preventDefault();
    archiveViewer.close();
    return;
  }
  if (event.key === "Escape" && themeMenu.open) {
    event.preventDefault();
    themeMenu.removeAttribute("open");
    themeButton.focus();
    return;
  }
  if (event.key === "Escape" && event.target.matches("#search")) {
    event.preventDefault();
    event.target.blur();
    return;
  }
  if (event.key === "/" && !editing && !event.metaKey && !event.ctrlKey && !event.altKey) {
    event.preventDefault();
    document.querySelector("#search").focus();
    return;
  }
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "a" && !editing) {
    event.preventDefault();
    visibleWorks.forEach((work) => selectedIds.add(work.id));
    render(visibleWorks);
    return;
  }
  if (event.key === "Escape" && selectedIds.size > 0) {
    selectedIds.clear();
    render(visibleWorks);
  }
});
document.querySelector("#select-visible").addEventListener("click", () => {
  visibleWorks.forEach((work) => selectedIds.add(work.id));
  render(visibleWorks);
});
document.querySelector("#clear-selection").addEventListener("click", () => {
  selectedIds.clear();
  render(visibleWorks);
});
restoreFolderAccess.addEventListener("click", async () => {
  const folder = await getArchiveFolder();
  if (!folder) {
    restoreFolderAccess.hidden = true;
    showFolderName(null);
    return;
  }

  restoreFolderAccess.disabled = true;
  try {
    const granted = await requestArchiveFolderPermission(folder);
    restoreFolderAccess.hidden = granted;
    if (granted) render(visibleWorks);
  } catch (error) {
    if (error.name !== "AbortError") alert(error.message);
  } finally {
    restoreFolderAccess.disabled = false;
  }
});
document.querySelector("#delete-selected").addEventListener("click", async () => {
  const targets = works.filter((work) => selectedIds.has(work.id));
  if (!targets.length) return;
  if (!confirm(`選択した${targets.length}作品を一覧から削除しますか？\n外部フォルダーの画像ファイルは削除されません。`)) return;

  const button = document.querySelector("#delete-selected");
  button.disabled = true;
  button.textContent = "削除中…";
  await Promise.all(targets.map((work) => deleteWork(work.id)));
  works = works.filter((work) => !selectedIds.has(work.id));
  selectedIds.clear();
  button.textContent = "選択項目を削除";
  applyFilters();
});

document.querySelector("#choose-folder").addEventListener("click", async () => {
  const button = document.querySelector("#choose-folder");
  try {
    const previousFolder = await getArchiveFolder();
    const handle = await chooseArchiveFolder();
    showFolderName(handle);
    restoreFolderAccess.hidden = true;
    button.disabled = true;
    let failures = 0;
    for (let index = 0; index < works.length; index += 1) {
      button.textContent = `既存作品をコピー中 ${index + 1}/${works.length}`;
      try {
        let images = await getImages(works[index].id);
        if (!images.length && works[index].imageCount > 0) {
          if (!previousFolder) {
            failures += 1;
            continue;
          }
          images = await readArchiveImagesFromFolder(previousFolder, works[index]);
        }
        const result = await saveArchiveToFolder(works[index], images);
        if (!result.saved) {
          failures += 1;
          continue;
        }
        Object.assign(works[index], {
          folderSelectionId: result.folderSelectionId,
          folderName: result.folderName,
          folderDirectoryName: result.folderDirectoryName,
          imageFiles: result.imageFiles
        });
        await updateWorkMetadata(works[index].id, {
          folderSelectionId: result.folderSelectionId,
          folderName: result.folderName,
          folderDirectoryName: result.folderDirectoryName,
          imageFiles: result.imageFiles
        });
        await deleteImages(works[index].id);
      } catch {
        failures += 1;
      }
    }
    if (failures) alert(`${failures}作品を新しい記録先へコピーできませんでした`);
  } catch (error) {
    if (error.name !== "AbortError") alert(error.message);
  } finally {
    button.disabled = false;
    button.textContent = "記録先";
  }
});

function openWorkViewer(work, options = {}) {
  archiveViewer.showImages(work, { ...options, works: visibleWorks, index: visibleWorks.indexOf(work) });
}

function applyFilters() {
  const availableTags = new Set(works.flatMap((work) => (work.tags || []).map(normalizeTag)));
  activeTags.forEach((tag) => { if (!availableTags.has(tag)) activeTags.delete(tag); });
  visibleWorks = works.filter((work) => {
    const searchable = [work.title, work.creatorName, ...(work.tags || [])]
      .join(" ")
      .toLocaleLowerCase();
    const matchesSearch = !searchQuery || searchable.includes(searchQuery);
    const workTags = new Set((work.tags || []).map(normalizeTag));
    const matchesTag = activeTags.size === 0 || [...activeTags].every((tag) => workTags.has(tag));
    const matchesFavorite = !favoriteOnly || work.favorite === true;
    return matchesSearch && matchesTag && matchesFavorite;
  });
  visibleWorks.sort(sortComparators[sortOrder] || sortComparators["archived-desc"]);
  render(visibleWorks);
}

function render(items) {
  summary.textContent = `${works.length}作品・${formatBytes(works.reduce((sum, work) => sum + (work.byteSize || 0), 0))}`;
  renderTagFilters();
  grid.replaceChildren(...items.map(card));
  if (!items.length) grid.textContent = works.length ? "条件に一致する作品はありません。" : "記録済み作品はありません。";
  updateSelectionControls();
}

function renderTagFilters() {
  const allTags = popularTags();
  const tags = allTags.slice(0, 10);
  const tagKeys = new Set(tags.map((tag) => tag.key));
  allTags.forEach((tag) => {
    if (!activeTags.has(tag.key) || tagKeys.has(tag.key)) return;
    tags.push(tag);
    tagKeys.add(tag.key);
  });
  tagFilters.hidden = works.length === 0 || selectedIds.size > 0;
  if (works.length === 0) {
    tagFilters.replaceChildren();
    return;
  }
  if (selectedIds.size > 0) return;

  const favorite = document.createElement("button");
  favorite.type = "button";
  favorite.className = "tag-filter favorite-filter";
  favorite.textContent = "♥ お気に入り";
  favorite.setAttribute("aria-pressed", String(favoriteOnly));
  favorite.addEventListener("click", () => {
    favoriteOnly = !favoriteOnly;
    applyFilters();
  });

  const buttons = tags.map((tag, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `tag-filter tag-color-${index % 8}`;
    button.textContent = `#${tag.label}`;
    button.setAttribute("aria-pressed", String(activeTags.has(tag.key)));
    button.addEventListener("click", () => {
      activeTags.has(tag.key) ? activeTags.delete(tag.key) : activeTags.add(tag.key);
      applyFilters();
    });
    return button;
  });
  const scrollArea = document.createElement("div");
  scrollArea.className = "tag-filters-scroll";
  scrollArea.append(...buttons);
  const children = [favorite, scrollArea];
  if (activeTags.size > 0) {
    const reset = document.createElement("button");
    reset.type = "button";
    reset.className = "tag-reset";
    reset.textContent = "タグをリセット";
    reset.addEventListener("click", () => {
      activeTags.clear();
      applyFilters();
    });
    children.push(reset);
  }
  tagFilters.replaceChildren(...children);
}

function popularTags() {
  const counts = new Map();
  works.forEach((work) => {
    const seen = new Set();
    (work.tags || []).forEach((rawTag) => {
      const label = String(rawTag || "").trim();
      const key = normalizeTag(label);
      if (!key || seen.has(key)) return;
      seen.add(key);
      const entry = counts.get(key) || { key, label, count: 0 };
      entry.count += 1;
      counts.set(key, entry);
    });
  });
  return [...counts.values()]
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "ja"));
}

function normalizeTag(tag) {
  return String(tag || "").trim().toLocaleLowerCase();
}

function card(work) {
  const article = document.querySelector("#work-card-template").content.firstElementChild.cloneNode(true);
  article.classList.toggle("metadata-only", work.imageCount === 0);
  article.setAttribute("aria-label", `${work.title}を選択`);
  const checkbox = article.querySelector(".select-work input");
  checkbox.checked = selectedIds.has(work.id);
  article.classList.toggle("selected", checkbox.checked);
  checkbox.addEventListener("change", () => {
    checkbox.checked ? selectedIds.add(work.id) : selectedIds.delete(work.id);
    article.classList.toggle("selected", checkbox.checked);
    updateSelectionControls();
  });
  const toggleSelection = () => {
    checkbox.checked = !checkbox.checked;
    checkbox.dispatchEvent(new Event("change"));
  };
  article.addEventListener("click", (event) => {
    if (event.target.closest(".thumb, .select-work, .card-menu, a, button, input")) return;
    toggleSelection();
  });
  article.addEventListener("keydown", (event) => {
    if (event.target.closest(".card-menu, button, a, input, .select-work")) return;
    if (event.key === "Enter") {
      event.preventDefault();
      openWorkViewer(work);
      return;
    }
    if (event.key === " ") {
      event.preventDefault();
      toggleSelection();
    }
  });
  article.querySelector("h2").textContent = work.title;
  article.querySelector(".creator").textContent = work.creatorName || "作者不明";
  article.querySelector(".meta").textContent = `${work.imageCount}枚・${formatBytes(work.byteSize)}`;
  const sourceLink = article.querySelector("[data-source]");
  if (work.sourceUrl) sourceLink.href = work.sourceUrl;
  else sourceLink.hidden = true;
  const query = [work.id, work.title, work.creatorName].filter(Boolean).join(" ");
  article.querySelector("[data-google]").href = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
  article.querySelector("[data-metadata]").addEventListener("click", async () => {
    const result = await chrome.runtime.sendMessage({
      type: "COMPLETE_WORK_METADATA",
      workId: work.id
    });
    if (result?.ok) Object.assign(work, result.metadata);
    else if (result?.error) alert(result.error);
    archiveViewer.showMetadata(work);
  });
  const favoriteButton = article.querySelector(".favorite-button");
  updateFavoriteButton(favoriteButton, work);
  favoriteButton.addEventListener("click", async (event) => {
    event.stopPropagation();
    if (favoriteButton.dataset.saving === "true") return;
    const previous = work.favorite === true;
    work.favorite = !previous;
    favoriteButton.dataset.saving = "true";
    updateFavoriteButton(favoriteButton, work);
    try {
      await updateWorkMetadata(work.id, { favorite: work.favorite });
      applyFilters();
    } catch (error) {
      work.favorite = previous;
      delete favoriteButton.dataset.saving;
      updateFavoriteButton(favoriteButton, work);
      alert(error.message);
    }
  });
  let thumbClickTimer = null;
  const thumbContent = article.querySelector(".thumb-content");
  thumbContent.addEventListener("click", () => {
    if (thumbClickTimer) return;
    thumbClickTimer = setTimeout(() => {
      thumbClickTimer = null;
      openWorkViewer(work);
    }, 220);
  });
  thumbContent.addEventListener("dblclick", () => {
    if (thumbClickTimer) {
      clearTimeout(thumbClickTimer);
      thumbClickTimer = null;
    }
    openWorkViewer(work, { fullscreen: true });
  });
  article.querySelector("[data-delete]").addEventListener("click", async () => {
    if (!confirm(`「${work.title}」を一覧から削除しますか？\n外部フォルダーの画像ファイルは削除されません。`)) return;
    await deleteWork(work.id);
    works = works.filter((item) => item.id !== work.id);
    selectedIds.delete(work.id);
    applyFilters();
  });
  article.querySelectorAll(".card-menu-items a, .card-menu-items button").forEach((item) => {
    item.addEventListener("click", () => article.querySelector(".card-menu").removeAttribute("open"));
  });
  archiveViewer.loadThumbnail(article.querySelector(".thumb-content"), work);
  return article;
}

function updateFavoriteButton(button, work) {
  const favorite = work.favorite === true;
  button.setAttribute("aria-pressed", String(favorite));
  button.setAttribute("aria-label", favorite ? "お気に入りから削除" : "お気に入りに追加");
}

function showFolderName(handle) {
  document.querySelector("#folder-name").textContent = handle
    ? `記録先: ${handle.name}`
    : "記録先: 未選択";
}

async function updateFolderAccess(handle) {
  restoreFolderAccess.hidden = !handle
    || await getArchiveFolderPermission(handle, "readwrite") === "granted";
}

function updateSelectionControls() {
  const count = selectedIds.size;
  document.querySelector("#selection-actions").hidden = count === 0;
  tagFilters.hidden = works.length === 0 || count > 0;
  const deleteButton = document.querySelector("#delete-selected");
  deleteButton.disabled = count === 0;
  deleteButton.textContent = count ? `${count}件を削除` : "選択項目を削除";

  document.querySelector("#select-visible").disabled = visibleWorks.length === 0
    || visibleWorks.every((work) => selectedIds.has(work.id));
}
