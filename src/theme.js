const THEME_KEY = "appearanceTheme";
const media = matchMedia("(prefers-color-scheme: dark)");

export async function initTheme(button) {
  const { [THEME_KEY]: saved = "system" } = await chrome.storage.local.get(THEME_KEY);
  applyTheme(saved, button);
  media.addEventListener("change", () => {
    if (!document.documentElement.dataset.theme) updateButton(button);
  });
}

export async function toggleTheme(button) {
  const current = effectiveTheme();
  const next = current === "dark" ? "light" : "dark";
  await chrome.storage.local.set({ [THEME_KEY]: next });
  applyTheme(next, button);
}

function applyTheme(theme, button) {
  if (theme === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
  updateButton(button);
}

function effectiveTheme() {
  return document.documentElement.dataset.theme || (media.matches ? "dark" : "light");
}

function updateButton(button) {
  if (!button) return;
  const dark = effectiveTheme() === "dark";
  button.textContent = dark ? "🌙" : "☀️";
  button.title = dark ? "ライトモードに切り替える" : "ダークモードに切り替える";
  button.setAttribute("aria-label", dark ? "ライトモードに切り替える" : "ダークモードに切り替える");
}
