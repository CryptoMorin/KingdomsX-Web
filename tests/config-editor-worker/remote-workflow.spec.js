import { expect, test } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { unzipSync, zipSync } from "fflate";
import {
  decryptRemotePayload,
  deriveRemoteEditorSecrets,
  encryptRemotePayload,
  REMOTE_PAYLOAD_KIND,
  sha256Hex
} from "../../src/assets/scripts/config-editor/remote-session-crypto.js";
import { openEditorSection } from "../config-editor/editor-test-support.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

test("editor sends encrypted configs through the real Worker and receives the saved result", async ({ page, request }) => {
  const emptyPage = await page.context().newPage();
  await emptyPage.goto("/");
  await expect(emptyPage.locator("[data-drop-zone]")).toHaveCount(0);
  await expect(emptyPage.locator("[data-open-file]")).toHaveCount(0);
  await emptyPage.close();

  const linkSeed = secret(32);
  const { id: sessionId, key, browserToken } = await deriveRemoteEditorSecrets(linkSeed);
  const serverToken = secret(32);
  const source = encoder.encode("updates:\n  check: false\n");
  const manifest = encoder.encode(JSON.stringify({
    protocol: 1,
    pluginVersion: "1.17.27.1",
    files: [{ path: "config.yml", sha256: await sha256Hex(source) }],
    capabilities: {
      schematicDirectories: [],
      outpostPageDirectories: []
    }
  }));
  const archive = zipSync({
    "config.yml": source,
    "kingdomsx-editor.json": manifest
  });
  const encryptedOriginal = await encryptRemotePayload(archive, {
    sessionId,
    key,
    kind: REMOTE_PAYLOAD_KIND.original,
    revision: 0
  });

  const created = await request.put(`/api/editor/v1/sessions/${sessionId}`, {
    headers: { "CF-Connecting-IP": "192.0.2.1" },
    data: {
      protocol: 1,
      name: "server-configs.zip",
      pluginVersion: "1.17.27.1",
      serverTokenHash: await sha256Hex(encoder.encode(serverToken)),
      browserTokenHash: await sha256Hex(encoder.encode(browserToken)),
      original: {
        bytes: encryptedOriginal.byteLength,
        sha256: await sha256Hex(encryptedOriginal)
      }
    }
  });
  expect(created.status()).toBe(201);

  const uploaded = await request.put(`/api/editor/v1/sessions/${sessionId}/payloads/original`, {
    headers: await payloadHeaders(serverToken, encryptedOriginal),
    data: Buffer.from(encryptedOriginal)
  });
  expect(uploaded.status()).toBe(201);

  const pageErrors = [];
  const failedAssets = [];
  const socketFrames = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("requestfailed", (failed) => {
    if (new URL(failed.url()).origin === "http://127.0.0.1:8788") {
      failedAssets.push(failed.url());
    }
  });
  page.on("websocket", (socket) => {
    socket.on("framereceived", ({ payload }) => socketFrames.push(String(payload)));
  });

  let continueOpeningSession;
  const openingSession = new Promise((resolve) => {
    continueOpeningSession = resolve;
  });
  await page.route(`**/api/editor/v1/sessions/${sessionId}`, async (route) => {
    if (route.request().method() === "GET") {
      await openingSession;
    }

    await route.continue();
  });

  const navigation = await page.goto(`/#s/v1/${linkSeed}`);
  expect(navigation?.status()).toBe(200);
  expect(navigation?.headers()["content-security-policy"]).toContain("default-src 'none'");
  await expect(page.locator("[data-editor-session-loading]")).toBeVisible();
  await expect(page.locator("[data-editor-empty]")).toBeHidden();
  continueOpeningSession();
  await page.locator("[data-editor-workspace]").waitFor({ state: "visible" });
  await page.unroute(`**/api/editor/v1/sessions/${sessionId}`);
  await expect(page.locator("[data-editor-session-loading]")).toBeHidden();
  expect(new URL(page.url()).hash).toBe("");
  await expect.poll(() => socketFrames.some(isSessionSnapshot)).toBe(true);
  const saveButton = page.locator(".editor-header-actions [data-save-workspace]");
  await expect(saveButton).toHaveAccessibleName("Save to server");
  await expect(saveButton).toBeDisabled();
  await expect(page.locator("[data-download-original]")).toBeHidden();

  const stalePage = await page.context().newPage();
  const stalePageErrors = [];
  stalePage.on("pageerror", (error) => stalePageErrors.push(error.message));
  await stalePage.goto(`/#s/v1/${linkSeed}`);
  await stalePage.locator("[data-editor-workspace]").waitFor({ state: "visible" });

  await openEditorSection(page, /^Updates\d*$/);
  const toggle = page.getByRole("switch", { name: "Check: Off" });
  await toggle.locator("xpath=..").click();
  await expect(page.getByRole("switch", { name: "Check: On" })).toBeChecked();
  await expect(saveButton).toBeEnabled();

  page.on("dialog", (dialog) => dialog.accept());
  await saveButton.click();
  const saveOverlay = page.locator("[data-editor-save-overlay]");
  await expect(saveOverlay).toBeVisible();
  await expect(saveButton).toHaveAccessibleName("Saving changes to server");
  await expect(page.locator("[data-editor-shell]")).toHaveJSProperty("inert", true);
  await expect.poll(() => sessionState(request, sessionId, serverToken), { timeout: 30_000 })
    .toBe("result_ready");
  await expect(stalePage.locator("[data-change-status]")).toHaveText("Newer server changes available");
  await expect(stalePage.locator("[data-editor-workspace]")).toHaveJSProperty("inert", true);
  await expect(stalePage.locator(".editor-header-actions [data-save-workspace]")).toBeDisabled();

  const resultResponse = await request.get(`/api/editor/v1/sessions/${sessionId}/payloads/result/1`, {
    headers: authorization(serverToken)
  });
  expect(resultResponse.status()).toBe(200);
  const encryptedResult = new Uint8Array(await resultResponse.body());
  const result = await decryptRemotePayload(encryptedResult, {
    sessionId,
    key,
    kind: REMOTE_PAYLOAD_KIND.result,
    revision: 1
  });
  const files = unzipSync(result);
  expect(decoder.decode(files["config.yml"])).toBe("updates:\n  check: true\n");

  expect((await apply(request, sessionId, serverToken, "started")).status()).toBe(200);
  expect((await apply(request, sessionId, serverToken, "applied")).status()).toBe(200);
  await expect.poll(() => socketFrames.some((frame) => isSessionSnapshot(frame, "applied"))).toBe(true);
  await expect(saveOverlay).toBeHidden();
  await expect(page.locator("[data-editor-shell]")).toHaveJSProperty("inert", false);
  await expect(page.locator("[data-change-status]")).toHaveText("Saved to server");
  await expect(saveButton).toBeDisabled();

  expect(stalePageErrors).toEqual([]);
  await stalePage.close();
  expect(pageErrors).toEqual([]);
  expect(failedAssets).toEqual([]);
});

function secret(bytes) {
  return randomBytes(bytes).toString("base64url");
}

function authorization(token) {
  return { Authorization: `KingdomsX-Editor ${token}` };
}

async function payloadHeaders(token, bytes) {
  return {
    ...authorization(token),
    "Content-Type": "application/octet-stream",
    "X-KingdomsX-Payload-Bytes": String(bytes.byteLength),
    "X-KingdomsX-Payload-Sha256": await sha256Hex(bytes)
  };
}

async function sessionState(request, sessionId, token) {
  const response = await request.get(`/api/editor/v1/sessions/${sessionId}`, {
    headers: authorization(token)
  });

  return (await response.json()).state;
}

function apply(request, sessionId, token, outcome) {
  return request.post(`/api/editor/v1/sessions/${sessionId}/apply`, {
    headers: authorization(token),
    data: { revision: 1, outcome }
  });
}

function isSessionSnapshot(frame, state = "") {
  try {
    const snapshot = JSON.parse(frame);

    return snapshot.type === "session" && (!state || snapshot.state === state);
  } catch {
    return false;
  }
}
