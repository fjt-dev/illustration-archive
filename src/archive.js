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
import { catalogLocale, localizeDocument, message } from "./i18n.js";
import {
  completeOnboarding,
  disableImageRecording,
  enableImageRecording,
  getFirstRunState,
  recordUsageConsent,
  shouldIncludeImages
} from "./settings.js";

localizeDocument();
const themeButton = document.querySelector("#theme-toggle");
const themeMenu = document.querySelector("#theme-menu");
const searchInput = document.querySelector("#search");
const searchBox = document.querySelector(".search-box");
const searchSuggestions = document.querySelector("#search-suggestions");
const searchSuggestionsHeading = document.querySelector("#search-suggestions-heading");
const searchSuggestionList = document.querySelector("#search-suggestion-list");
const sortMenu = document.querySelector("#sort-menu");
const sortToggle = document.querySelector("#sort-toggle");
const sortToggleLabel = document.querySelector("#sort-toggle-label");
const tagFilters = document.querySelector("#tag-filters");
const tagDialog = document.querySelector("#tag-dialog");
const tagList = document.querySelector("#tag-list");
const tagSearchInput = document.querySelector("#tag-search");
const tagDialogSummary = document.querySelector("#tag-dialog-summary");
const noMatchingTags = document.querySelector("#no-matching-tags");
const uiLocale = catalogLocale();
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

sortMenu.addEventListener("click", (event) => {
  const option = event.target.closest("[data-sort-value]");
  if (!option) return;
  sortOrder = option.dataset.sortValue;
  updateSortOptions();
  sortMenu.removeAttribute("open");
  sortToggle.focus();
  applyFilters();
});

function updateSortOptions() {
  sortMenu.querySelectorAll("[data-sort-value]").forEach((option) => {
    const checked = option.dataset.sortValue === sortOrder;
    option.setAttribute("aria-checked", String(checked));
    if (checked) sortToggleLabel.textContent = option.textContent;
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
const pendingFavorites = new Set();
const archiveViewer = createArchiveViewer(
  viewer,
  document.querySelector("#viewer-content"),
  metadataViewer,
  document.querySelector("#metadata-content"),
  {
    createFavoriteButton,
    getReturnFocus: getArchiveReturnFocus
  }
);
let works = await listWorks();
let visibleWorks = works;
let searchQuery = "";
let tagSearchQuery = "";
const activeTags = new Set();
let favoriteOnly = false;
let sortOrder = "archived-desc";
updateSortOptions();
const selectedIds = new Set();
const BATCH_SIZE = 36;
const COMMON_TAG_MIN_WORKS = 30;
const COMMON_TAG_COVERAGE_THRESHOLD = 0.8;
const SEARCH_SUGGESTION_LIMIT = 4;
const storedSearchHistory = (await chrome.storage.local.get("archiveSearchHistory")).archiveSearchHistory;
let searchHistory = Array.isArray(storedSearchHistory)
  ? storedSearchHistory.filter((entry) => typeof entry === "string" && entry.trim()).slice(0, SEARCH_SUGGESTION_LIMIT)
  : [];
let activeSearchSuggestion = -1;
let renderedCount = 0;
let viewMode = (await chrome.storage.local.get("archiveViewMode")).archiveViewMode === "infinite"
  ? "infinite" : "standard";
const scrollFooter = document.querySelector("#scroll-footer");
const scrollStatus = document.querySelector("#scroll-status");
const loadMoreButton = document.querySelector("#load-more");
const scrollObserver = new IntersectionObserver((entries) => {
  if (entries.some((entry) => entry.isIntersecting)) appendNextBatch();
}, { rootMargin: "600px 0px" });
const thumbnailObserver = new IntersectionObserver((entries) => {
  for (const entry of entries) {
    if (!entry.isIntersecting) continue;
    thumbnailObserver.unobserve(entry.target);
    archiveViewer.loadThumbnail(entry.target.querySelector(".thumb-content"), entry.target.work);
  }
}, { rootMargin: "600px 0px" });
loadMoreButton.addEventListener("click", appendNextBatch);
document.querySelectorAll("[data-view-mode]").forEach((button) => {
  button.addEventListener("click", () => {
    if (viewMode === button.dataset.viewMode) return;
    viewMode = button.dataset.viewMode;
    render(visibleWorks, { reset: true });
    chrome.storage.local.set({ archiveViewMode: viewMode }).catch(console.error);
    window.scrollTo({ top: 0, behavior: "instant" });
  });
});

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
  "title-asc": (a, b) => (a.title || "").localeCompare(b.title || "", uiLocale),
  "creator-asc": (a, b) => (a.creatorName || "").localeCompare(b.creatorName || "", uiLocale),
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
  searchQuery = normalizeSearchText(event.target.value);
  applyFilters();
  renderSearchSuggestions();
});
searchInput.addEventListener("focus", renderSearchSuggestions);
searchInput.addEventListener("blur", (event) => {
  if (searchBox.contains(event.relatedTarget)) return;
  hideSearchSuggestions();
});
searchInput.addEventListener("keydown", (event) => {
  if (event.isComposing) return;
  const options = [...searchSuggestionList.querySelectorAll("[role='option']")];
  if (event.key === "ArrowDown" && options.length) {
    event.preventDefault();
    setActiveSearchSuggestion((activeSearchSuggestion + 1) % options.length);
    return;
  }
  if (event.key === "ArrowUp" && options.length) {
    event.preventDefault();
    setActiveSearchSuggestion(activeSearchSuggestion <= 0 ? options.length - 1 : activeSearchSuggestion - 1);
    return;
  }
  if (event.key === "Enter") {
    event.preventDefault();
    const selected = options[activeSearchSuggestion];
    if (selected) selectSearchSuggestion(selected.dataset.searchValue);
    else {
      rememberSearch(searchInput.value);
      hideSearchSuggestions();
    }
    return;
  }
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    hideSearchSuggestions();
    searchInput.blur();
  }
});
tagSearchInput.addEventListener("input", (event) => {
  tagSearchQuery = event.target.value.trim().toLocaleLowerCase();
  renderTagList();
});
document.querySelector("#close-tag-dialog").addEventListener("click", () => tagDialog.close());
document.querySelector("#finish-tag-selection").addEventListener("click", () => tagDialog.close());
document.querySelector("#clear-tag-selection").addEventListener("click", () => {
  activeTags.clear();
  applyFilters();
  renderTagList();
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
  if (!searchBox.contains(event.target)) hideSearchSuggestions();
  if (themeMenu.open && !themeMenu.contains(event.target)) themeMenu.removeAttribute("open");
  if (sortMenu.open && !sortMenu.contains(event.target)) sortMenu.removeAttribute("open");
  document.querySelectorAll(".card-menu[open]").forEach((menu) => {
    if (!menu.contains(event.target)) menu.removeAttribute("open");
  });
});
window.addEventListener("resize", () => {
  const scrollArea = tagFilters.querySelector(".tag-filters-scroll");
  if (scrollArea) updateTagScrollFade(scrollArea);
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
  if (event.key === "Escape" && sortMenu.open) {
    event.preventDefault();
    sortMenu.removeAttribute("open");
    sortToggle.focus();
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
  if (!confirm(message("confirmDeleteSelected", String(targets.length)))) return;

  const button = document.querySelector("#delete-selected");
  button.disabled = true;
  button.textContent = message("deleting");
  await Promise.all(targets.map((work) => deleteWork(work.id)));
  works = works.filter((work) => !selectedIds.has(work.id));
  selectedIds.clear();
  button.textContent = message("deleteSelected");
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
      button.textContent = message("copyingExisting", [String(index + 1), String(works.length)]);
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
    if (failures) alert(message("copyFailures", String(failures)));
  } catch (error) {
    if (error.name !== "AbortError") alert(error.message);
  } finally {
    button.disabled = false;
    button.textContent = message("archiveFolder");
  }
});

function openWorkViewer(work, options = {}) {
  archiveViewer.showImages(work, { ...options, works: visibleWorks, index: visibleWorks.indexOf(work) });
}

function applyFilters() {
  const availableTags = new Set(works.flatMap((work) => (work.tags || []).map(normalizeTag)));
  activeTags.forEach((tag) => { if (!availableTags.has(tag)) activeTags.delete(tag); });
  const queryTokens = searchTokens(searchQuery);
  visibleWorks = works.filter((work) => {
    const searchable = normalizeSearchText([work.title, work.creatorName, ...(work.tags || [])].join(" "));
    const matchesSearch = queryTokens.every((token) => searchable.includes(token));
    const workTags = new Set((work.tags || []).map(normalizeTag));
    const matchesTag = activeTags.size === 0 || [...activeTags].every((tag) => workTags.has(tag));
    const matchesFavorite = !favoriteOnly || work.favorite === true;
    return matchesSearch && matchesTag && matchesFavorite;
  });
  visibleWorks.sort(sortComparators[sortOrder] || sortComparators["archived-desc"]);
  render(visibleWorks, { reset: true });
  archiveViewer.updateNavigation(visibleWorks);
}

function normalizeSearchText(value) {
  return String(value || "")
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[ァ-ヶ]/g, (character) => String.fromCharCode(character.charCodeAt(0) - 0x60))
    .replace(/[‐‑‒–—―]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function searchTokens(query) {
  return normalizeSearchText(query)
    .split(" ")
    .map((token) => token.replace(/^#+/, ""))
    .filter(Boolean);
}

function searchMatchRank(candidate, query) {
  const tokens = searchTokens(query);
  const normalizedQuery = tokens.join(" ");
  if (!tokens.length) return Number.POSITIVE_INFINITY;
  if (candidate === normalizedQuery) return 0;
  if (candidate.startsWith(normalizedQuery)) return 1;
  const words = candidate.split(/[\s/_-]+/);
  if (tokens.every((token) => words.some((word) => word.startsWith(token)))) return 2;
  if (tokens.every((token) => candidate.includes(token))) return 3;
  return Number.POSITIVE_INFINITY;
}

function searchCandidates(query) {
  const queryTokens = searchTokens(query);
  if (!queryTokens.length) return [];
  const candidates = new Map();
  works.forEach((work) => {
    const seen = new Set();
    [work.title, work.creatorName, ...(work.tags || [])].forEach((rawValue) => {
      const label = String(rawValue || "").trim();
      const key = normalizeSearchText(label);
      const rank = searchMatchRank(key, query);
      if (!key || !Number.isFinite(rank) || seen.has(key)) return;
      seen.add(key);
      const candidate = candidates.get(key) || { key, label, count: 0, rank };
      candidate.count += 1;
      candidate.rank = Math.min(candidate.rank, rank);
      candidates.set(key, candidate);
    });
  });
  return [...candidates.values()].sort((a, b) => a.rank - b.rank
    || b.count - a.count
    || a.label.localeCompare(b.label, uiLocale));
}

function renderSearchSuggestions() {
  const query = searchInput.value.trim();
  const showingHistory = !query;
  const values = query
    ? searchCandidates(query).slice(0, SEARCH_SUGGESTION_LIMIT).map((candidate) => candidate.label)
    : searchHistory.slice(0, SEARCH_SUGGESTION_LIMIT);
  if (!values.length) {
    hideSearchSuggestions();
    return;
  }

  searchSuggestionsHeading.textContent = message(query ? "searchSuggestions" : "recentSearches");
  const rows = values.map((value, index) => {
    const row = document.createElement("div");
    row.className = "search-suggestion-row";
    row.setAttribute("role", "none");

    const button = document.createElement("button");
    button.type = "button";
    button.id = `search-suggestion-${index}`;
    button.className = "search-suggestion";
    button.setAttribute("role", "option");
    button.setAttribute("aria-selected", "false");
    button.dataset.searchValue = value;
    button.textContent = value;
    button.addEventListener("click", () => selectSearchSuggestion(value));
    row.append(button);

    if (showingHistory) {
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "remove-search-history";
      remove.setAttribute("aria-label", message("deleteSearchHistory", value));
      remove.title = message("deleteSearchHistory", value);
      remove.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7 7 17"></path></svg>';
      remove.addEventListener("click", (event) => {
        event.stopPropagation();
        removeSearchHistory(value);
      });
      row.append(remove);
    }
    return row;
  });
  searchSuggestionList.replaceChildren(...rows);
  activeSearchSuggestion = -1;
  searchInput.removeAttribute("aria-activedescendant");
  searchSuggestions.hidden = false;
  searchInput.setAttribute("aria-expanded", "true");
}

function setActiveSearchSuggestion(index) {
  const options = [...searchSuggestionList.querySelectorAll("[role='option']")];
  activeSearchSuggestion = index;
  options.forEach((option, optionIndex) => {
    option.setAttribute("aria-selected", String(optionIndex === index));
  });
  const activeOption = options[index];
  if (!activeOption) return;
  searchInput.setAttribute("aria-activedescendant", activeOption.id);
  activeOption.scrollIntoView({ block: "nearest" });
}

function hideSearchSuggestions() {
  searchSuggestions.hidden = true;
  searchInput.setAttribute("aria-expanded", "false");
  searchInput.removeAttribute("aria-activedescendant");
  activeSearchSuggestion = -1;
}

function selectSearchSuggestion(value) {
  searchInput.value = value;
  searchQuery = normalizeSearchText(value);
  rememberSearch(value);
  applyFilters();
  searchInput.focus();
  hideSearchSuggestions();
}

function rememberSearch(value) {
  const query = String(value || "").trim();
  if (!query) return;
  const normalized = normalizeSearchText(query);
  searchHistory = [query, ...searchHistory.filter((entry) => normalizeSearchText(entry) !== normalized)]
    .slice(0, SEARCH_SUGGESTION_LIMIT);
  saveSearchHistory();
}

function removeSearchHistory(value) {
  const normalized = normalizeSearchText(value);
  searchHistory = searchHistory.filter((entry) => normalizeSearchText(entry) !== normalized);
  saveSearchHistory();
  searchInput.focus({ preventScroll: true });
}

function saveSearchHistory() {
  chrome.storage.local.set({ archiveSearchHistory: searchHistory }).catch(console.error);
}

function render(items, { reset = false } = {}) {
  summary.textContent = message("archiveSummary", [String(works.length), formatBytes(works.reduce((sum, work) => sum + (work.byteSize || 0), 0))]);
  renderTagFilters();
  scrollObserver.disconnect();
  thumbnailObserver.disconnect();
  // Return to the beginning before shrinking the grid and observing its footer again.
  if (reset && viewMode === "infinite") window.scrollTo({ top: 0, behavior: "instant" });
  grid.classList.toggle("infinite-grid", viewMode === "infinite");
  document.querySelectorAll("[data-view-mode]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.viewMode === viewMode));
  });
  renderedCount = viewMode === "infinite"
    ? Math.min(items.length, reset ? BATCH_SIZE : Math.max(BATCH_SIZE, renderedCount))
    : items.length;
  grid.replaceChildren(...items.slice(0, renderedCount).map(card));
  updateScrollFooter();
  if (!items.length) grid.textContent = works.length ? message("noMatchingArtworks") : message("noArchivedArtworks");
  updateSelectionControls();
}

function updateScrollFooter() {
  scrollFooter.hidden = viewMode !== "infinite" || visibleWorks.length === 0;
  const hasMore = renderedCount < visibleWorks.length;
  loadMoreButton.hidden = !hasMore;
  scrollStatus.textContent = hasMore
    ? message("showingArtworks", [String(renderedCount), String(visibleWorks.length)])
    : message("showingAllArtworks", String(visibleWorks.length));
  if (!scrollFooter.hidden && hasMore) scrollObserver.observe(loadMoreButton);
}

function appendNextBatch() {
  if (viewMode !== "infinite" || renderedCount >= visibleWorks.length) return;
  scrollObserver.disconnect();
  const nextCount = Math.min(renderedCount + BATCH_SIZE, visibleWorks.length);
  grid.append(...visibleWorks.slice(renderedCount, nextCount).map(card));
  renderedCount = nextCount;
  updateScrollFooter();
}

function renderTagFilters() {
  const allTags = popularTags();
  const tags = allTags.filter((tag) => !tag.hidden).slice(0, 20);
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
  favorite.textContent = message("favoritesFilter");
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
  scrollArea.addEventListener("scroll", () => updateTagScrollFade(scrollArea), { passive: true });
  const children = [favorite, scrollArea];
  const showAll = document.createElement("button");
  showAll.type = "button";
  showAll.className = "tag-reset show-all-tags";
  showAll.textContent = message("allTagsCount", String(allTags.length));
  showAll.addEventListener("click", () => {
    tagSearchQuery = "";
    tagSearchInput.value = "";
    renderTagList();
    tagDialog.showModal();
    tagSearchInput.focus();
  });
  children.push(showAll);
  if (activeTags.size > 0) {
    const reset = document.createElement("button");
    reset.type = "button";
    reset.className = "tag-reset";
    reset.textContent = message("resetTags");
    reset.addEventListener("click", () => {
      activeTags.clear();
      applyFilters();
    });
    children.push(reset);
  }
  tagFilters.replaceChildren(...children);
  updateTagScrollFade(scrollArea);
}

function updateTagScrollFade(scrollArea) {
  const maxScroll = Math.max(0, scrollArea.scrollWidth - scrollArea.clientWidth);
  scrollArea.classList.toggle("fade-left", scrollArea.scrollLeft > 1);
  scrollArea.classList.toggle("fade-right", scrollArea.scrollLeft < maxScroll - 1);
}

function renderTagList() {
  const allTags = popularTags();
  const tags = allTags
    .filter((tag) => !tagSearchQuery || tag.label.toLocaleLowerCase().includes(tagSearchQuery))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, uiLocale));
  const buttons = tags.map((tag) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "tag-list-item";
    button.setAttribute("aria-pressed", String(activeTags.has(tag.key)));

    const label = document.createElement("span");
    label.textContent = `#${tag.label}`;
    const count = document.createElement("span");
    count.className = "tag-list-count";
    count.textContent = String(tag.count);
    button.append(label, count);

    button.addEventListener("click", () => {
      activeTags.has(tag.key) ? activeTags.delete(tag.key) : activeTags.add(tag.key);
      applyFilters();
      renderTagList();
      tagList.querySelector(`[data-tag-key="${CSS.escape(tag.key)}"]`)?.focus();
    });
    button.dataset.tagKey = tag.key;
    return button;
  });
  tagList.replaceChildren(...buttons);
  noMatchingTags.hidden = tags.length > 0;
  tagDialogSummary.textContent = message("tagListSummary", [String(allTags.length), String(activeTags.size)]);
  document.querySelector("#clear-tag-selection").disabled = activeTags.size === 0;
}

function popularTags() {
  const counts = new Map();
  const workCount = works.length;
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
  return [...counts.values()].map((tag) => {
    const coverage = workCount ? tag.count / workCount : 0;
    return {
      ...tag,
      coverage,
      score: tag.count * Math.log((workCount + 1) / (tag.count + 1)),
      hidden: workCount >= COMMON_TAG_MIN_WORKS && coverage >= COMMON_TAG_COVERAGE_THRESHOLD
    };
  }).sort((a, b) => b.score - a.score
    || b.count - a.count
    || a.label.localeCompare(b.label, uiLocale));
}

function normalizeTag(tag) {
  return String(tag || "").trim().toLocaleLowerCase();
}

function card(work) {
  const article = document.querySelector("#work-card-template").content.firstElementChild.cloneNode(true);
  article.classList.toggle("metadata-only", work.imageCount === 0);
  article.setAttribute("aria-label", message("selectNamedArtwork", work.title));
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
  article.querySelector(".creator").textContent = work.creatorName || message("unknownArtist");
  article.querySelector(".meta").textContent = message("imageCountAndSize", [String(work.imageCount), formatBytes(work.byteSize)]);
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
  bindFavoriteButton(article.querySelector(".favorite-button"), work);
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
    openWorkViewer(work);
  });
  article.querySelector("[data-delete]").addEventListener("click", async () => {
    if (!confirm(message("confirmDeleteArtwork", work.title))) return;
    await deleteWork(work.id);
    works = works.filter((item) => item.id !== work.id);
    selectedIds.delete(work.id);
    applyFilters();
  });
  article.querySelectorAll(".card-menu-items a, .card-menu-items button").forEach((item) => {
    item.addEventListener("click", () => article.querySelector(".card-menu").removeAttribute("open"));
  });
  article.work = work;
  article.title = `${work.title} — ${work.creatorName || message("unknownArtist")}`;
  if (viewMode === "infinite") thumbnailObserver.observe(article);
  else archiveViewer.loadThumbnail(article.querySelector(".thumb-content"), work);
  return article;
}

function getArchiveReturnFocus() {
  const favoriteFilter = document.querySelector(".favorite-filter");
  return favoriteFilter?.getClientRects().length ? favoriteFilter : searchInput;
}

function createFavoriteButton(work) {
  const button = document.querySelector("#work-card-template").content
    .querySelector(".favorite-button").cloneNode(true);
  bindFavoriteButton(button, work);
  return button;
}

function bindFavoriteButton(button, work) {
  button.dataset.workId = String(work.id);
  updateFavoriteButton(button, work);
  button.addEventListener("animationend", () => button.classList.remove("favorite-pop", "favorite-release"));
  button.addEventListener("click", async (event) => {
    event.stopPropagation();
    if (pendingFavorites.has(work.id)) return;
    const previous = work.favorite === true;
    work.favorite = !previous;
    pendingFavorites.add(work.id);
    syncFavoriteButtons(work);
    button.classList.remove("favorite-pop", "favorite-release");
    // Restart the feedback even when the same button is toggled quickly.
    void button.offsetWidth;
    button.classList.add(work.favorite ? "favorite-pop" : "favorite-release");
    try {
      await updateWorkMetadata(work.id, { favorite: work.favorite });
    } catch (error) {
      work.favorite = previous;
      button.classList.remove("favorite-pop", "favorite-release");
      alert(error.message);
      return;
    } finally {
      pendingFavorites.delete(work.id);
      syncFavoriteButtons(work);
    }
    if (favoriteOnly) applyFilters();
  });
}

function syncFavoriteButtons(work) {
  document.querySelectorAll(".favorite-button").forEach((button) => {
    if (button.dataset.workId === String(work.id)) updateFavoriteButton(button, work);
  });
}

function updateFavoriteButton(button, work) {
  const favorite = work.favorite === true;
  const label = favorite ? message("removeFavorite") : message("addFavorite");
  button.setAttribute("aria-pressed", String(favorite));
  button.setAttribute("aria-label", label);
  button.title = label;
  button.setAttribute("aria-disabled", String(pendingFavorites.has(work.id)));
}

function showFolderName(handle) {
  document.querySelector("#folder-name").textContent = handle
    ? message("archiveFolderNamed", handle.name)
    : message("archiveFolderNotSelected");
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
  deleteButton.textContent = count ? message("deleteCount", String(count)) : message("deleteSelected");

  document.querySelector("#select-visible").disabled = visibleWorks.length === 0
    || visibleWorks.every((work) => selectedIds.has(work.id));
}
