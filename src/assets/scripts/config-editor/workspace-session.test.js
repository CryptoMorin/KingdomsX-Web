import { unzipSync, zipSync } from "fflate";
import { describe, expect, it, vi } from "vitest";
import { replaceDocumentValue } from "./yaml-source.js";
import { sha256Hex } from "./remote-session-crypto.js";
import { customYamlWarnings } from "./kingdoms-yaml-validation.js";
import { workspaceRelationships } from "./workspace-dependencies.js";
import { messageMacroContext, undefinedMessageMacroWarnings } from "./message-macros.js";
import {
  acceptRemoteWorkspaceSave,
  addWorkspaceSchematic,
  createWorkspaceFile,
  exampleWorkspace,
  openWorkspaceArtifact,
  openWorkspaceSelection,
  replaceWorkspaceSchematic,
  restoreRemoteWorkspaceDraft,
  removeWorkspaceSchematic,
  removeWorkspaceFile,
  renameWorkspaceFile,
  selectWorkspaceFile,
  workspaceChangeSummary,
  workspaceDownloadArtifact,
  workspaceFileChanges,
  workspaceHasChanges,
  workspaceOriginalArtifact,
  workspaceRecoveryArtifact,
  workspaceSchematicFiles
} from "./workspace-session.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const activeSession = (workspace) => workspace.files.find((session) => session.fileName === workspace.activePath);

describe("config files and ZIPs", () => {
  it("opens the demo without broken aliases, message macros, or template imports", async () => {
    const workspace = await exampleWorkspace();

    for (const session of workspace.files) {
      const relationships = workspaceRelationships(workspace, session);

      expect(session.document.editable, session.fileName).toBe(true);
      expect.soft(session.document.index.warnings, session.fileName).toEqual([]);
      expect.soft(customYamlWarnings(session.document.index), session.fileName).toEqual([]);
      expect.soft(relationships.warnings, session.fileName).toEqual([]);
      expect.soft(undefinedMessageMacroWarnings(
        session.document.index,
        messageMacroContext(workspace, session)
      ), session.fileName).toEqual([]);

      for (const dependency of relationships.dependencies) {
        expect.soft(dependency.path, `${session.fileName} imports ${dependency.name}`).not.toBeNull();
      }
    }
  });

  it("keeps a single YAML selection as a single-file download", async () => {
    const workspace = await openWorkspaceSelection([
      new File(["enabled: true\r\n"], "config.yml", { type: "text/yaml" })
    ]);

    replaceDocumentValue(activeSession(workspace).document, ["enabled"], "false");
    const artifact = await workspaceDownloadArtifact(workspace);
    const original = await workspaceOriginalArtifact(workspace);

    expect(workspace.sourceKind).toBe("file");
    expect(artifact.name).toBe("config-edited.yml");
    expect(await artifact.blob.text()).toBe("enabled: false\r\n");
    expect(original.name).toBe("config-original.yml");
    expect(await original.blob.text()).toBe("enabled: true\r\n");
  });

  it("opens several YAML files and downloads them in one ZIP", async () => {
    const workspace = await openWorkspaceSelection([
      new File(["enabled: true\n"], "config.yml"),
      new File(["title: hello\n"], "messages.yml")
    ]);

    const messages = selectWorkspaceFile(workspace, "messages.yml");
    replaceDocumentValue(messages.document, ["title"], "goodbye");
    const artifact = await workspaceDownloadArtifact(workspace);
    const files = unzipSync(new Uint8Array(await artifact.blob.arrayBuffer()));

    expect(workspaceChangeSummary(workspace)).toEqual({ files: 1, changes: 1 });
    expect(artifact.name).toBe("kingdomsx-configs-edited.zip");
    expect(decoder.decode(files["config.yml"])).toBe("enabled: true\n");
    expect(decoder.decode(files["messages.yml"])).toBe("title: goodbye\n");
  });

  it("keeps globals.yml unchanged but does not open it for editing", async () => {
    const workspace = await openWorkspaceSelection([
      new File(["migration: 17\n"], "globals.yml"),
      new File(["enabled: true\n"], "config.yml")
    ]);

    expect(workspace.files.map((session) => session.fileName)).toEqual(["config.yml"]);
    replaceDocumentValue(activeSession(workspace).document, ["enabled"], "false");

    const artifact = await workspaceDownloadArtifact(workspace);
    const output = unzipSync(new Uint8Array(await artifact.blob.arrayBuffer()));
    expect(artifact.name).toBe("kingdomsx-configs-edited.zip");
    expect(decoder.decode(output["config.yml"])).toBe("enabled: false\n");
    expect(decoder.decode(output["globals.yml"])).toBe("migration: 17\n");
  });

  it("rejects globals.yml when it is the only selected config", async () => {
    await expect(openWorkspaceSelection([
      new File(["migration: 17\n"], "globals.yml")
    ])).rejects.toThrow("managed by KingdomsX");
  });

  it("preserves archive paths, unrelated entries, and untouched YAML bytes", async () => {
    const sourceEntries = {
      "Kingdoms/config.yml": encoder.encode("enabled: true\r\n"),
      "Kingdoms/guis/menu.yml": encoder.encode("title: '&6Menu'\r\n"),
      "Kingdoms/readme.txt": encoder.encode("keep this too")
    };
    const originalZip = zipSync(sourceEntries);
    const workspace = await openWorkspaceSelection([new File([originalZip], "configs.zip")]);

    expect(activeSession(workspace).fileName).toBe("Kingdoms/config.yml");
    const menu = selectWorkspaceFile(workspace, "Kingdoms/guis/menu.yml");
    replaceDocumentValue(menu.document, ["title"], "'&aMenu'");

    const artifact = await workspaceDownloadArtifact(workspace);
    const output = unzipSync(new Uint8Array(await artifact.blob.arrayBuffer()));
    expect(decoder.decode(output["Kingdoms/config.yml"])).toBe("enabled: true\r\n");
    expect(decoder.decode(output["Kingdoms/guis/menu.yml"])).toBe("title: '&aMenu'\r\n");
    expect(decoder.decode(output["Kingdoms/readme.txt"])).toBe("keep this too");
    expect(workspaceHasChanges(workspace)).toBe(true);

    const backup = await workspaceOriginalArtifact(workspace);
    expect(backup.name).toBe("configs-original.zip");
    expect(new Uint8Array(await backup.blob.arrayBuffer())).toEqual(originalZip);
  });

  it("exposes and replaces schematic files without changing their archive paths", async () => {
    const originalSchematic = Uint8Array.from([1, 2, 3]);
    const replacement = Uint8Array.from([4, 5, 6, 7]);
    const originalZip = zipSync({
      "Kingdoms/Turrets/arrow.yml": encoder.encode("max-level: 1\n"),
      "Kingdoms/schematics/turrets/arrow/1.schematic": originalSchematic
    });
    const workspace = await openWorkspaceSelection([new File([originalZip], "configs.zip")]);

    expect(workspaceSchematicFiles(workspace).map((entry) => entry.path)).toEqual([
      "Kingdoms/schematics/turrets/arrow/1.schematic"
    ]);

    await replaceWorkspaceSchematic(
      workspace,
      "Kingdoms/schematics/turrets/arrow/1.schematic",
      new File([replacement], "custom.schem")
    );

    expect(workspaceChangeSummary(workspace)).toEqual({ files: 1, changes: 1 });
    expect(workspaceFileChanges(workspace).map(({ kind, path }) => ({ kind, path }))).toEqual([{
      kind: "Schematic",
      path: "Kingdoms/schematics/turrets/arrow/1.schematic"
    }]);

    const artifact = await workspaceDownloadArtifact(workspace);
    const output = unzipSync(new Uint8Array(await artifact.blob.arrayBuffer()));
    expect(output["Kingdoms/schematics/turrets/arrow/1.schematic"]).toEqual(replacement);

    const backup = await workspaceOriginalArtifact(workspace);
    expect(new Uint8Array(await backup.blob.arrayBuffer())).toEqual(originalZip);
  });

  it("adds level-based schematics and exports them at their numbered archive path", async () => {
    const levelOne = Uint8Array.from([1, 2, 3]);
    const levelFour = Uint8Array.from([4, 5, 6, 7]);
    const originalZip = zipSync({
      "Kingdoms/Turrets/arrow.yml": encoder.encode("max-level: 6\n"),
      "Kingdoms/schematics/turrets/arrow/1.schematic": levelOne
    });
    const workspace = await openWorkspaceSelection([new File([originalZip], "configs.zip")]);

    const added = await addWorkspaceSchematic(
      workspace,
      "Kingdoms/schematics/turrets/arrow",
      4,
      new File([levelFour], "custom.schematic"),
      { maxLevel: 6 }
    );

    expect(added.path).toBe("Kingdoms/schematics/turrets/arrow/4.schematic");
    expect(workspaceChangeSummary(workspace)).toEqual({ files: 1, changes: 1 });
    expect(workspaceFileChanges(workspace).map(({ kind, path }) => ({ kind, path }))).toEqual([{
      kind: "Schematic",
      path: "Kingdoms/schematics/turrets/arrow/4.schematic"
    }]);

    const artifact = await workspaceDownloadArtifact(workspace);
    const output = unzipSync(new Uint8Array(await artifact.blob.arrayBuffer()));
    expect(output[added.path]).toEqual(levelFour);
    expect(output["Kingdoms/schematics/turrets/arrow/1.schematic"]).toEqual(levelOne);
    expect(new Uint8Array(await (await workspaceOriginalArtifact(workspace)).blob.arrayBuffer())).toEqual(originalZip);
  });

  it("rejects duplicate, out-of-range, and non-initial schematic levels", async () => {
    const originalZip = zipSync({
      "Turrets/arrow.yml": encoder.encode("max-level: 6\n"),
      "schematics/turrets/arrow/1.schematic": Uint8Array.from([1])
    });
    const workspace = await openWorkspaceSelection([new File([originalZip], "configs.zip")]);
    const file = new File([Uint8Array.from([2])], "custom.schematic");

    await expect(addWorkspaceSchematic(workspace, "schematics/turrets/arrow", 1, file, { maxLevel: 6 }))
      .rejects.toThrow("already defined for level 1");
    await expect(addWorkspaceSchematic(workspace, "schematics/turrets/arrow", 7, file, { maxLevel: 6 }))
      .rejects.toThrow("has 6 levels");

    const emptyFolderWorkspace = await openWorkspaceSelection([
      new File([zipSync({ "Turrets/flame.yml": encoder.encode("max-level: 6\n") })], "configs.zip")
    ]);
    await expect(addWorkspaceSchematic(emptyFolderWorkspace, "schematics/turrets/flame", 4, file, { maxLevel: 6 }))
      .rejects.toThrow("Add the level 1 schematic first");
  });

  it("turns a standalone building config into a ZIP when its first schematic is added", async () => {
    const workspace = await openWorkspaceSelection([
      new File(["max-level: 3\n"], "Turrets/arrow.yml")
    ]);
    const schematic = Uint8Array.from([1, 2, 3]);

    await addWorkspaceSchematic(
      workspace,
      "schematics/turrets/arrow",
      1,
      new File([schematic], "arrow.schematic"),
      { maxLevel: 3 }
    );

    const artifact = await workspaceDownloadArtifact(workspace);
    const output = unzipSync(new Uint8Array(await artifact.blob.arrayBuffer()));
    expect(artifact.name).toBe("kingdomsx-configs-edited.zip");
    expect(decoder.decode(output["Turrets/arrow.yml"])).toBe("max-level: 3\n");
    expect(output["schematics/turrets/arrow/1.schematic"]).toEqual(schematic);
  });

  it("removes an original level schematic from the edited ZIP while preserving the exact backup", async () => {
    const originalZip = zipSync({
      "Turrets/arrow.yml": encoder.encode("max-level: 6\n"),
      "schematics/turrets/arrow/1.schematic": Uint8Array.from([1]),
      "schematics/turrets/arrow/3.schematic": Uint8Array.from([3]),
      "schematics/turrets/arrow/6.schematic": Uint8Array.from([6])
    });
    const workspace = await openWorkspaceSelection([new File([originalZip], "configs.zip")]);

    removeWorkspaceSchematic(workspace, "schematics/turrets/arrow/3.schematic");

    expect(workspaceChangeSummary(workspace)).toEqual({ files: 1, changes: 1 });
    expect(workspaceFileChanges(workspace).map(({ kind, path }) => ({ kind, path }))).toEqual([{
      kind: "Schematic",
      path: "schematics/turrets/arrow/3.schematic"
    }]);
    const output = unzipSync(new Uint8Array(await (await workspaceDownloadArtifact(workspace)).blob.arrayBuffer()));
    expect(output["schematics/turrets/arrow/3.schematic"]).toBeUndefined();
    expect(output["schematics/turrets/arrow/1.schematic"]).toEqual(Uint8Array.from([1]));
    expect(new Uint8Array(await (await workspaceOriginalArtifact(workspace)).blob.arrayBuffer())).toEqual(originalZip);
  });

  it("cancels a newly added schematic change when that schematic is removed", async () => {
    const originalZip = zipSync({
      "Turrets/arrow.yml": encoder.encode("max-level: 6\n"),
      "schematics/turrets/arrow/1.schematic": Uint8Array.from([1])
    });
    const workspace = await openWorkspaceSelection([new File([originalZip], "configs.zip")]);
    const added = await addWorkspaceSchematic(
      workspace,
      "schematics/turrets/arrow",
      4,
      new File([Uint8Array.from([4])], "custom.schematic"),
      { maxLevel: 6 }
    );

    removeWorkspaceSchematic(workspace, added.path);

    expect(workspaceHasChanges(workspace)).toBe(false);
    expect(workspaceFileChanges(workspace)).toEqual([]);
    expect(new Uint8Array(await (await workspaceDownloadArtifact(workspace)).blob.arrayBuffer())).toEqual(originalZip);
  });

  it("keeps level 1 while later schematic breakpoints still exist", async () => {
    const workspace = await openWorkspaceSelection([new File([zipSync({
      "Turrets/arrow.yml": encoder.encode("max-level: 6\n"),
      "schematics/turrets/arrow/1.schematic": Uint8Array.from([1]),
      "schematics/turrets/arrow/4.schematic": Uint8Array.from([4])
    })], "configs.zip")]);

    expect(() => removeWorkspaceSchematic(workspace, "schematics/turrets/arrow/1.schematic"))
      .toThrow("Remove the later level schematics before removing level 1");
  });

  it("preserves globals.yml in ZIP archives without opening it", async () => {
    const originalZip = zipSync({
      "Kingdoms/config.yml": encoder.encode("enabled: true\n"),
      "Kingdoms/globals.yml": encoder.encode("migration: 17\n")
    });
    const workspace = await openWorkspaceSelection([new File([originalZip], "configs.zip")]);

    expect(workspace.files.map((session) => session.fileName)).toEqual(["Kingdoms/config.yml"]);
    replaceDocumentValue(activeSession(workspace).document, ["enabled"], "false");

    const artifact = await workspaceDownloadArtifact(workspace);
    const output = unzipSync(new Uint8Array(await artifact.blob.arrayBuffer()));
    expect(decoder.decode(output["Kingdoms/config.yml"])).toBe("enabled: false\n");
    expect(decoder.decode(output["Kingdoms/globals.yml"])).toBe("migration: 17\n");
  });

  it("accepts ordinary ZIP directory entries", async () => {
    const originalZip = zipSync({
      Kingdoms: {
        guis: {
          "menu.yml": encoder.encode("title: Menu\n")
        }
      }
    });
    const workspace = await openWorkspaceSelection([new File([originalZip], "configs.zip")]);

    expect(workspace.files.map((session) => session.fileName)).toEqual(["Kingdoms/guis/menu.yml"]);
  });

  it("returns the exact original archive when nothing changed", async () => {
    const originalZip = zipSync({ "config.yml": encoder.encode("enabled: true\n") });
    const workspace = await openWorkspaceSelection([new File([originalZip], "configs.zip")]);
    const artifact = await workspaceDownloadArtifact(workspace);

    expect(new Uint8Array(await artifact.blob.arrayBuffer())).toEqual(originalZip);
  });

  it("uses the saved server result as the new unchanged version", async () => {
    const originalZip = await remoteArchive({
      yaml: { "config.yml": encoder.encode("enabled: true\n") }
    });
    const workspace = await openWorkspaceArtifact({
      name: "server-configs.zip",
      bytes: originalZip,
      remoteProtocol: 1,
      remoteRevision: 0
    });
    replaceDocumentValue(activeSession(workspace).document, ["enabled"], "false");
    const artifact = await workspaceDownloadArtifact(workspace);
    const bytes = new Uint8Array(await artifact.blob.arrayBuffer());

    acceptRemoteWorkspaceSave(workspace, bytes, 1);

    expect(workspace.remoteRevision).toBe(1);
    expect(workspaceChangeSummary(workspace)).toEqual({ files: 0, changes: 0 });
    expect(activeSession(workspace).document.originalText).toBe("enabled: false\n");
    expect(new Uint8Array(await (await workspaceDownloadArtifact(workspace)).blob.arrayBuffer())).toEqual(bytes);

    replaceDocumentValue(activeSession(workspace).document, ["enabled"], "true");
    expect(workspaceChangeSummary(workspace)).toEqual({ files: 1, changes: 1 });
  });

  it("restores a local draft as unsaved changes over the server version", async () => {
    const originalZip = await remoteArchive({
      yaml: {
        "config.yml": encoder.encode("enabled: true\n"),
        "guis/en/structures/outpost/1.yml": encoder.encode("title: First\n")
      },
      outpostPageDirectories: ["guis/en/structures/outpost"]
    });
    const baseline = await openWorkspaceArtifact({
      name: "server-configs.zip",
      bytes: originalZip,
      remoteProtocol: 1,
      remoteRevision: 0
    });
    replaceDocumentValue(selectWorkspaceFile(baseline, "config.yml").document, ["enabled"], "false");
    createWorkspaceFile(baseline, "guis/en/structures/outpost/2.yml", "title: Second\n");
    const draftArtifact = await workspaceDownloadArtifact(baseline);

    const freshBaseline = await openWorkspaceArtifact({
      name: "server-configs.zip",
      bytes: originalZip,
      remoteProtocol: 1,
      remoteRevision: 0
    });
    const restored = await restoreRemoteWorkspaceDraft(freshBaseline, {
      name: draftArtifact.name,
      bytes: new Uint8Array(await draftArtifact.blob.arrayBuffer())
    });

    expect(restored.remoteRevision).toBe(0);
    expect(workspaceChangeSummary(restored)).toEqual({ files: 2, changes: 2 });
    expect(restored.files.find((session) => session.fileName.endsWith("/2.yml"))?.created).toBe(true);
    const output = unzipSync(new Uint8Array(await (await workspaceDownloadArtifact(restored)).blob.arrayBuffer()));
    expect(decoder.decode(output["config.yml"])).toBe("enabled: false\n");
    expect(decoder.decode(output["guis/en/structures/outpost/2.yml"])).toBe("title: Second\n");
  });

  it("names recovery downloads with the current local date and time", async () => {
    const workspace = await openWorkspaceSelection([new File(["enabled: true\n"], "config.yml")]);
    vi.useFakeTimers({ toFake: ["Date"] });

    try {
      vi.setSystemTime(new Date(2026, 9, 6, 8, 35, 33));
      expect((await workspaceRecoveryArtifact(workspace)).name).toBe("kingdomsx-configs-recovery-06-10-2026_08-35-33.zip");
      vi.setSystemTime(new Date(2027, 0, 23, 0, 1, 2));
      expect((await workspaceRecoveryArtifact(workspace)).name).toBe("kingdomsx-configs-recovery-23-01-2027_00-01-02.zip");
    } finally {
      vi.useRealTimers();
    }
  });

  it("backs up current files and raw pending Code text without saving the server workspace", async () => {
    const pageDirectory = "guis/en/structures/outpost";
    const schematicDirectory = "schematics/turrets/arrow";
    const firstSchematic = `${schematicDirectory}/1.schematic`;
    const removedSchematic = `${schematicDirectory}/3.schematic`;
    const originalConfig = encoder.encode("\ufeffenabled: true\r\n");
    const archive = await remoteArchive({
      yaml: {
        "config.yml": originalConfig,
        "Turrets/arrow.yml": encoder.encode("max-level: 3\n"),
        [`${pageDirectory}/1.yml`]: encoder.encode("title: First\n"),
        [`${pageDirectory}/2.yml`]: encoder.encode("title: Second\n")
      },
      schematics: {
        [firstSchematic]: Uint8Array.from([1, 2, 3]),
        [removedSchematic]: Uint8Array.from([4, 5])
      },
      schematicDirectories: [{ path: schematicDirectory, config: "Turrets/arrow.yml" }],
      outpostPageDirectories: [pageDirectory]
    });
    const workspace = await openWorkspaceArtifact({
      name: "server-configs.zip",
      bytes: archive,
      remoteProtocol: 1
    });
    acceptRemoteWorkspaceSave(workspace, archive, 1);
    replaceDocumentValue(selectWorkspaceFile(workspace, "Turrets/arrow.yml").document, ["max-level"], "4");
    renameWorkspaceFile(workspace, `${pageDirectory}/1.yml`, `${pageDirectory}/3.yml`);
    removeWorkspaceFile(workspace, `${pageDirectory}/2.yml`);
    createWorkspaceFile(workspace, `${pageDirectory}/4.yml`, "title: Fourth\r\n");
    await replaceWorkspaceSchematic(workspace, firstSchematic, new File([Uint8Array.from([9, 8])], "replacement.schematic"));
    removeWorkspaceSchematic(workspace, removedSchematic);
    const pendingCode = "max-level: [ unfinished\r\n# Still typing\r\n";
    const changesBefore = workspaceChangeSummary(workspace);
    const artifact = await workspaceRecoveryArtifact(workspace, {
      fileName: "Turrets/arrow.yml",
      source: pendingCode
    });
    const output = unzipSync(new Uint8Array(await artifact.blob.arrayBuffer()));

    expect(output["configs/config.yml"]).toEqual(originalConfig);
    expect(decoder.decode(output["configs/Turrets/arrow.yml"])).toBe("max-level: 4\n");
    expect(decoder.decode(output[`configs/${pageDirectory}/3.yml`])).toBe("title: First\n");
    expect(decoder.decode(output[`configs/${pageDirectory}/4.yml`])).toBe("title: Fourth\r\n");
    expect(output[`configs/${firstSchematic}`]).toEqual(Uint8Array.from([9, 8]));
    expect(output[`configs/${pageDirectory}/1.yml`]).toBeUndefined();
    expect(output[`configs/${pageDirectory}/2.yml`]).toBeUndefined();
    expect(output[`configs/${removedSchematic}`]).toBeUndefined();
    expect(output["configs/kingdomsx-editor.json"]).toBeUndefined();
    expect(decoder.decode(output["pending-code/Turrets/arrow.yml.txt"])).toBe(pendingCode);
    const instructions = decoder.decode(output["README.txt"]);
    expect(instructions).toContain(`${pageDirectory}/1.yml`);
    expect(instructions).toContain(`${pageDirectory}/2.yml`);
    expect(instructions).toContain(removedSchematic);
    expect(workspace.remoteRevision).toBe(1);
    expect(workspaceChangeSummary(workspace)).toEqual(changesBefore);
    expect(workspaceHasChanges(workspace)).toBe(true);
    expect(workspace.files.every((session) => !session.exported)).toBe(true);
    expect(workspace.removedFilesExported).toBe(false);
    expect(workspace.supportFilesExported).toBe(false);
    expect(workspace.originalArchiveBytes).toEqual(archive);
  });

  it("adds, replaces, and removes files in the server's schematic folders", async () => {
    const firstPath = "schematics/turrets/arrow/1.schematic";
    const thirdPath = "schematics/turrets/arrow/3.schematic";
    const originalZip = await remoteArchive({
      yaml: {
        "enginehub.yml": encoder.encode("worldedit:\n  schematics:\n    enabled: true\n"),
        "Turrets/arrow.yml": encoder.encode("max-level: 3\n")
      },
      schematics: {
        [firstPath]: Uint8Array.from([1, 2, 3, 4]),
        [thirdPath]: Uint8Array.from([5, 6, 7, 8])
      },
      schematicDirectories: [{ path: "schematics/turrets/arrow", config: "Turrets/arrow.yml" }]
    });
    const workspace = await openWorkspaceArtifact({
      name: "server-configs.zip",
      bytes: originalZip,
      remoteProtocol: 1
    });

    expect(workspaceSchematicFiles(workspace).map((entry) => entry.path)).toEqual([firstPath, thirdPath]);
    await replaceWorkspaceSchematic(
      workspace,
      firstPath,
      new File([Uint8Array.from([9])], "replacement.schematic")
    );
    removeWorkspaceSchematic(workspace, thirdPath);
    await addWorkspaceSchematic(
      workspace,
      "schematics/turrets/arrow",
      2,
      new File([Uint8Array.from([8])], "added.schem"),
      { maxLevel: 3 }
    );

    const turret = selectWorkspaceFile(workspace, "Turrets/arrow.yml");
    replaceDocumentValue(turret.document, ["max-level"], "3");
    const output = unzipSync(new Uint8Array(await (await workspaceDownloadArtifact(workspace)).blob.arrayBuffer()));

    expect(output[firstPath]).toEqual(Uint8Array.from([9]));
    expect(output["schematics/turrets/arrow/2.schem"]).toEqual(Uint8Array.from([8]));
    expect(output[thirdPath]).toBeUndefined();
  });

  it("adds the first level to an empty server schematic folder", async () => {
    const archive = await remoteArchive({
      yaml: { "Structures/nexus.yml": encoder.encode("max-level: 3\n") },
      schematicDirectories: [{ path: "schematics/structures/nexus", config: "Structures/nexus.yml" }]
    });
    const workspace = await openWorkspaceArtifact({
      name: "server-configs.zip",
      bytes: archive,
      remoteProtocol: 1
    });

    await addWorkspaceSchematic(
      workspace,
      "schematics/structures/nexus",
      1,
      new File([Uint8Array.from([1, 2, 3])], "nexus.schematic"),
      { maxLevel: 3 }
    );
    const output = unzipSync(new Uint8Array(await (await workspaceDownloadArtifact(workspace)).blob.arrayBuffer()));

    expect(output["schematics/structures/nexus/1.schematic"]).toEqual(Uint8Array.from([1, 2, 3]));
  });

  it("rejects unexpected, missing, changed, and non-editable server files", async () => {
    const yaml = { "config.yml": encoder.encode("enabled: true\n") };
    const schematicPath = "schematics/structures/nexus/1.schem";
    const schematic = Uint8Array.from([1, 2, 3]);
    const undeclared = await remoteArchive({ yaml, extra: { [schematicPath]: schematic } });
    await expect(openWorkspaceArtifact({
      name: "server-configs.zip",
      bytes: undeclared,
      remoteProtocol: 1
    })).rejects.toThrow("unexpected file");

    const wrongHash = await remoteArchive({
      yaml: { ...yaml, "Structures/nexus.yml": encoder.encode("max-level: 3\n") },
      schematics: { [schematicPath]: schematic },
      manifestFiles: [
        { path: "config.yml", sha256: await sha256Hex(yaml["config.yml"]) },
        { path: "Structures/nexus.yml", sha256: await sha256Hex(encoder.encode("max-level: 3\n")) },
        { path: schematicPath, sha256: "0".repeat(64) }
      ],
      schematicDirectories: [{ path: "schematics/structures/nexus", config: "Structures/nexus.yml" }]
    });
    await expect(openWorkspaceArtifact({
      name: "server-configs.zip",
      bytes: wrongHash,
      remoteProtocol: 1
    })).rejects.toThrow("does not match the file list");

    const missing = await remoteArchive({
      yaml: { ...yaml, "Structures/nexus.yml": encoder.encode("max-level: 3\n") },
      manifestFiles: [
        { path: "config.yml", sha256: await sha256Hex(yaml["config.yml"]) },
        { path: "Structures/nexus.yml", sha256: await sha256Hex(encoder.encode("max-level: 3\n")) },
        { path: schematicPath, sha256: await sha256Hex(schematic) }
      ],
      schematicDirectories: [{ path: "schematics/structures/nexus", config: "Structures/nexus.yml" }]
    });
    await expect(openWorkspaceArtifact({
      name: "server-configs.zip",
      bytes: missing,
      remoteProtocol: 1
    })).rejects.toThrow(`did not include ${schematicPath}`);

    const valid = await remoteArchive({ yaml });
    const workspace = await openWorkspaceArtifact({
      name: "server-configs.zip",
      bytes: valid,
      remoteProtocol: 1
    });
    expect(() => createWorkspaceFile(workspace, "extra.yml", "enabled: true\n"))
      .toThrow("Only declared outpost page folders");
    await expect(addWorkspaceSchematic(
      workspace,
      "schematics/structures/nexus",
      1,
      new File([schematic], "added.schematic")
    )).rejects.toThrow("not editable");

    replaceDocumentValue(selectWorkspaceFile(workspace, "config.yml").document, ["enabled"], "false");
    workspace.archiveEntries.push({ path: "notes.txt", bytes: Uint8Array.from([9]) });
    await expect(workspaceDownloadArtifact(workspace)).rejects.toThrow("cannot be added");
  });

  it("requires each server schematic folder to match its building config", async () => {
    const schematicPath = "addons/schematics/structures/nexus/1.schematic";
    const archive = await remoteArchive({
      yaml: { "Structures/nexus.yml": encoder.encode("max-level: 3\n") },
      schematics: { [schematicPath]: Uint8Array.from([1, 2, 3]) },
      schematicDirectories: [{
        path: "addons/schematics/structures/nexus",
        config: "Structures/nexus.yml"
      }]
    });

    await expect(openWorkspaceArtifact({
      name: "server-configs.zip",
      bytes: archive,
      remoteProtocol: 1
    })).rejects.toThrow("invalid information for a schematic folder");
  });

  it("reopens a saved server version with changed YAML and schematic files", async () => {
    const originalYaml = encoder.encode("enabled: true\n");
    const editedYaml = encoder.encode("enabled: false\n");
    const config = encoder.encode("max-level: 2\n");
    const firstPath = "schematics/structures/nexus/1.schematic";
    const manifestFiles = [
      { path: "config.yml", sha256: await sha256Hex(originalYaml) },
      { path: "Structures/nexus.yml", sha256: await sha256Hex(config) },
      { path: firstPath, sha256: await sha256Hex(Uint8Array.from([1])) }
    ];
    const schematicDirectories = [{ path: "schematics/structures/nexus", config: "Structures/nexus.yml" }];
    const original = await remoteArchive({
      yaml: { "config.yml": originalYaml, "Structures/nexus.yml": config },
      schematics: { [firstPath]: Uint8Array.from([1]) },
      manifestFiles,
      schematicDirectories
    });
    const result = await remoteArchive({
      yaml: { "config.yml": editedYaml, "Structures/nexus.yml": config },
      schematics: {
        [firstPath]: Uint8Array.from([9]),
        "schematics/structures/nexus/2.schem": Uint8Array.from([8])
      },
      manifestFiles,
      schematicDirectories
    });
    const workspace = await openWorkspaceArtifact({
      name: "server-configs.zip",
      bytes: result,
      remoteProtocol: 1,
      remoteRevision: 1,
      originalBytes: original
    });

    expect(activeSession(workspace).document.currentText).toBe("enabled: false\n");
    expect(workspaceSchematicFiles(workspace).map((entry) => entry.path)).toEqual([
      firstPath,
      "schematics/structures/nexus/2.schem"
    ]);
  });

  it("rejects a later server result that changes the original file list", async () => {
    const original = await remoteArchive({
      yaml: { "config.yml": encoder.encode("enabled: true\n") }
    });
    const result = await remoteArchive({
      yaml: { "config.yml": encoder.encode("enabled: false\n") }
    });

    await expect(openWorkspaceArtifact({
      name: "server-configs.zip",
      bytes: result,
      remoteProtocol: 1,
      remoteRevision: 1,
      originalBytes: original
    })).rejects.toThrow("editor file list cannot be changed");
  });

  it("adds, renames, and removes outpost pages only in the server's outpost folders", async () => {
    const directory = "guis/en/structures/outpost";
    const archive = await remoteArchive({
      yaml: {
        [`${directory}/1.yml`]: encoder.encode("options: {}\n"),
        [`${directory}/2.yml`]: encoder.encode("options:\n  second: {}\n")
      },
      outpostPageDirectories: [directory]
    });
    const workspace = await openWorkspaceArtifact({
      name: "server-configs.zip",
      bytes: archive,
      remoteProtocol: 1
    });

    createWorkspaceFile(workspace, `${directory}/3.yml`, "options: {}\n");
    removeWorkspaceFile(workspace, `${directory}/1.yml`);
    renameWorkspaceFile(workspace, `${directory}/2.yml`, `${directory}/1.yml`);
    renameWorkspaceFile(workspace, `${directory}/3.yml`, `${directory}/2.yml`);
    expect(() => createWorkspaceFile(workspace, "extra.yml", "enabled: true\n"))
      .toThrow("Only declared outpost page folders");
    expect(() => renameWorkspaceFile(workspace, `${directory}/1.yml`, "guis/fr/structures/outpost/1.yml"))
      .toThrow("Only declared outpost page folders");

    const output = unzipSync(new Uint8Array(await (await workspaceDownloadArtifact(workspace)).blob.arrayBuffer()));
    expect(Object.keys(output).filter((path) => path.startsWith(directory)).sort()).toEqual([
      `${directory}/1.yml`,
      `${directory}/2.yml`
    ]);
  });

  it("rejects invalid schematic levels and empty outpost folders in later server results", async () => {
    const config = encoder.encode("max-level: 3\n");
    const schematicCapability = [{ path: "schematics/structures/nexus", config: "Structures/nexus.yml" }];
    const manifestFiles = [{ path: "Structures/nexus.yml", sha256: await sha256Hex(config) }];
    const schematicOriginal = await remoteArchive({
      yaml: { "Structures/nexus.yml": config },
      manifestFiles,
      schematicDirectories: schematicCapability
    });
    const duplicateLevel = await remoteArchive({
      yaml: { "Structures/nexus.yml": config },
      schematics: {
        "schematics/structures/nexus/1.schematic": Uint8Array.from([1]),
        "schematics/structures/nexus/1.schem": Uint8Array.from([2])
      },
      manifestFiles,
      schematicDirectories: schematicCapability
    });
    await expect(openWorkspaceArtifact({
      name: "server-configs.zip",
      bytes: duplicateLevel,
      remoteProtocol: 1,
      remoteRevision: 1,
      originalBytes: schematicOriginal
    })).rejects.toThrow("more than one schematic for level 1");

    const missingLevelOne = await remoteArchive({
      yaml: { "Structures/nexus.yml": config },
      schematics: { "schematics/structures/nexus/2.schematic": Uint8Array.from([2]) },
      manifestFiles,
      schematicDirectories: schematicCapability
    });
    await expect(openWorkspaceArtifact({
      name: "server-configs.zip",
      bytes: missingLevelOne,
      remoteProtocol: 1,
      remoteRevision: 1,
      originalBytes: schematicOriginal
    })).rejects.toThrow("must include a level 1 schematic");

    const directory = "guis/en/structures/outpost";
    const fixedConfig = encoder.encode("enabled: true\n");
    const page = encoder.encode("options: {}\n");
    const emptyOutpost = await remoteArchive({
      yaml: { "config.yml": fixedConfig },
      manifestFiles: [
        { path: "config.yml", sha256: await sha256Hex(fixedConfig) },
        { path: `${directory}/1.yml`, sha256: await sha256Hex(page) }
      ],
      outpostPageDirectories: [directory]
    });
    const outpostOriginal = await remoteArchive({
      yaml: {
        "config.yml": fixedConfig,
        [`${directory}/1.yml`]: page
      },
      manifestFiles: [
        { path: "config.yml", sha256: await sha256Hex(fixedConfig) },
        { path: `${directory}/1.yml`, sha256: await sha256Hex(page) }
      ],
      outpostPageDirectories: [directory]
    });
    await expect(openWorkspaceArtifact({
      name: "server-configs.zip",
      bytes: emptyOutpost,
      remoteProtocol: 1,
      remoteRevision: 1,
      originalBytes: outpostOriginal
    })).rejects.toThrow("must keep at least one outpost page");
  });

  it("creates, renames, and deletes config files in the downloaded ZIP", async () => {
    const originalZip = zipSync({
      "guis/en/structures/outpost/1.yml": encoder.encode("options: {}\n"),
      "guis/en/structures/outpost/2.yml": encoder.encode("options: {}\n"),
      "guis/en/structures/outpost/3.yml": encoder.encode("options:\n  third: {}\n")
    });
    const workspace = await openWorkspaceSelection([new File([originalZip], "configs.zip")]);

    createWorkspaceFile(workspace, "guis/en/structures/outpost/4.yml", "options: {}\n");
    removeWorkspaceFile(workspace, "guis/en/structures/outpost/2.yml");
    renameWorkspaceFile(
      workspace,
      "guis/en/structures/outpost/3.yml",
      "guis/en/structures/outpost/2.yml"
    );
    renameWorkspaceFile(
      workspace,
      "guis/en/structures/outpost/4.yml",
      "guis/en/structures/outpost/3.yml"
    );

    expect(workspaceChangeSummary(workspace)).toEqual({ files: 3, changes: 3 });
    expect(workspaceFileChanges(workspace).map(({ kind, path }) => ({ kind, path }))).toEqual([
      { kind: "File", path: "guis/en/structures/outpost/2.yml" },
      { kind: "File", path: "guis/en/structures/outpost/3.yml" },
      { kind: "File", path: "guis/en/structures/outpost/2.yml" }
    ]);

    const artifact = await workspaceDownloadArtifact(workspace);
    const output = unzipSync(new Uint8Array(await artifact.blob.arrayBuffer()));
    expect(Object.keys(output).sort()).toEqual([
      "guis/en/structures/outpost/1.yml",
      "guis/en/structures/outpost/2.yml",
      "guis/en/structures/outpost/3.yml"
    ]);
    expect(decoder.decode(output["guis/en/structures/outpost/2.yml"]))
      .toBe("options:\n  third: {}\n");
  });

  it("rejects unsafe paths, duplicate selections, mixed ZIP selections, and empty archives", async () => {
    const unsafeZip = zipSync({ "../outside.yml": encoder.encode("bad: true\n") });
    await expect(openWorkspaceSelection([new File([unsafeZip], "unsafe.zip")])).rejects.toThrow("not safe");

    const duplicate = new File(["a: 1\n"], "config.yml");
    await expect(openWorkspaceSelection([duplicate, duplicate])).rejects.toThrow("more than one file");

    const zip = new File([zipSync({ "config.yml": encoder.encode("a: 1\n") })], "configs.zip");
    await expect(openWorkspaceSelection([zip, duplicate])).rejects.toThrow("by itself");

    const noYaml = new File([zipSync({ "readme.txt": encoder.encode("hello") })], "docs.zip");
    await expect(openWorkspaceSelection([noYaml])).rejects.toThrow("does not contain");
  });

  it("rejects unsupported files and oversized individual YAML files", async () => {
    await expect(openWorkspaceSelection([new File(["hello"], "notes.txt")])).rejects.toThrow("not a .yml");
    const oversized = new File([new Uint8Array(10 * 1024 * 1024 + 1)], "large.yml");
    await expect(openWorkspaceSelection([oversized])).rejects.toThrow("10 MiB");
  });
});

async function remoteArchive({
  yaml,
  schematics = {},
  extra = {},
  manifestFiles = null,
  schematicDirectories = [],
  outpostPageDirectories = []
}) {
  const originalFiles = { ...yaml, ...schematics };
  const files = manifestFiles ?? await Promise.all(Object.entries(originalFiles).map(async ([path, bytes]) => ({
    path,
    sha256: await sha256Hex(bytes)
  })));
  const manifest = encoder.encode(JSON.stringify({
    protocol: 1,
    pluginVersion: "1.17.27.1",
    files,
    capabilities: {
      schematicDirectories,
      outpostPageDirectories
    }
  }));

  return zipSync({
    ...yaml,
    ...schematics,
    ...extra,
    "kingdomsx-editor.json": manifest
  });
}
