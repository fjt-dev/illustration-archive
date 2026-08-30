const THEME_KEY = "appearanceTheme";
const THEMES = new Set(["light", "dark", "system"]);
const media = matchMedia("(prefers-color-scheme: dark)");

export async function initTheme(button) {
  const { [THEME_KEY]: saved = "system" } = await chrome.storage.local.get(THEME_KEY);
  const theme = THEMES.has(saved) ? saved : "system";
  applyTheme(theme, button);
  media.addEventListener("change", () => {
    if (!document.documentElement.dataset.theme) updateButton(button, "system");
  });
  return theme;
}

export async function setTheme(theme, button) {
  if (!THEMES.has(theme)) throw new Error("未対応のテーマです");
  await chrome.storage.local.set({ [THEME_KEY]: theme });
  applyTheme(theme, button);
  return theme;
}

function applyTheme(theme, button) {
  if (theme === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
  updateButton(button, theme);
}

function effectiveTheme() {
  return document.documentElement.dataset.theme || (media.matches ? "dark" : "light");
}

function updateButton(button, selectedTheme = "system") {
  if (!button) return;
  if (button.querySelector("[data-theme-current-icon]")) {
    const labels = {
      light: "ライトモード",
      dark: "ダークモード",
      system: "デバイスのデフォルト"
    };
    button.dataset.selectedTheme = selectedTheme;
    button.title = `表示: ${labels[selectedTheme]}`;
    button.setAttribute("aria-label", `表示テーマ: ${labels[selectedTheme]}`);
    return;
  }
  const dark = effectiveTheme() === "dark";
  button.textContent = dark ? "🌙" : "☀️";
  button.title = dark ? "ライトモードに切り替える" : "ダークモードに切り替える";
  button.setAttribute("aria-label", dark ? "ライトモードに切り替える" : "ダークモードに切り替える");
}
