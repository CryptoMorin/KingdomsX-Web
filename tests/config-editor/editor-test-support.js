import { expect } from "@playwright/test";

export function usesEditorNavigationDrawer(page) {
  return (page.viewportSize()?.width ?? 0) < 997;
}

export async function openEditorWorkspace(page, inputFiles) {
  await page.goto("/editor");
  await page.locator("[data-file-input]").setInputFiles(inputFiles);
  await page.locator("[data-editor-workspace]").waitFor({ state: "visible" });
}

export function capturePageErrors(page) {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));

  return errors;
}

export async function openEditorNavigation(page, { panel } = {}) {
  if (!usesEditorNavigationDrawer(page)) {
    return;
  }

  await page.locator("[data-editor-workspace]").waitFor({ state: "visible" });
  const toggle = page.locator("[data-toggle-editor-navigation]");
  await toggle.waitFor({ state: "visible" });

  if (await toggle.getAttribute("aria-expanded") !== "true") {
    await toggle.click();
  }

  if (panel) {
    await selectEditorNavigationPanel(page, panel);
  }
}

export async function switchEditorMode(page, mode) {
  await openEditorNavigation(page);
  await page.locator(`[data-editor-mode="${mode}"]`).click();
}

export async function openEditorSettings(page) {
  await openEditorNavigation(page);
  await page.locator("[data-open-editor-settings]").click();
}

export async function openWorkspaceFile(page, path) {
  const button = page.locator(`[data-workspace-file="${path}"]`);

  if (
    await page.locator("[data-current-file]").textContent() === path
    && await button.getAttribute("aria-current") === "page"
  ) {
    return;
  }

  await waitForFileTransition(page);
  await openEditorNavigation(page, { panel: "files" });
  await button.click();
  await expect(page.locator("[data-current-file]")).toHaveText(path);
  await waitForFileTransition(page);
}

export async function openEditorSection(page, label) {
  await waitForSectionTransition(page);
  await openEditorNavigation(page, { panel: "sections" });
  await page.locator("[data-editor-section-key]").filter({ hasText: label }).click();
  await waitForSectionTransition(page);
}

async function selectEditorNavigationPanel(page, panel) {
  const tab = page.locator(`[data-editor-navigation-tab="${panel}"]`);

  if (await tab.getAttribute("aria-selected") !== "true") {
    await tab.click();
  }
}

async function waitForFileTransition(page) {
  const content = page.locator("[data-editor-file-content]");
  await expect.poll(() => content.evaluate((element) =>
    !element.style.opacity && !element.inert && element.getAttribute("aria-busy") !== "true"
  )).toBe(true);
}

async function waitForSectionTransition(page) {
  const content = page.locator("[data-editor-section-content]");
  await expect.poll(() => content.evaluate((element) =>
    !element.style.opacity && !element.inert
  )).toBe(true);
}
