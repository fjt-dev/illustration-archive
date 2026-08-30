import { getImages } from "./db.js";
import { readArchiveImages } from "./folder.js";
import { formatBytes, formatDate, htmlToPlainText } from "./utils.js";

export function createArchiveViewer(dialog, content) {
  function openViewer() {
    if (!dialog.open) dialog.showModal();
    document.documentElement.classList.add("viewer-open");
  }

  dialog.addEventListener("close", () => {
    document.documentElement.classList.remove("viewer-open");
  });

  async function loadStoredImages(work) {
    const browserImages = await getImages(work.id);
    return browserImages.length ? browserImages : readArchiveImages(work);
  }

  async function loadThumbnail(node, work) {
    if (work.imageCount === 0) {
      node.textContent = "画像なし";
      return;
    }
    let image;
    try {
      [image] = await loadStoredImages(work);
    } catch {
      node.textContent = "画像を読み込めません";
      return;
    }
    if (!image) return;

    const url = URL.createObjectURL(image.blob);
    const thumbnail = new Image();
    thumbnail.src = url;
    thumbnail.onload = () => URL.revokeObjectURL(url);
    thumbnail.onerror = () => URL.revokeObjectURL(url);
    node.replaceChildren(thumbnail);
  }

  async function showImages(work) {
    content.textContent = "読み込み中…";
    openViewer();

    let images = [];
    if (work.imageCount > 0) {
      try { images = await loadStoredImages(work); }
      catch { /* Show search assistance when the recorded image is unavailable. */ }
    }
    const heading = createViewerHeading(work);
    if (!images.length) {
      content.replaceChildren(heading, createRecoveryPanel(work));
      return;
    }

    const imageNodes = images.map((image) => {
      const node = new Image();
      const url = URL.createObjectURL(image.blob);
      node.src = url;
      node.onload = () => URL.revokeObjectURL(url);
      node.onerror = () => URL.revokeObjectURL(url);
      return node;
    });
    content.replaceChildren(heading, ...imageNodes);
  }

  function createViewerHeading(work) {
    const heading = document.createElement("div");
    heading.className = "viewer-heading";
    const title = document.createElement("h2");
    title.textContent = `${work.title} — ${work.creatorName || "作者不明"}`;
    const source = document.createElement("div");
    source.className = "viewer-source";
    const workId = document.createElement("span");
    workId.textContent = `ID: ${work.id}`;
    const sourceUrl = sourceUrlFor(work);
    source.append(workId);
    if (sourceUrl) source.append(externalLink(sourceUrl, sourceUrl));
    heading.append(title, source);
    return heading;
  }

  function createRecoveryPanel(work) {
    const panel = document.createElement("section");
    panel.className = "recovery-panel";
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
    const originalUrl = work.originalImageUrls?.[0];
    if (originalUrl) {
      actions.append(externalLink(
        "元画像URLを検索",
        `https://www.google.com/search?q=${encodeURIComponent(`"${originalUrl}"`)}`
      ));
    }
    panel.append(title, message, actions);
    return panel;
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
    const likelyPixivWork = sourceUrlFor(work).includes("pixiv.net") || /^\d+$/.test(String(work.id));
    return [work.id, work.title, work.creatorName, ...(work.originalImageFileNames || []), likelyPixivWork ? "pixiv" : ""]
      .filter(Boolean)
      .join(" ");
  }

  function showMetadata(work) {
    const title = document.createElement("h2");
    title.textContent = "記録メタデータ";
    const fields = [
      ["作品ID", work.id],
      ["タイトル", work.title],
      ["作者", work.creatorName || "不明"],
      ["作者ID", work.creatorId || "不明"],
      ["タグ", work.tags?.length ? work.tags.join(" / ") : "なし"],
      ["説明", htmlToPlainText(work.description) || "なし"],
      ["投稿日", formatDate(work.postedAt)],
      ["記録日時", formatDate(work.archivedAt)],
      ["ページ数", `${work.pageCount || work.imageCount || 0}ページ`],
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
    content.replaceChildren(title, list);
    openViewer();
  }

  return { loadThumbnail, showImages, showMetadata };
}
