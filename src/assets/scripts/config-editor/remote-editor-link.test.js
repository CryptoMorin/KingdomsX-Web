import { describe, expect, it } from "vitest";
import {
  forgetRemoteEditorLink,
  REMOTE_EDITOR_SESSION_STORAGE_KEY,
  takeRemoteEditorLink
} from "./remote-editor-link.js";

const seed = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8";
const session = {
  protocol: 1,
  id: "OS8PHhPTaDvkj-Zhn8zWIw",
  key: "HnlqpSd7Zo7EFO5seTziZSsZBSni0_GsWr3kF9l8b9M",
  browserToken: "stV5NmIsEd7x_4DIH_LTBCLVsGPpwN2lIMCU3ibLXXY"
};

function memoryStorage() {
  const values = new Map();

  return {
    getItem: (name) => values.get(name) ?? null,
    setItem: (name, value) => values.set(name, value),
    removeItem: (name) => values.delete(name)
  };
}

describe("remote editor links", () => {
  it("derives secrets from the seed and removes it from the address bar", async () => {
    const storage = memoryStorage();
    const replacements = [];
    const opened = await takeRemoteEditorLink({
      location: { hash: `#s/v1/${seed}`, pathname: "/editor/", search: "?theme=dark" },
      history: { state: null, replaceState: (...args) => replacements.push(args) },
      storage
    });

    expect(opened).toEqual({ ...session, persistenceAvailable: true });
    expect(replacements[0][2]).toBe("/editor/?theme=dark");
    expect(JSON.parse(storage.getItem("kingdomsx.editor.remote-session.v1"))).toEqual({ protocol: 1, seed });
    expect(await takeRemoteEditorLink({
      location: { hash: "" },
      history: {},
      storage
    })).toEqual(opened);
  });

  it("rejects malformed fragments, strips them from the address, and does not save a session", async () => {
    const replacements = [];
    const storage = memoryStorage();
    await expect(takeRemoteEditorLink({
      location: { hash: "#s/v1/not-valid", pathname: "/", search: "" },
      history: { state: null, replaceState: (...args) => replacements.push(args) },
      storage
    })).rejects.toThrow("invalid or incomplete");
    expect(replacements[0][2]).toBe("/");
    expect(storage.getItem(REMOTE_EDITOR_SESSION_STORAGE_KEY)).toBeNull();
  });

  it("rejects a non-canonical seed", async () => {
    await expect(takeRemoteEditorLink({
      location: { hash: `#s/v1/${seed.slice(0, -1)}9`, pathname: "/", search: "" },
      history: { state: null, replaceState() {} },
      storage: memoryStorage()
    })).rejects.toThrow("seed is invalid");
  });

  it("keeps the current-page session usable when sessionStorage cannot save it", async () => {
    const opened = await takeRemoteEditorLink({
      location: { hash: `#s/v1/${seed}`, pathname: "/", search: "" },
      history: { state: null, replaceState() {} },
      storage: {
        setItem() {
          throw new Error("storage disabled");
        }
      }
    });

    expect(opened).toEqual({ ...session, persistenceAvailable: false });
  });

  it("treats sessionStorage read and cleanup failures as an unavailable saved session", async () => {
    const storage = {
      getItem() {
        throw new Error("storage disabled");
      },
      removeItem() {
        throw new Error("storage disabled");
      }
    };

    expect(await takeRemoteEditorLink({
      location: { hash: "", pathname: "/", search: "" },
      history: {},
      storage
    })).toBeNull();
    expect(forgetRemoteEditorLink(storage)).toBe(false);
  });

  it("removes malformed saved sessions without failing when cleanup is unavailable", async () => {
    const storage = {
      getItem: () => "not-json",
      removeItem() {
        throw new Error("storage disabled");
      }
    };

    expect(await takeRemoteEditorLink({
      location: { hash: "", pathname: "/", search: "" },
      history: {},
      storage
    })).toBeNull();
  });

  it("forgets a completed or replaced session", () => {
    const storage = memoryStorage();
    storage.setItem("kingdomsx.editor.remote-session.v1", "{}");
    forgetRemoteEditorLink(storage);
    expect(storage.getItem("kingdomsx.editor.remote-session.v1")).toBeNull();
  });
});
