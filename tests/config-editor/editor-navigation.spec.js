import { expect, test } from "@playwright/test";
import {
  capturePageErrors,
  openEditorNavigation,
  openEditorWorkspace,
  switchEditorMode
} from "./editor-test-support.js";

const resourcePoints = [
  "custom: {}",
  "custom-items:",
  "  sample:",
  "    name: Sample",
  "    material: STONE",
  "    resource-points: 1",
  ""
].join("\n");

test("navigation works as an accessible drawer and desktop sidebar", async ({ page }) => {
  const pageErrors = capturePageErrors(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await openEditorWorkspace(page, [
    {
      name: "resource-points.yml",
      mimeType: "text/yaml",
      buffer: Buffer.from(resourcePoints)
    },
    {
      name: "turrets.yml",
      mimeType: "text/yaml",
      buffer: Buffer.from("effects: {}\n")
    }
  ]);

  const toggle = page.locator("[data-toggle-editor-navigation]");
  const navigation = page.locator("[data-editor-navigation]");
  const tabs = page.locator("[data-editor-navigation-tabs]");
  const filesTab = page.locator('[data-editor-navigation-tab="files"]');
  const sectionsTab = page.locator('[data-editor-navigation-tab="sections"]');
  const filesPanel = page.locator("[data-workspace-files-panel]");
  const sectionsPanel = page.locator("[data-editor-sidebar]");

  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(navigation).toHaveAttribute("inert", "");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(navigation).toHaveAttribute("role", "dialog");
  await expect(navigation).toHaveAttribute("aria-modal", "true");
  await expect(navigation).toBeInViewport();
  await expect(page.locator("[data-close-editor-navigation]")).toBeFocused();

  await expect(tabs).toHaveAttribute("role", "tablist");
  await expect(sectionsTab).toHaveAttribute("aria-selected", "true");
  await expect(sectionsTab).toHaveAttribute("tabindex", "0");
  await expect(filesTab).toHaveAttribute("aria-selected", "false");
  await expect(filesTab).toHaveAttribute("tabindex", "-1");
  await expect(sectionsPanel).toHaveAttribute("role", "tabpanel");
  await expect(sectionsPanel).toHaveAttribute("aria-labelledby", "editor-navigation-sections-tab");
  await expect(sectionsPanel).toBeVisible();
  await expect(filesPanel).toBeHidden();

  await sectionsTab.focus();
  await page.keyboard.press("ArrowLeft");
  await expect(filesTab).toBeFocused();
  await expect(filesTab).toHaveAttribute("aria-selected", "true");
  await expect(filesPanel).toBeVisible();
  await expect(sectionsPanel).toBeHidden();
  await page.keyboard.press("ArrowRight");
  await expect(sectionsTab).toBeFocused();
  await expect(sectionsTab).toHaveAttribute("aria-selected", "true");

  await page.keyboard.press("Escape");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(navigation).toHaveAttribute("inert", "");
  await expect(toggle).toBeFocused();

  await openEditorNavigation(page, { panel: "files" });
  await page.locator('[data-workspace-file="turrets.yml"]').click();
  await expect(page.locator("[data-current-file]")).toHaveText("turrets.yml");
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(sectionsPanel).toBeVisible();

  await page.locator("[data-editor-section-key]").filter({ hasText: /^Effects\d*$/ }).click();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator("[data-current-section]")).toHaveText("Effects");
  await expect(page.locator("[data-current-section]")).toBeFocused();

  await switchEditorMode(page, "source");
  await expect(page.locator("[data-source-workspace]")).toBeVisible();
  await openEditorNavigation(page);
  await expect(navigation).toHaveAttribute("aria-modal", "true");
  await expect(tabs).toBeHidden();
  await expect(filesPanel).toBeVisible();
  await expect(sectionsPanel).toBeHidden();
  await page.keyboard.press("Escape");

  await switchEditorMode(page, "visual");
  await expect(page.locator("[data-visual-workspace]")).toBeVisible();
  await page.setViewportSize({ width: 1200, height: 800 });
  await expect(toggle).toBeHidden();
  await expect(navigation).toHaveAttribute("role", "navigation");
  await expect(navigation).toHaveAttribute("aria-hidden", "false");
  await expect(navigation).not.toHaveAttribute("inert", "");
  await expect(tabs).toBeHidden();
  await expect(filesPanel).toBeVisible();
  await expect(sectionsPanel).toBeVisible();
  expect(pageErrors).toEqual([]);
});

test("mobile sidebar controls remain usable for a single file and relocate on desktop", async ({ page }, testInfo) => {
  const pageErrors = capturePageErrors(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await openEditorWorkspace(page, [{
    name: "resource-points.yml",
    mimeType: "text/yaml",
    buffer: Buffer.from(resourcePoints)
  }]);

  const visualMode = page.locator('[data-editor-mode="visual"]');
  const sourceMode = page.locator('[data-editor-mode="source"]');
  const toggle = page.locator("[data-toggle-editor-navigation]");
  const navigation = page.locator("[data-editor-navigation]");
  const sidebarControls = page.locator("[data-editor-sidebar-controls]");
  const settingsButton = page.locator("[data-open-editor-settings]");
  const settingsDialog = page.locator("[data-editor-settings-dialog]");

  await expect(sidebarControls.locator("[data-editor-controls]")).toHaveCount(1);
  await expect(page.locator("[data-editor-header-controls] [data-editor-controls]")).toHaveCount(0);
  await openEditorNavigation(page);
  await expect(visualMode).toHaveText("Visual");
  await expect(sourceMode).toHaveText("Code");
  await page.screenshot({ path: testInfo.outputPath("mobile-sidebar-controls.png"), animations: "disabled" });

  await settingsButton.focus();
  await page.keyboard.press("Enter");
  await expect(settingsDialog).toBeVisible();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(settingsDialog.locator('[name="editor-input-font"]:checked')).toBeFocused();
  await settingsDialog.getByRole("button", { name: "Save settings" }).focus();
  await page.keyboard.press("Tab");
  await expect.poll(() => navigation.evaluate((drawer) => drawer.contains(document.activeElement))).toBe(false);
  // Native dialogs can visit browser chrome before wrapping to the first control
  await page.keyboard.press("Tab");
  await expect.poll(() => settingsDialog.evaluate((dialog) => dialog.contains(document.activeElement))).toBe(true);
  await page.keyboard.press("Escape");
  await expect(settingsDialog).toBeHidden();
  await expect(settingsButton).toBeFocused();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("Tab");
  await expect(page.locator("[data-close-editor-navigation]")).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(settingsButton).toBeFocused();

  await sourceMode.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("[data-source-workspace]")).toBeVisible();
  await expect(page.locator(".cm-content")).toBeFocused();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(toggle).toBeVisible();
  await openEditorNavigation(page);
  await visualMode.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("[data-visual-workspace]")).toBeVisible();
  await expect(page.locator("[data-current-section]")).toBeFocused();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");

  await page.setViewportSize({ width: 997, height: 844 });
  await expect(page.locator("[data-editor-header-controls] [data-editor-controls]")).toHaveCount(1);
  await expect(sidebarControls.locator("[data-editor-controls]")).toHaveCount(0);
  await expect(toggle).toBeHidden();
  await expect(settingsButton).toBeVisible();
  await sourceMode.click();
  await expect(page.locator(".cm-content")).toBeFocused();

  await page.setViewportSize({ width: 996, height: 844 });
  await expect(sidebarControls.locator("[data-editor-controls]")).toHaveCount(1);
  await expect(toggle).toBeVisible();
  await openEditorNavigation(page);
  await expect(navigation).toHaveAttribute("role", "dialog");
  await visualMode.click();
  await expect(page.locator("[data-current-section]")).toBeFocused();
  await expect(page.locator("[data-editor-controls]")).toHaveCount(1);
  expect(pageErrors).toEqual([]);
});

test("mobile sidebar footer stays visible while files scroll", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 480 });
  await page.goto("/editor");
  await page.locator("[data-example]").click();
  await expect(page.locator("[data-editor-workspace]")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("mobile-toolbar.png"), animations: "disabled" });
  await openEditorNavigation(page, { panel: "files" });

  const footer = page.locator("[data-editor-sidebar-controls]");
  const files = page.locator("[data-workspace-files]");
  const before = await footer.boundingBox();
  expect(before.y + before.height).toBeLessThanOrEqual(480);
  expect(before.y + before.height).toBeGreaterThanOrEqual(478);
  await expect.poll(() => files.evaluate((list) => list.scrollHeight > list.clientHeight)).toBe(true);
  await files.locator("[data-workspace-file]").last().scrollIntoViewIfNeeded();
  await expect.poll(() => files.evaluate((list) => list.scrollTop)).toBeGreaterThan(0);
  const after = await footer.boundingBox();
  expect(after.y).toBeCloseTo(before.y, 1);
  expect(after.height).toBeCloseTo(before.height, 1);
  await expect(footer.locator('[data-editor-mode="visual"]')).toBeInViewport();
  await expect(footer.locator('[data-editor-mode="source"]')).toBeInViewport();
  await expect(footer.locator("[data-open-editor-settings]")).toBeInViewport();
  await page.screenshot({ path: testInfo.outputPath("mobile-sidebar-scrolled.png"), animations: "disabled" });
});
