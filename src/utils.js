import { catalogLocale, message } from "./i18n.js";

export function formatBytes(value = 0) {
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} MB`;
  return `${(value / 1024 ** 3).toFixed(2)} GB`;
}

export function formatDate(value) {
  if (!value) return message("unknown");
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString(catalogLocale());
}

export function htmlToPlainText(value = "") {
  const document = new DOMParser().parseFromString(value, "text/html");
  return document.body.textContent?.trim() || "";
}
