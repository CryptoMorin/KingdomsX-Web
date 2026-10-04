import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { strFromU8, unzipSync, zipSync } from "fflate";
import {
  deriveRemoteEditorSecrets,
  encryptRemotePayload,
  REMOTE_PAYLOAD_KIND,
  sha256Hex
} from "../../src/assets/scripts/config-editor/remote-session-crypto.js";
import {
  capturePageErrors,
  openEditorSection,
  openEditorSettings,
  openWorkspaceFile,
  switchEditorMode
} from "./editor-test-support.js";

const linkSeed = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8";

async function mockRemoteWorkspace(context, { now = Date.now(), files = { "config.yml": "enabled: true\n" } } = {}) {
  const { id: sessionId, key } = await deriveRemoteEditorSecrets(linkSeed);
  const sources = Object.fromEntries(Object.entries(files).map(([path, source]) => [path, new TextEncoder().encode(source)]));
  const manifest = new TextEncoder().encode(JSON.stringify({
    protocol: 1,
    pluginVersion: "1.17.27.1",
    files: await Promise.all(Object.entries(sources).map(async ([path, source]) => ({ path, sha256: await sha256Hex(source) }))),
    capabilities: {
      schematicDirectories: [],
      outpostPageDirectories: []
    }
  }));
  const archive = zipSync({
    ...sources,
    "kingdomsx-editor.json": manifest
  });
  const encrypted = await encryptRemotePayload(archive, {
    sessionId,
    key,
    kind: REMOTE_PAYLOAD_KIND.original,
    revision: 0
  });
  const expiresAt = now + 60 * 60 * 1_000;
  const snapshot = {
    type: "session",
    protocol: 1,
    sequence: 2,
    state: "ready",
    resultRevision: 0,
    expiresAt
  };

  const mutations = [];
  await context.route(`**/api/editor/v1/sessions/${sessionId}**`, async (route) => {
    if (route.request().method() !== "GET") {
      mutations.push(route.request().url());
    }

    if (route.request().url().endsWith("/payloads/original")) {
      await route.fulfill({
        status: 200,
        contentType: "application/octet-stream",
        body: Buffer.from(encrypted)
      });
      return;
    }

    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(snapshot) });
  });

  return { expiresAt, link: `/editor#s/v1/${linkSeed}`, mutations };
}

async function editCode(page, source) {
  await switchEditorMode(page, "source");
  await page.locator("[data-source-editor] .cm-content").click();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.insertText(source);
}

async function downloadRecovery(page, button) {
  if (!button) {
    await page.locator("[data-editor-save-menu-toggle]").click();
    button = page.locator(".dropdown-menu [data-download-recovery]");
  }

  const downloadPromise = page.waitForEvent("download");
  await button.click();
  const download = await downloadPromise;

  return unzipSync(await readFile(await download.path()));
}

async function persistedDrafts(page) {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open("kingdomsx-editor");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const records = database.transaction("remote-drafts", "readonly").objectStore("remote-drafts").getAll();
      records.onerror = () => reject(records.error);
      records.onsuccess = () => {
        database.close();
        resolve(records.result);
      };
    };
  }));
}

test("restores an encrypted Code mode draft after the console link is reopened", async ({ context, page }) => {
  const { link } = await mockRemoteWorkspace(context);
  const firstPageErrors = capturePageErrors(page);
  await page.goto(link);
  await page.locator("[data-editor-workspace]").waitFor({ state: "visible" });
  await switchEditorMode(page, "source");
  const code = page.locator("[data-source-editor] .cm-content");
  await code.click();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.insertText("enabled: false\n");
  await expect(page.locator("[data-source-status]")).toContainText("apply when");
  await page.waitForTimeout(1_000);
  expect(firstPageErrors).toEqual([]);
  await page.close();

  const restoredPage = await context.newPage();
  const restoredPageErrors = capturePageErrors(restoredPage);
  await restoredPage.goto(link);
  const recoveryDialog = restoredPage.locator("[data-editor-confirmation-dialog]");
  await expect(recoveryDialog).toBeVisible();
  await expect(recoveryDialog).toHaveAttribute("aria-labelledby", "editor-confirmation-title");
  await expect(recoveryDialog).toHaveAttribute("aria-describedby", "editor-confirmation-message");
  await expect(recoveryDialog.locator("[data-editor-confirmation-title]")).toHaveText("Restore unsaved changes?");
  await expect(recoveryDialog.locator("[data-editor-confirmation-message]")).toContainText("Unsaved changes from");
  await expect(recoveryDialog.locator("[data-editor-confirmation-confirm]")).toBeFocused();

  const cancelButton = recoveryDialog.locator("[data-editor-confirmation-cancel]");
  const confirmButton = recoveryDialog.locator("[data-editor-confirmation-confirm]");
  const cancelBox = await cancelButton.boundingBox();
  const confirmBox = await confirmButton.boundingBox();

  expect(confirmBox.x).toBeGreaterThan(cancelBox.x + cancelBox.width);

  await restoredPage.setViewportSize({ width: 260, height: 844 });

  const wrappedCancelBox = await cancelButton.boundingBox();
  const wrappedConfirmBox = await confirmButton.boundingBox();

  expect(wrappedConfirmBox.y).toBeGreaterThanOrEqual(wrappedCancelBox.y + wrappedCancelBox.height);

  await recoveryDialog.locator("[data-editor-confirmation-confirm]").click();
  await restoredPage.locator("[data-editor-workspace]").waitFor({ state: "visible" });

  await expect(restoredPage.locator("[data-editor-mode-switch]")).toHaveAttribute("data-editor-mode-current", "source");
  await expect(restoredPage.locator("[data-source-editor] .cm-content")).toHaveText("enabled: false");
  await expect(restoredPage.locator("[data-source-status]")).toContainText("apply when");
  expect(restoredPageErrors).toEqual([]);
});

test("warns before session expiry and downloads work without saving it to the server", async ({ context, page }, testInfo) => {
  const now = Date.UTC(2026, 9, 4, 12);
  await page.clock.setFixedTime(now);
  const { expiresAt, link, mutations } = await mockRemoteWorkspace(context, { now });
  const pageErrors = capturePageErrors(page);
  await page.goto(link);
  await expect(page.locator("[data-editor-workspace]")).toBeVisible();
  const timer = page.locator("[data-editor-session-time]:visible");
  const save = page.locator(".editor-header-actions [data-save-workspace]");
  await expect(timer).toContainText("60:00");
  await expect(save).toBeDisabled();
  const menuToggle = page.locator("[data-editor-save-menu-toggle]");
  const menuBackup = page.locator(".dropdown-menu [data-download-recovery]");
  await expect(menuToggle).toBeEnabled();
  await menuToggle.focus();
  await page.keyboard.press("ArrowDown");
  await expect(menuToggle).toHaveAttribute("aria-expanded", "true");
  await expect(menuBackup).toBeFocused();
  await page.screenshot({ path: testInfo.outputPath("desktop-backup-menu.png"), animations: "disabled" });
  await page.keyboard.press("Escape");
  await expect(menuToggle).toHaveAttribute("aria-expanded", "false");
  await expect(menuToggle).toBeFocused();

  const cleanBackup = await downloadRecovery(page);
  expect(strFromU8(cleanBackup["configs/config.yml"])).toBe("enabled: true\n");
  await expect(save).toBeDisabled();

  await editCode(page, "enabled: false\n");
  await switchEditorMode(page, "visual");
  await expect(save).toBeEnabled();
  const backup = await downloadRecovery(page);
  expect(strFromU8(backup["configs/config.yml"])).toBe("enabled: false\n");
  await expect(save).toBeEnabled();

  for (const minutes of [10, 5, 1]) {
    await page.clock.setFixedTime(expiresAt - minutes * 60_000);
    await expect(timer).toContainText(`${minutes}:00`);
    await expect(page.locator(".toast-body").filter({ hasText: new RegExp(`\\b${minutes} minute`) })).toBeVisible();
    await expect(save).toBeEnabled();
  }

  await page.clock.setFixedTime(expiresAt);
  const expiredDialog = page.locator("[data-editor-session-expired-dialog]");
  await expect(expiredDialog).toBeVisible();
  await expect(expiredDialog.locator("[data-download-recovery]")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(expiredDialog).toBeHidden();
  await expect(save).toHaveAccessibleName(/download backup/i);
  await expect(save).toBeEnabled();
  await expect(save).toBeFocused();

  await page.locator("[data-preview-yaml]").click();
  const reviewDialog = page.locator("[data-preview-dialog]");
  await expect(reviewDialog).toBeVisible();
  await expect(reviewDialog.locator("[data-save-workspace]")).toBeDisabled();
  await reviewDialog.locator("[data-close-preview]").first().click();
  await page.clock.setFixedTime(expiresAt + 60_000);
  await expect(timer).toContainText(/expired/i);
  await expect(expiredDialog).toBeHidden();

  expect(mutations).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test("keeps expired unsaved Code selectable and downloadable while clearing the encrypted browser draft", async ({ context, page }, testInfo) => {
  const now = Date.UTC(2026, 9, 4, 12);
  await page.clock.setFixedTime(now);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const turretSource = "effects:\n  damage:\n    particles:\n      particle: DUST\n      color: '#123456'\n";
  const { expiresAt, link, mutations } = await mockRemoteWorkspace(context, {
    now,
    files: { "config.yml": "enabled: true\n", "turrets.yml": turretSource }
  });
  const pageErrors = capturePageErrors(page);
  const pendingSource = "enabled: [\n# unfinished change\n";
  await page.goto(link);
  await expect(page.locator("[data-editor-workspace]")).toBeVisible();
  await editCode(page, pendingSource);
  await expect(page.locator("[data-source-editor] .cm-content")).toContainText("# unfinished change");
  await expect.poll(async () => (await persistedDrafts(page)).length).toBe(1);
  const [draft] = await persistedDrafts(page);
  expect(JSON.stringify(draft)).not.toContain(pendingSource);

  await page.setViewportSize({ width: 390, height: 844 });
  const menuToggle = page.locator("[data-editor-save-menu-toggle]");
  await menuToggle.click();
  const menuBackup = page.locator(".dropdown-menu [data-download-recovery]");
  await expect(menuBackup).toBeInViewport();
  await page.screenshot({ path: testInfo.outputPath("mobile-backup-menu.png"), animations: "disabled" });
  await menuBackup.focus();
  await page.keyboard.press("Escape");
  await expect(menuToggle).toBeFocused();
  await page.setViewportSize({ width: 1280, height: 800 });

  await openEditorSettings(page);
  const settingsDialog = page.locator("[data-editor-settings-dialog]");
  await expect(settingsDialog).toBeVisible();
  await page.clock.setFixedTime(expiresAt);
  const expiredDialog = page.locator("[data-editor-session-expired-dialog]");
  const code = page.locator("[data-source-editor] .cm-content");
  const save = page.locator(".editor-header-actions [data-save-workspace]");
  await expect(expiredDialog).toBeVisible();
  await expect(expiredDialog).toHaveAccessibleName("Editing session expired");
  await expect(expiredDialog).toHaveAccessibleDescription("Saving configs directly to your server is no longer possible. Your work is still available in this tab. Download it before closing or refreshing!");
  const title = await expiredDialog.getByRole("heading").boundingBox();
  const close = await expiredDialog.getByRole("button", { name: "Close", exact: true }).boundingBox();
  expect(title.y + title.height / 2).toBeCloseTo(close.y + close.height / 2, 0);
  await expect(expiredDialog.locator("[data-download-recovery]")).toBeFocused();
  await expect(settingsDialog).toBeHidden();
  await expect.poll(() => page.locator("dialog[open]").count()).toBe(1);
  await expect(save).toBeEnabled();
  await expect(code).toHaveAttribute("aria-readonly", "true");
  await expect(code).toHaveAttribute("contenteditable", "false");
  await expect.poll(async () => (await persistedDrafts(page)).length).toBe(0);
  await page.screenshot({ path: testInfo.outputPath("desktop-expired-modal.png"), animations: "disabled" });

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(expiredDialog).toBeInViewport();
  await expect(expiredDialog.locator("[data-download-recovery]")).toBeInViewport();
  await expect(expiredDialog).toContainText("/k admin editor");
  await page.screenshot({ path: testInfo.outputPath("mobile-expired-modal.png"), animations: "disabled" });
  await expiredDialog.getByRole("button", { name: "Keep browsing" }).click();
  await expect(expiredDialog).toBeHidden();
  await expect(save).toBeFocused();
  await expect(save).toHaveAccessibleName(/download backup/i);

  await code.focus();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.press("ControlOrMeta+C");
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(pendingSource);
  await page.keyboard.type("discarded");
  await page.keyboard.press("ControlOrMeta+Z");
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.press("ControlOrMeta+C");
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(pendingSource);

  await openWorkspaceFile(page, "turrets.yml");
  await expect(code).toContainText("DUST");
  await switchEditorMode(page, "visual");
  await openEditorSection(page, "Effects");
  await expect(page.locator("[data-current-section]")).toHaveText("Effects");
  await expect(page.locator("[data-editor-form] input[type=color]")).toBeDisabled();
  await expect(page.locator("[data-editor-form] input[type=text]").first()).toHaveAttribute("readonly", "");
  const particleInput = page.locator("[data-editor-form] input[role=combobox]").first();
  await particleInput.evaluate((input) => input.focus());
  await expect(particleInput).not.toBeFocused();
  await expect(page.locator("[data-toggle-editor-navigation]")).toHaveAttribute("aria-expanded", "false");
  await openWorkspaceFile(page, "config.yml");
  await page.locator("[data-close-editor-navigation]").click();
  await switchEditorMode(page, "source");
  await expect(code).toContainText("# unfinished change");
  await expect(code).toHaveAttribute("contenteditable", "false");
  await expect(expiredDialog).toBeHidden();

  const backup = await downloadRecovery(page, save);
  expect(strFromU8(backup["configs/config.yml"])).toBe("enabled: true\n");
  expect(strFromU8(backup["pending-code/config.yml.txt"])).toBe(pendingSource);
  expect(strFromU8(backup["configs/turrets.yml"])).toBe(turretSource);
  await expect(save).toBeEnabled();
  await expect(expiredDialog).toBeHidden();
  expect(mutations).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test("downloading from the expiry dialog dismisses it and returns focus to the toolbar backup", async ({ context, page }) => {
  const now = Date.UTC(2026, 9, 4, 12);
  await page.clock.setFixedTime(now);
  const { expiresAt, link, mutations } = await mockRemoteWorkspace(context, { now });
  const pageErrors = capturePageErrors(page);
  await page.goto(link);
  await expect(page.locator("[data-editor-workspace]")).toBeVisible();
  await page.clock.setFixedTime(expiresAt);

  const expiredDialog = page.locator("[data-editor-session-expired-dialog]");
  const save = page.locator(".editor-header-actions [data-save-workspace]");
  await expect(expiredDialog).toBeVisible();
  const backup = await downloadRecovery(page, expiredDialog.locator("[data-download-recovery]"));
  expect(strFromU8(backup["configs/config.yml"])).toBe("enabled: true\n");
  await expect(expiredDialog).toBeHidden();
  await expect(save).toBeFocused();
  await expect(save).toBeEnabled();

  await page.clock.setFixedTime(expiresAt + 60_000);
  await switchEditorMode(page, "source");
  await expect(page.locator("[data-source-workspace]")).toBeVisible();
  await expect(expiredDialog).toBeHidden();
  expect(mutations).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test("remote toolbar keeps full save and backup labels with a stable caret width", async ({ context, page }, testInfo) => {
  const now = Date.UTC(2026, 9, 4, 12);
  await page.clock.setFixedTime(now);
  const { expiresAt, link } = await mockRemoteWorkspace(context, { now });
  await page.goto(link);
  await expect(page.locator("[data-editor-workspace]")).toBeVisible();
  const save = page.locator("[data-editor-primary-action]");
  const caret = page.locator("[data-editor-save-menu-toggle]");
  const desktopCaretWidth = (await caret.boundingBox()).width;

  for (const label of ["Save to server", "Download backup"]) {
    if (label === "Download backup") {
      await page.clock.setFixedTime(expiresAt);
      await page.locator("[data-editor-session-expired-dialog]").getByRole("button", { name: "Keep browsing" }).click();
    }

    for (const width of [1280, 768, 575, 490, 420, 390, 375, 360, 320]) {
      await page.setViewportSize({ width, height: 844 });
      await expect(save.locator("[data-download-label]")).toBeVisible();
      await expect(save).toHaveAccessibleName(label);
      const bounds = await save.evaluate((button) => {
        const label = button.querySelector("[data-download-label]");
        const range = document.createRange();
        range.selectNodeContents(label);
        const text = range.getBoundingClientRect();
        const control = button.getBoundingClientRect();
        const review = document.querySelector(".editor-header-actions [data-preview-yaml]").getBoundingClientRect();
        const actions = document.querySelector(".editor-header-actions").getBoundingClientRect();
        return {
          textLeft: text.left,
          textRight: text.right,
          left: control.left,
          right: control.right,
          top: control.top,
          height: control.height,
          reviewLeft: review.left,
          reviewRight: review.right,
          reviewTop: review.top,
          reviewHeight: review.height,
          actionsLeft: actions.left,
          actionsRight: actions.right,
          pageWidth: document.documentElement.scrollWidth
        };
      });
      expect(bounds.textLeft).toBeGreaterThanOrEqual(bounds.left);
      expect(bounds.textRight).toBeLessThanOrEqual(bounds.right);
      expect(bounds.right).toBeLessThanOrEqual(width);
      expect(bounds.pageWidth).toBeLessThanOrEqual(width);
      expect(bounds.reviewRight).toBeLessThanOrEqual(bounds.left);
      expect(bounds.reviewTop + bounds.reviewHeight / 2).toBeCloseTo(bounds.top + bounds.height / 2, 0);
      const controlsHost = width < 997 ? "[data-editor-sidebar-controls]" : "[data-editor-header-controls]";
      await expect(page.locator(`${controlsHost} [data-editor-controls]`)).toHaveCount(1);
      const caretBounds = await caret.boundingBox();
      expect(caretBounds.width).toBeCloseTo(desktopCaretWidth, 0);
      expect(caretBounds.height).toBeCloseTo(bounds.height, 1);
      expect(caretBounds.y).toBeCloseTo(bounds.top, 1);
      expect(caretBounds.x).toBeGreaterThanOrEqual(bounds.right - 1);
      expect(caretBounds.x + caretBounds.width).toBeLessThanOrEqual(width);

      if (width < 997) {
        expect((bounds.actionsLeft + bounds.actionsRight) / 2).toBeCloseTo(width / 2, 0);
      }

      if (label === "Download backup" && [390, 320].includes(width)) {
        await page.screenshot({ path: testInfo.outputPath(`backup-toolbar-${width}.png`), animations: "disabled" });
      }
    }
  }
});
