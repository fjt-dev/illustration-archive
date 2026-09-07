export function message(key, substitutions) {
  return chrome.i18n.getMessage(key, substitutions) || key;
}

export function catalogLocale(uiLanguage = chrome.i18n.getUILanguage()) {
  return String(uiLanguage).toLowerCase().split(/[-_]/)[0] === "ja" ? "ja" : "en";
}

export function localizeDocument(root = document) {
  if (root.documentElement) root.documentElement.lang = catalogLocale();
  root.querySelectorAll("[data-i18n]").forEach((node) => {
    node.textContent = message(node.dataset.i18n);
  });
  root.querySelectorAll("[data-i18n-attrs]").forEach((node) => {
    node.dataset.i18nAttrs.split(",").forEach((entry) => {
      const [attribute, key] = entry.split(":");
      node.setAttribute(attribute.trim(), message(key.trim()));
    });
  });
  root.querySelectorAll("template").forEach((template) => localizeDocument(template.content));
}
