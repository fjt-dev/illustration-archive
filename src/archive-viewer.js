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

  async function loadImages(work) {
    const browserImages = await getImages(work.id);
    return browserImages.length ? browserImages : readArchiveImages(work);
  }

  async function loadThumbnail(node, work) {
    if (work.imageCount === 0) {
      node.textContent = "メタデータのみ";
      return;
    }
    let image;
    try {
      [image] = await loadImages(work);
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
    if (work.imageCount === 0) {
      content.textContent = "この記録に画像は含まれていません。";
      openViewer();
      return;
    }
    content.textContent = "読み込み中…";
    openViewer();

    let images;
    try {
      images = await loadImages(work);
    } catch (error) {
      content.textContent = error.message;
      return;
    }

    const heading = document.createElement("div");
    heading.className = "viewer-heading";
    const title = document.createElement("h2");
    title.textContent = `${work.title} — ${work.creatorName || "作者不明"}`;
    const source = document.createElement("div");
    source.className = "viewer-source";
    const workId = document.createElement("span");
    workId.textContent = `ID: ${work.id}`;
    const sourceUrl = work.sourceUrl || `https://www.pixiv.net/artworks/${work.id}`;
    const sourceLink = document.createElement("a");
    sourceLink.href = sourceUrl;
    sourceLink.target = "_blank";
    sourceLink.rel = "noreferrer";
    sourceLink.textContent = sourceUrl;
    source.append(workId, sourceLink);
    heading.append(title, source);
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
