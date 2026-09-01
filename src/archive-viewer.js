import { getImage } from "./db.js";
import { readArchiveImage } from "./folder.js";
import { formatBytes, formatDate, htmlToPlainText } from "./utils.js";

export function createArchiveViewer(panel, content, metadataDialog, metadataContent, fullscreenToggle) {
  let activeObjectUrl = "";
  let renderToken = 0;
  let previousFocus = null;

  function setFullscreen(fullscreen) {
    panel.classList.toggle("fullscreen", fullscreen);
    if (!fullscreenToggle) return;
    fullscreenToggle.setAttribute("aria-pressed", String(fullscreen));
    fullscreenToggle.setAttribute("aria-label", fullscreen ? "ドッキング表示に戻す" : "全画面表示にする");
  }

  fullscreenToggle?.addEventListener("click", () => setFullscreen(!panel.classList.contains("fullscreen")));

  function openViewer(fullscreen = false) {
    const wasHidden = panel.hidden;
    previousFocus = wasHidden ? document.activeElement : previousFocus;
    panel.hidden = false;
    setFullscreen(fullscreen);
    document.documentElement.classList.add("viewer-open");
    if (wasHidden) requestAnimationFrame(() => panel.querySelector("#close")?.focus());
  }

  function closeViewer() {
    renderToken += 1;
    releaseObjectUrl();
    panel.hidden = true;
    setFullscreen(false);
    content.replaceChildren();
    document.documentElement.classList.remove("viewer-open");
    if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    previousFocus = null;
  }

  async function loadStoredImage(work, index = 0) {
    return await getImage(work.id, index) || readArchiveImage(work, index);
  }

  async function loadThumbnail(node, work) {
    if (work.imageCount === 0) {
      node.textContent = "画像なし";
      return;
    }
    let image;
    try { image = await loadStoredImage(work, 0); }
    catch {
      node.textContent = "画像を読み込めません";
      return;
    }
    if (!image) return;
    const url = URL.createObjectURL(image.blob);
    const thumbnail = new Image();
    thumbnail.alt = "";
    thumbnail.src = url;
    thumbnail.onload = () => URL.revokeObjectURL(url);
    thumbnail.onerror = () => URL.revokeObjectURL(url);
    node.replaceChildren(thumbnail);
  }

  async function showImages(work, { fullscreen = false } = {}) {
    const token = ++renderToken;
    releaseObjectUrl();
    openViewer(fullscreen);
    const heading = createViewerHeading(work);
    if (work.imageCount === 0) {
      content.replaceChildren(heading, createRecoveryPanel(work));
      return;
    }

    const stage = document.createElement("div");
    stage.className = "viewer-stage";
    stage.textContent = "読み込み中…";
    const controls = createPageControls(work.imageCount);
    content.replaceChildren(heading, stage, controls.root);

    const renderPage = async (index) => {
      controls.setLoading(true);
      stage.textContent = "読み込み中…";
      releaseObjectUrl();
      try {
        const image = await loadStoredImage(work, index);
        if (token !== renderToken) return;
        if (!image) throw new Error("画像を読み込めません");
        activeObjectUrl = URL.createObjectURL(image.blob);
        const node = new Image();
        node.alt = `${work.title} ${index + 1}ページ目`;
        node.src = activeObjectUrl;
        stage.replaceChildren(node);
        controls.setIndex(index);
      } catch {
        if (token !== renderToken) return;
        stage.replaceChildren(createRecoveryPanel(work));
      } finally {
        if (token === renderToken) controls.setLoading(false);
      }
    };

    controls.previous.addEventListener("click", () => renderPage(controls.index - 1));
    controls.next.addEventListener("click", () => renderPage(controls.index + 1));
    await renderPage(0);
  }

  function createPageControls(count) {
    const root = document.createElement("div");
    root.className = "viewer-controls";
    const previous = document.createElement("button");
    previous.type = "button";
    previous.textContent = "← 前へ";
    const status = document.createElement("span");
    const next = document.createElement("button");
    next.type = "button";
    next.textContent = "次へ →";
    const state = {
      root, previous, next, index: 0,
      setIndex(index) {
        state.index = index;
        status.textContent = `${index + 1} / ${count}`;
        previous.disabled = index <= 0;
        next.disabled = index >= count - 1;
      },
      setLoading(loading) {
        previous.disabled = loading || state.index <= 0;
        next.disabled = loading || state.index >= count - 1;
      }
    };
    state.setIndex(0);
    root.append(previous, status, next);
    return state;
  }

  function createViewerHeading(work) {
    const heading = document.createElement("div");
    heading.className = "viewer-heading";
    const title = document.createElement("h2");
    title.textContent = work.title;
    const creator = document.createElement("p");
    creator.className = "viewer-creator";
    creator.textContent = work.creatorName || "作者不明";
    const source = document.createElement("div");
    source.className = "viewer-source";
    const workId = document.createElement("span");
    workId.textContent = `ID: ${work.id}`;
    source.append(workId);
    const sourceUrl = sourceUrlFor(work);
    if (sourceUrl) source.append(externalLink("作品ページを開く", sourceUrl));
    heading.append(title, creator, source);
    return heading;
  }

  function createRecoveryPanel(work) {
    const recovery = document.createElement("section");
    recovery.className = "recovery-panel";
    const title = document.createElement("h3");
    title.textContent = "元画像を探す";
    const message = document.createElement("p");
    message.textContent = work.imageCount > 0
      ? "記録した画像を読み込めませんでした。作品情報を使って公開元や関連ページを検索できます。"
      : "画像は記録されていません。記録した作品情報を使って元画像を検索できます。";
    const actions = document.createElement("div");
    actions.className = "recovery-actions";
    const sourceUrl = sourceUrlFor(work);
    const query = searchQueryFor(work);
    if (sourceUrl) actions.append(externalLink("元作品ページを開く", sourceUrl));
    actions.append(
      externalLink("Googleで検索", `https://www.google.com/search?q=${encodeURIComponent(query)}`),
      externalLink("Google画像検索", `https://www.google.com/search?tbm=isch&q=${encodeURIComponent(query)}`)
    );
    recovery.append(title, message, actions);
    return recovery;
  }

  function externalLink(label, href) {
    const link = document.createElement("a");
    link.href = href;
    link.target = "_blank";
    link.rel = "noreferrer";
    link.textContent = label;
    return link;
  }

  function sourceUrlFor(work) {
    if (work.sourceUrl) return work.sourceUrl;
    return /^\d+$/.test(String(work.id)) ? `https://www.pixiv.net/artworks/${work.id}` : "";
  }

  function searchQueryFor(work) {
    return [work.id, work.title, work.creatorName, ...(work.originalImageFileNames || [])]
      .filter(Boolean)
      .join(" ");
  }

  function showMetadata(work) {
    const title = document.createElement("h2");
    title.textContent = "記録メタデータ";
    const fields = [
      ["作品ID", work.id], ["タイトル", work.title], ["作者", work.creatorName || "不明"],
      ["作者ID", work.creatorId || "不明"], ["タグ", work.tags?.length ? work.tags.join(" / ") : "なし"],
      ["説明", htmlToPlainText(work.description) || "なし"], ["投稿日", formatDate(work.postedAt)],
      ["記録日時", formatDate(work.archivedAt)], ["ページ数", `${work.pageCount || work.imageCount || 0}ページ`],
      ["記録内容", work.imageCount > 0 ? "メタデータと画像" : "メタデータのみ"],
      ["記録容量", formatBytes(work.byteSize)],
      ["元画像ファイル名", work.originalImageFileNames?.join(" / ") || "記録なし"],
      ["元URL", work.sourceUrl || "なし"]
    ];
    const list = document.createElement("dl");
    list.className = "metadata-list";
    fields.forEach(([label, value]) => {
      const term = document.createElement("dt");
      const description = document.createElement("dd");
      term.textContent = label;
      description.textContent = String(value ?? "");
      list.append(term, description);
    });
    metadataContent.replaceChildren(title, list);
    metadataDialog.showModal();
  }

  function releaseObjectUrl() {
    if (!activeObjectUrl) return;
    URL.revokeObjectURL(activeObjectUrl);
    activeObjectUrl = "";
  }

  return { close: closeViewer, loadThumbnail, showImages, showMetadata };
}
