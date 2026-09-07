export function message(key, substitutions) {
  return chrome.i18n.getMessage(key, substitutions) || key;
}

export function localizeDocument(root = document) {
  if (root.documentElement) root.documentElement.lang = chrome.i18n.getUILanguage().split("-")[0];
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
