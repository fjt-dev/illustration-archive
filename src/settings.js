const AUTO_SAVE_CONSENT_VERSION = 1;
const IMAGE_RECORDING_CONSENT_VERSION = 1;
const USAGE_CONSENT_VERSION = 1;

const KEYS = {
  autoSaveEnabled: "autoSaveEnabled",
  autoSaveConsentVersion: "autoSaveConsentVersion",
  autoSaveConsentedAt: "autoSaveConsentedAt",
  usageConsentVersion: "usageConsentVersion",
  usageConsentedAt: "usageConsentedAt",
  onboardingCompleted: "onboardingCompleted",
  includeImages: "includeImages",
  imageRecordingConsentVersion: "imageRecordingConsentVersion",
  imageRecordingConsentedAt: "imageRecordingConsentedAt"
};

export async function shouldIncludeImages() {
  const settings = await chrome.storage.local.get([
    KEYS.includeImages,
    KEYS.imageRecordingConsentVersion
  ]);
  return settings.includeImages === true
    && settings.imageRecordingConsentVersion === IMAGE_RECORDING_CONSENT_VERSION;
}

export async function enableImageRecording() {
  await chrome.storage.local.set({
    [KEYS.includeImages]: true,
    [KEYS.imageRecordingConsentVersion]: IMAGE_RECORDING_CONSENT_VERSION,
    [KEYS.imageRecordingConsentedAt]: new Date().toISOString()
  });
}

export async function disableImageRecording() {
  await chrome.storage.local.set({ [KEYS.includeImages]: false });
}

export function onIncludeImagesChanged(callback) {
  const listener = (changes, area) => {
    if (area !== "local" || !changes[KEYS.includeImages]) return;
    shouldIncludeImages().then(callback);
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}

export async function isAutoSaveEnabled() {
  const settings = await chrome.storage.local.get([
    KEYS.autoSaveEnabled,
    KEYS.autoSaveConsentVersion
  ]);
  return settings.autoSaveEnabled === true
    && settings.autoSaveConsentVersion === AUTO_SAVE_CONSENT_VERSION;
}

export async function enableAutoSave() {
  await chrome.storage.local.set({
    [KEYS.autoSaveEnabled]: true,
    [KEYS.autoSaveConsentVersion]: AUTO_SAVE_CONSENT_VERSION,
    [KEYS.autoSaveConsentedAt]: new Date().toISOString()
  });
}

export async function disableAutoSave() {
  await chrome.storage.local.set({ [KEYS.autoSaveEnabled]: false });
}

export function onAutoSaveChanged(callback) {
  const listener = (changes, area) => {
    if (area !== "local" || !changes[KEYS.autoSaveEnabled]) return;
    isAutoSaveEnabled().then(callback);
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}

export async function hasUsageConsent() {
  const settings = await chrome.storage.local.get(KEYS.usageConsentVersion);
  return settings.usageConsentVersion === USAGE_CONSENT_VERSION;
}

export async function recordUsageConsent() {
  await chrome.storage.local.set({
    [KEYS.usageConsentVersion]: USAGE_CONSENT_VERSION,
    [KEYS.usageConsentedAt]: new Date().toISOString()
  });
}

export async function getFirstRunState() {
  const settings = await chrome.storage.local.get([
    KEYS.usageConsentVersion,
    KEYS.onboardingCompleted
  ]);
  return {
    hasUsageConsent: settings.usageConsentVersion === USAGE_CONSENT_VERSION,
    onboardingCompleted: settings.onboardingCompleted === true
  };
}

export async function completeOnboarding() {
  await chrome.storage.local.set({ [KEYS.onboardingCompleted]: true });
}
