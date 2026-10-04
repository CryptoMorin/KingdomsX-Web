import { describe, expect, it } from "vitest";
import { parseAnchorName } from "./kingdoms-yaml.js";
import {
  addDocumentAnchor,
  canAddDocumentAnchor,
  canReuseDocumentAnchor,
  createSourceDocument,
  detachDocumentAlias,
  detachDocumentAliasSource,
  documentAnnotationChanged,
  documentAnchorChanged,
  documentBytes,
  expandDocumentMessageEntry,
  formatSimpleSequence,
  formatStringLiteral,
  indexYamlSource,
  insertDocumentConditionalValue,
  insertDocumentMapping,
  insertDocumentMappingTree,
  insertDocumentValue,
  moveDocumentMappingEntry,
  parseSimpleLiteral,
  renameDocumentAnchor,
  removeDocumentAnchor,
  removeDocumentEntry,
  renameDocumentKey,
  reusableValueShape,
  reuseDocumentAnchor,
  addDocumentSequenceItemAnchor,
  detachDocumentSequenceItemAlias,
  reuseDocumentSequenceItemAnchor,
  removeDocumentSequenceItemAnchor,
  sequenceItemAnchorDefinitions,
  setDocumentAnnotation,
  replaceDocumentLiteral,
  replaceDocumentSource,
  replaceDocumentValue,
  undoDocumentAliasDetach,
  undoDocumentAnchorAddition,
  undoDocumentAnchorRemoval,
  undoDocumentAnchorReuse,
  undoDocumentAnchorRename,
  undoDocumentAnnotationChange,
  undoDocumentMessageExpansion
} from "./yaml-source.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

describe("Kingdoms YAML source documents", () => {
  it("indexes custom functions without interpreting them", () => {
    const source = [
      "# Permission function",
      "permissions:",
      "  alliance: *fn-std-perm [\"Alliance\"]",
      "  merge:",
      "    <<: *fn-base [60, EMERALD]",
      "enabled: true # keep this comment",
      ""
    ].join("\n");
    const index = indexYamlSource(source);

    expect(index.byPath.get("permissions\u0000alliance").source).toBe('*fn-std-perm ["Alliance"]');
    expect(index.byPath.get("permissions\u0000alliance").advancedOnly).toBe(true);
    expect(index.byPath.get("enabled").source).toBe("true");
  });

  it("classifies functions, merges, and Kingdoms annotations", () => {
    const source = [
      "# [Final]",
      "cost: *fn-base [60, EMERALD]",
      "lines:",
      "  - before",
      "  - <: *argument",
      "  - <<: *shared",
      "  - after",
      ""
    ].join("\n");
    const index = indexYamlSource(source);
    const cost = index.byPath.get("cost");
    const lines = index.byPath.get("lines");

    expect(cost.syntax.kind).toBe("function-call");
    expect(cost.annotations.map((annotation) => annotation.id)).toEqual(["final"]);
    expect(lines.collectionItems.map((item) => item.syntax?.kind ?? null)).toEqual([null, "sequence-merge", "sequence-merge", null]);
    expect(canAddDocumentAnchor(cost)).toBe(false);
  });

  it("keeps message syntax classification without showing redundant syntax pills", () => {
    const index = indexYamlSource([
      "interactive: 'hover:{Click me;show_text:Details}'",
      "conditional: '{? is_member ? yes : no}'",
      ""
    ].join("\n"));

    expect(index.byPath.get("interactive").syntax).toMatchObject({
      kind: "interactive-message",
      showBadge: false
    });
    expect(index.byPath.get("conditional").syntax).toMatchObject({
      kind: "conditional-message",
      showBadge: false
    });
  });

  it("finds module parameters by declaration instead of assuming angle brackets", () => {
    const source = [
      "(module):",
      "  parameters:",
      "    '@material@': Material",
      "item-@material@:",
      "  material: '@material@'",
      "  inherited: '[*shared-item]'",
      ""
    ].join("\n");
    const index = indexYamlSource(source);

    expect(index.byPath.get("item-@material@").syntax?.kind).toBe("module-template");
    expect(index.byPath.get("item-@material@\u0000material").syntax?.kind).toBe("module-template");
    expect(index.byPath.get("item-@material@\u0000inherited").syntax?.kind).toBe("imported-anchor-template");
    expect(index.byPath.get("(module)\u0000parameters\u0000@material@").syntax).toBeNull();
  });

  it("keeps anchored mapping children under their actual parent", () => {
    const source = "'[fn-one]': &fn-one\n  args: [one]\n  return:\n    enabled: true\n'[fn-two]': &fn-two\n  args: [two]\n";
    const index = indexYamlSource(source);

    expect(index.byPath.has("[fn-one]\u0000args")).toBe(true);
    expect(index.byPath.has("[fn-one]\u0000return\u0000enabled")).toBe(true);
    expect(index.byPath.has("[fn-two]\u0000args")).toBe(true);
    expect(index.byPath.has("args")).toBe(false);
  });

  it("edits a simple anchored sequence as typed list rows", () => {
    const source = "commands:\n  enabled: &enabled-commands\n    - say hello\n    - *shared-command\n  disabled: false\n";
    const document = createSourceDocument("config.yml", encoder.encode(source));
    const enabled = document.index.byPath.get("commands\u0000enabled");

    expect(enabled).toMatchObject({ container: false, complexSequence: false, advancedOnly: false, sequencePrefix: "&enabled-commands" });
    expect(enabled.collectionItems.map((item) => item.source)).toEqual(["say hello", "*shared-command"]);
    expect(enabled.source).toBe("&enabled-commands\n    - say hello\n    - *shared-command\n");
    expect(document.index.byPath.has("commands\u0000disabled")).toBe(true);

    replaceDocumentValue(document, ["commands", "enabled"], formatSimpleSequence(enabled, ["say hello", "*other-command"], (value) => value));
    expect(document.currentText).toContain("enabled: &enabled-commands\n    - say hello\n    - *other-command\n");
  });

  it("keeps anchors declared on individual list values editable", () => {
    const source = 'lines:\n  - &location "Location: 1, 2, 3"\n  - *location\n';
    const document = createSourceDocument("map.yml", encoder.encode(source));
    const lines = document.index.byPath.get("lines");

    expect(lines).toMatchObject({ complexSequence: false, advancedOnly: false });
    expect(lines.collectionItems.map((item) => item.syntax?.kind)).toEqual(["anchor", "alias"]);
  });

  it("patches only the scalar value range", () => {
    const source = "# heading\r\nenabled: true # explanation\r\namount: 10\r\n";
    const document = createSourceDocument("config.yml", encoder.encode(source));

    replaceDocumentValue(document, ["amount"], "25");

    expect(document.currentText).toBe("# heading\r\nenabled: true # explanation\r\namount: 25\r\n");
    expect(decoder.decode(documentBytes(document))).toBe(document.currentText);
  });

  it("returns original bytes when a file was not changed", () => {
    const original = new Uint8Array([0xef, 0xbb, 0xbf, ...encoder.encode("enabled: true\n")]);
    const document = createSourceDocument("config.yml", original);

    expect(documentBytes(document)).toBe(original);
  });

  it("adds and removes a missing scalar override under an existing mapping", () => {
    const document = createSourceDocument("config.yml", encoder.encode("database:\n  method: sqlite\nnext: true\n"));

    insertDocumentValue(document, ["database", "username"], '"kingdoms"');
    expect(document.currentText).toBe('database:\n  method: sqlite\n  username: "kingdoms"\nnext: true\n');

    removeDocumentEntry(document, ["database", "username"]);
    expect(document.currentText).toBe("database:\n  method: sqlite\nnext: true\n");
  });

  it("adds an empty mapping key that can be renamed after choosing its value", () => {
    const source = "custom-items:\n  sample:\n    enchants: {}\n";
    const document = createSourceDocument("resource-points.yml", encoder.encode(source));

    insertDocumentValue(document, ["custom-items", "sample", "enchants", ""], "1");
    expect(document.currentText).toBe([
      "custom-items:",
      "  sample:",
      "    enchants:",
      '      "": 1',
      ""
    ].join("\n"));

    renameDocumentKey(document, ["custom-items", "sample", "enchants", ""], "sharpness");
    expect(document.currentText).toContain("      sharpness: 1\n");
    expect(document.index.byPath.has("custom-items\u0000sample\u0000enchants\u0000sharpness")).toBe(true);
  });

  it("adds conditional outputs before the optional else fallback", () => {
    const source = "groupColor:\n  perm_color_admin: '&6'\n  else: '&r'\n";
    const document = createSourceDocument("config.yml", encoder.encode(source));

    insertDocumentConditionalValue(document, ["groupColor", "perm_color_owner"], "'&4'");

    expect(document.currentText).toBe(
      "groupColor:\n  perm_color_admin: '&6'\n  perm_color_owner: '&4'\n  else: '&r'\n"
    );
  });

  it("adds a structured mapping entry from an existing item without changing its nesting", () => {
    const source = "ranks:\n  member:\n    name: Member\n    permissions: [ BUILD ]\nnext: true\n";
    const document = createSourceDocument("ranks.yml", encoder.encode(source));
    const template = document.index.byPath.get("ranks\u0000member");

    insertDocumentValue(document, ["ranks", "helper"], template.source);

    expect(document.currentText).toBe(
      "ranks:\n  member:\n    name: Member\n    permissions: [ BUILD ]\n  helper:\n    name: Member\n    permissions: [ BUILD ]\nnext: true\n"
    );
    expect(document.index.byPath.has("ranks\u0000helper\u0000permissions")).toBe(true);
  });

  it("adds a new mapping with starter fields as one removable change", () => {
    const source = "options:\n  existing:\n    material: DIAMOND\nnext: true\n";
    const document = createSourceDocument("gui.yml", encoder.encode(source));

    insertDocumentMapping(document, ["options", "new-button"], [
      ["name", '"&fNew Button"'],
      ["material", "STONE"],
      ["posx", "1"],
      ["posy", "1"]
    ]);

    expect(document.currentText).toBe([
      "options:",
      "  existing:",
      "    material: DIAMOND",
      "  new-button:",
      '    name: "&fNew Button"',
      "    material: STONE",
      "    posx: 1",
      "    posy: 1",
      "next: true",
      ""
    ].join("\n"));
    expect(document.changes.size).toBe(1);
    expect(document.index.byPath.has("options\u0000new-button\u0000material")).toBe(true);

    removeDocumentEntry(document, ["options", "new-button"]);
    expect(document.currentText).toBe(source);
  });

  it("uses the file's indentation and line endings for a starter mapping", () => {
    const document = createSourceDocument("gui.yml", encoder.encode("options:\r\n    existing:\r\n        material: DIAMOND\r\n"));

    insertDocumentMapping(document, ["options", "new-button"], [["material", "STONE"]]);

    expect(document.currentText).toContain("    new-button:\r\n        material: STONE\r\n");
  });

  it("adds a nested structured starter as one mapping change", () => {
    const document = createSourceDocument("turrets.yml", encoder.encode("effects: {}\n"));

    insertDocumentMappingTree(document, ["effects", "custom"], [
      { key: "sound", source: '""' },
      {
        key: "particles",
        children: [
          { key: "particle", source: '""' },
          { key: "count", source: "0" },
          { key: "offset", source: '""' },
          { key: "color", source: '""' },
          { key: "size", source: "0" }
        ]
      }
    ]);

    expect(document.currentText).toBe([
      "effects:",
      "  custom:",
      '    sound: ""',
      "    particles:",
      '      particle: ""',
      "      count: 0",
      '      offset: ""',
      '      color: ""',
      "      size: 0",
      ""
    ].join("\n"));
    expect(document.index.byPath.has("effects\u0000custom\u0000particles\u0000color")).toBe(true);
    expect(document.changes.size).toBe(1);
  });

  it("keeps files with mixed line endings read-only in the form", () => {
    const document = createSourceDocument("config.yml", encoder.encode("one: true\r\ntwo: false\n"));
    expect(document.editable).toBe(false);
    expect(document.warnings[0]).toContain("mixes different line endings");
  });

  it("keeps YAML features unsupported by Kingdoms read-only with a clear warning", () => {
    for (const source of ["---\nenabled: true\n", "%YAML 1.2\nenabled: true\n", "value: !custom tagged\n"]) {
      const document = createSourceDocument("config.yml", encoder.encode(source));
      expect(document.editable).toBe(false);
      expect(document.warnings.join(" ")).toContain("KingdomsX");
    }
  });

  it("treats block-scalar content as one advanced-edit range", () => {
    const source = "message: |-\n  first line\n  second line\nenabled: true\n";
    const index = indexYamlSource(source);
    const message = index.byPath.get("message");

    expect(message.advancedOnly).toBe(true);
    expect(message.source).toContain("second line");
    expect(index.byPath.get("enabled").source).toBe("true");
  });

  it("indexes and patches a simple block list as one source range", () => {
    const source = "worlds:\n  - world\n  - 'resource world'\nenabled: true\n";
    const document = createSourceDocument("config.yml", encoder.encode(source));
    const worlds = document.index.byPath.get("worlds");

    expect(worlds.collectionItems.map((item) => item.source)).toEqual(["world", "'resource world'"]);
    replaceDocumentValue(document, ["worlds"], formatSimpleSequence(worlds, ["world_nether", "resource world"]));
    expect(document.currentText).toBe("worlds:\n  - world_nether\n  - 'resource world'\nenabled: true\n");
  });

  it("stops a simple list before comments belonging to the next option", () => {
    const source = "list:\n  - STICK\n  - STRING\n\n# Resource points given per item.\ncustom:\n  GOLD: 4\n";
    const document = createSourceDocument("resource-points.yml", encoder.encode(source));
    const list = document.index.byPath.get("list");

    expect(list.collectionItems.map((item) => item.source)).toEqual(["STICK", "STRING"]);
    expect(list.source).not.toContain("Resource points");

    replaceDocumentValue(document, ["list"], formatSimpleSequence(list, ["STICK", "DIAMOND"]));
    expect(document.currentText).toBe("list:\n  - STICK\n  - DIAMOND\n\n# Resource points given per item.\ncustom:\n  GOLD: 4\n");
  });

  it("keeps comments inside a block list while presenting and editing its items", () => {
    const source = [
      "list:",
      "  # Plugin commands",
      "  - k home",
      "  - k spawn",
      "",
      "  # Vanilla commands",
      "  - gamemode",
      "next: true",
      ""
    ].join("\n");
    const document = createSourceDocument("invasions.yml", encoder.encode(source));
    const list = document.index.byPath.get("list");

    expect(list.collectionItems.map((item) => item.source)).toEqual(["k home", "k spawn", "gamemode"]);
    replaceDocumentValue(document, ["list"], formatSimpleSequence(list, ["k home", "k fly", "gamemode"]));
    expect(document.currentText).toContain("  # Plugin commands\n  - k home\n  - k fly");
    expect(document.currentText).toContain("  # Vanilla commands\n  - gamemode\nnext: true");
  });

  it("edits an inline list with the visual collection control", () => {
    const document = createSourceDocument("config.yml", encoder.encode("disabled-worlds: [] # preserved\n"));
    const worlds = document.index.byPath.get("disabled-worlds");

    expect(worlds.collectionItems).toEqual([]);
    expect(worlds.advancedOnly).toBe(false);
    replaceDocumentValue(document, ["disabled-worlds"], formatSimpleSequence(worlds, ["world", "world_nether"]));
    expect(document.currentText).toBe("disabled-worlds: [world, world_nether] # preserved\n");
  });

  it("indexes a multiline flow list as one editable collection", () => {
    const source = "permissions: [ NEXUS, BUILD, HOME,\n               INVADE, INTERACT, USE ]\nnext: true\n";
    const document = createSourceDocument("ranks.yml", encoder.encode(source));
    const permissions = document.index.byPath.get("permissions");

    expect(permissions.collectionItems.map((item) => item.source)).toEqual([
      "NEXUS", "BUILD", "HOME", "INVADE", "INTERACT", "USE"
    ]);
    expect(permissions.source).toContain("INVADE, INTERACT, USE ]");
    replaceDocumentValue(document, ["permissions"], formatSimpleSequence(permissions, ["NEXUS", "BUILD"]));
    expect(document.currentText).toBe("permissions: [ NEXUS, BUILD ]\nnext: true\n");
  });

  it("preserves an anchor prefix while editing a flow list", () => {
    const source = "permissions: &member-perms [ NEXUS, BUILD ]\n";
    const document = createSourceDocument("ranks.yml", encoder.encode(source));
    const permissions = document.index.byPath.get("permissions");

    expect(permissions.collectionItems.map((item) => item.source)).toEqual(["NEXUS", "BUILD"]);
    replaceDocumentValue(document, ["permissions"], formatSimpleSequence(permissions, ["NEXUS", "HOME"]));
    expect(document.currentText).toBe("permissions: &member-perms [ NEXUS, HOME ]\n");
  });

  it("indexes function calls and imported anchors as editable flow-list rows", () => {
    const source = "anchors: [ &local remote, *fn-copy [one, [two, three]] ]\n";
    const document = createSourceDocument("module.yml", encoder.encode(source));
    const anchors = document.index.byPath.get("anchors");

    expect(anchors.collectionItems.map((item) => item.syntax?.kind)).toEqual(["imported-anchor", "function-call"]);
    replaceDocumentValue(document, ["anchors"], formatSimpleSequence(anchors, ["&renamed remote", "*fn-copy [ one, [two, three] ]"], (value) => value));
    expect(document.currentText).toBe("anchors: [ &renamed remote, *fn-copy [ one, [two, three] ] ]\n");
  });

  it("preserves multiline flow-list wrapping when editing an existing item", () => {
    const source = "permissions: [ NEXUS, BUILD, HOME,\n               INVADE, INTERACT, USE ]\n";
    const document = createSourceDocument("ranks.yml", encoder.encode(source));
    const permissions = document.index.byPath.get("permissions");

    replaceDocumentValue(document, ["permissions"], formatSimpleSequence(
      permissions,
      ["NEXUS", "BUILD", "HOME", "INVADE", "INTERACT", "READ_MAILS"]
    ));

    expect(document.currentText).toBe("permissions: [ NEXUS, BUILD, HOME,\n               INVADE, INTERACT, READ_MAILS ]\n");
  });

  it("keeps multiline flow-list separators when adding or removing entries", () => {
    const source = "permissions: [ NEXUS, BUILD, HOME,\n               INVADE, INTERACT, USE ]\n";
    const document = createSourceDocument("ranks.yml", encoder.encode(source));
    let permissions = document.index.byPath.get("permissions");

    replaceDocumentValue(document, ["permissions"], formatSimpleSequence(
      permissions,
      ["NEXUS", "BUILD", "HOME", "INVADE", "INTERACT", "USE", "READ_MAILS"]
    ));
    expect(document.currentText).toBe("permissions: [ NEXUS, BUILD, HOME,\n               INVADE, INTERACT, USE, READ_MAILS ]\n");

    permissions = document.index.byPath.get("permissions");
    replaceDocumentValue(document, ["permissions"], formatSimpleSequence(
      permissions,
      ["NEXUS", "BUILD", "HOME", "INVADE", "USE", "READ_MAILS"]
    ));
    expect(document.currentText).toBe("permissions: [ NEXUS, BUILD, HOME,\n               INVADE, USE, READ_MAILS ]\n");
  });

  it("can move list values together with their original scalar formatting", () => {
    const document = createSourceDocument("config.yml", encoder.encode("items: [plain, 'single quoted', \"double quoted\"]\n"));
    const items = document.index.byPath.get("items");
    const reordered = [...items.collectionItems].reverse();
    const values = reordered.map((item) => String(parseSimpleLiteral(item.source).value));

    const replacement = formatSimpleSequence(
      items,
      values,
      (value, original, index) => formatStringLiteral(value, reordered[index]?.source ?? original)
    );

    expect(replacement).toBe('["double quoted", \'single quoted\', plain]');
  });

  it("replaces a custom Kingdoms literal without parsing or reformatting it", () => {
    const document = createSourceDocument("config.yml", encoder.encode('cost: *fn-base [60, EMERALD] # keep\n'));

    replaceDocumentLiteral(document, ["cost"], '*fn-base [90, GOLD]');

    expect(document.currentText).toBe('cost: *fn-base [90, GOLD] # keep\n');
  });

  it("creates missing parent mappings when adding a nested override", () => {
    const document = createSourceDocument("config.yml", encoder.encode("enabled: true\n"));

    insertDocumentValue(document, ["database", "credentials", "username"], '"kingdoms"');

    expect(document.currentText).toBe('enabled: true\ndatabase:\n  credentials:\n    username: "kingdoms"\n');

    removeDocumentEntry(document, ["database", "credentials", "username"]);
    expect(document.currentText).toBe("enabled: true\n");
  });

  it("expands a scalar message with a sound and restores the exact original source", () => {
    const source = 'join: "Welcome, {player}" # Keep this note.\nnext: value\n';
    const document = createSourceDocument("en.yml", encoder.encode(source));

    expandDocumentMessageEntry(document, ["join"], "sound");

    expect(document.currentText).toBe([
      "join: # Keep this note.",
      '  message: "Welcome, {player}"',
      "  sound: BLOCK_NOTE_BLOCK_BASS, 1, 1",
      "next: value",
      ""
    ].join("\n"));
    expect(document.changes.get("join")).toMatchObject({ kind: "expanded-message", effect: "sound" });

    replaceDocumentValue(document, ["join", "sound"], "ENTITY_PLAYER_LEVELUP, 0.8, 1.2");
    expect(document.changes.get("join\u0000sound")).toMatchObject({
      kind: "changed-in-expanded-message",
      previousSource: "BLOCK_NOTE_BLOCK_BASS, 1, 1"
    });
    replaceDocumentValue(document, ["join", "sound"], "BLOCK_NOTE_BLOCK_BASS, 1, 1");
    expect(document.changes.has("join\u0000sound")).toBe(false);

    undoDocumentMessageExpansion(document, ["join"]);
    expect(document.currentText).toBe(source);
  });

  it("preserves block-scalar indentation when adding message delivery effects", () => {
    const source = "messages:\n  join: |\n    Welcome\n    back\n  next: value\n";
    const document = createSourceDocument("en.yml", encoder.encode(source));

    expandDocumentMessageEntry(document, ["messages", "join"], "titles");

    expect(document.currentText).toContain([
      "  join:",
      "    message: |",
      "      Welcome",
      "      back",
      "    titles:",
      '      title: ""',
      '      subtitle: ""',
      "      fade-in: 30",
      "      stay: 15",
      "      fade-out: 30"
    ].join("\n"));
    undoDocumentMessageExpansion(document, ["messages", "join"]);
    expect(document.currentText).toBe(source);
  });

  it("quotes custom mapping keys that YAML could interpret as another type", () => {
    const document = createSourceDocument("config.yml", encoder.encode("properties:\n  normal: value\n"));

    insertDocumentValue(document, ["properties", "<<"], '"custom"');

    expect(document.currentText).toContain('  "<<": "custom"');
    expect(document.index.byPath.has("properties\u0000<<")).toBe(true);
  });

  it("expands and restores an empty inline mapping while adding an entry", () => {
    const document = createSourceDocument("config.yml", encoder.encode("world-settings: {}\nnext: true\n"));

    insertDocumentValue(document, ["world-settings", "world_nether"], "false");
    expect(document.currentText).toBe("world-settings:\n  world_nether: false\nnext: true\n");

    removeDocumentEntry(document, ["world-settings", "world_nether"]);
    expect(document.currentText).toBe("world-settings: {}\nnext: true\n");
  });

  it("expands a spaced empty mapping without exposing it as a raw object value", () => {
    const document = createSourceDocument("config.yml", encoder.encode("conditions: { }\nnext: true\n"));
    expect(document.index.byPath.get("conditions").emptyMapping).toBe(true);

    insertDocumentValue(document, ["conditions", "is_member"], '"denied"');
    expect(document.currentText).toBe('conditions:\n  is_member: "denied"\nnext: true\n');

    removeDocumentEntry(document, ["conditions", "is_member"]);
    expect(document.currentText).toBe("conditions: { }\nnext: true\n");
  });

  it("removes a mapping together with its nested entries", () => {
    const document = createSourceDocument("config.yml", encoder.encode("database:\n  method: sqlite\n  settings:\n    cache: true\nnext: true\n"));

    removeDocumentEntry(document, ["database"]);

    expect(document.currentText).toBe("next: true\n");
    expect(document.changes.get("database").kind).toBe("removed");
  });

  it("renames a dynamic mapping key without touching its value, comment, or order", () => {
    const document = createSourceDocument("extractor.yml", encoder.encode([
      "conditions:",
      "  purchase:",
      "    # Keep this explanation.",
      "    'level < 3': '{$$kingdom-levels.III}'",
      "  upgrade: {}",
      ""
    ].join("\n")));

    const nextPath = renameDocumentKey(document, ["conditions", "purchase", "level < 3"], "level <= 4 && is_member");

    expect(nextPath).toEqual(["conditions", "purchase", "level <= 4 && is_member"]);
    expect(document.currentText).toBe([
      "conditions:",
      "  purchase:",
      "    # Keep this explanation.",
      "    \"level <= 4 && is_member\": '{$$kingdom-levels.III}'",
      "  upgrade: {}",
      ""
    ].join("\n"));
    expect(document.changes.get("conditions\u0000purchase\u0000level <= 4 && is_member")).toMatchObject({ kind: "renamed" });
  });

  it("edits both sides of an anchored condition without changing the anchor", () => {
    const document = createSourceDocument("powers.yml", encoder.encode([
      "conditions: &conditions",
      "  'lvl >= 20': '{$$kingdom-levels.II}'",
      ""
    ].join("\n")));

    const nextPath = renameDocumentKey(document, ["conditions", "lvl >= 20"], "lvl >= 25");
    replaceDocumentValue(document, nextPath, "'Reach kingdom level II'");

    expect(document.currentText).toBe([
      "conditions: &conditions",
      '  "lvl >= 25": \'Reach kingdom level II\'',
      ""
    ].join("\n"));
  });

  it("customizes anchored show-item markers without disturbing their links", () => {
    const document = createSourceDocument("chat.yml", encoder.encode([
      "show-item:",
      "  main-hand:",
      "    replace:",
      "      '[i]': &show-item 'Item'",
      "      '[item]': *show-item",
      "      '[show]': *show-item",
      ""
    ].join("\n")));

    renameDocumentKey(document, ["show-item", "main-hand", "replace", "[i]"], "[showthis]");
    insertDocumentValue(document, ["show-item", "main-hand", "replace", "[custom]"], "*show-item");

    expect(document.currentText).toBe([
      "show-item:",
      "  main-hand:",
      "    replace:",
      '      "[showthis]": &show-item \'Item\'',
      "      '[item]': *show-item",
      "      '[show]': *show-item",
      '      "[custom]": *show-item',
      ""
    ].join("\n"));
  });

  it("renames an anchor and every alias that resolves to that definition", () => {
    const source = [
      "base: &conditions",
      "  enabled: true",
      "first: *conditions",
      "list: [*conditions]",
      "message: '*conditions stays text'",
      "# *conditions stays a comment",
      "replacement: &conditions",
      "  enabled: false",
      "second: *conditions",
      ""
    ].join("\n");
    const document = createSourceDocument("config.yml", encoder.encode(source));

    renameDocumentAnchor(document, ["base"], "powerup-conditions");

    expect(document.currentText).toContain("base: &powerup-conditions\n");
    expect(document.currentText).toContain("first: *powerup-conditions\n");
    expect(document.currentText).toContain("list: [*powerup-conditions]\n");
    expect(document.currentText).toContain("message: '*conditions stays text'\n");
    expect(document.currentText).toContain("# *conditions stays a comment\n");
    expect(document.currentText).toContain("replacement: &conditions\n");
    expect(document.currentText).toContain("second: *conditions\n");
    expect(documentAnchorChanged(document, ["base"])).toBe(true);

    detachDocumentAlias(document, ["first"], ["base"]);
    expect(document.currentText).toContain("first:\n  enabled: true\n");
    expect(undoDocumentAliasDetach(document, ["first"])).toBe(true);
    expect(document.currentText).toContain("first: *powerup-conditions\n");

    expect(undoDocumentAnchorRename(document, ["base"])).toBe(true);
    expect(document.currentText).toBe(source);
  });

  it("turns a mapping alias into an independently editable copy at the target indentation", () => {
    const source = [
      "templates:",
      "  shared: &settings",
      "    enabled: true",
      "    message: 'Shared'",
      "consumer:",
      "    inherited: *settings",
      ""
    ].join("\n");
    const document = createSourceDocument("config.yml", encoder.encode(source));

    detachDocumentAlias(document, ["consumer", "inherited"], ["templates", "shared"]);

    expect(document.currentText).toBe([
      "templates:",
      "  shared: &settings",
      "    enabled: true",
      "    message: 'Shared'",
      "consumer:",
      "    inherited:",
      "      enabled: true",
      "      message: 'Shared'",
      ""
    ].join("\n"));
    expect(document.index.byPath.has("consumer\u0000inherited\u0000enabled")).toBe(true);
    expect(document.index.byPath.get("templates\u0000shared").source).toContain("&settings");

    expect(undoDocumentAliasDetach(document, ["consumer", "inherited"])).toBe(true);
    expect(document.currentText).toBe(source);
  });

  it("turns an imported alias into an independent copy using its parent definition", () => {
    const document = createSourceDocument("child.yml", encoder.encode("item: *local-button\n"));
    const parentSource = "&parent-button\n    name: Shared\n    material: STONE\n";

    detachDocumentAliasSource(document, ["item"], parentSource, 2);

    expect(document.currentText).toBe("item:\n  name: Shared\n  material: STONE\n");
    expect(document.changes.get("item").kind).toBe("detached-alias");
    expect(undoDocumentAliasDetach(document, ["item"])).toBe(true);
    expect(document.currentText).toBe("item: *local-button\n");
  });

  it("names an independent imported copy, reuses it, and propagates a later rename", () => {
    const document = createSourceDocument("child.yml", encoder.encode([
      "first: *local-button",
      "second:",
      "  name: Other",
      "  material: DIRT",
      "third: *local-button",
      ""
    ].join("\n")));
    const parentSource = "&parent-button\n    name: Shared\n    material: STONE\n";

    detachDocumentAliasSource(document, ["first"], parentSource, 2);
    addDocumentAnchor(document, ["first"], "custom-button");
    replaceDocumentLiteral(document, ["first", "material"], "DIAMOND");
    reuseDocumentAnchor(document, ["second"], "custom-button");
    reuseDocumentAnchor(document, ["third"], "custom-button");
    renameDocumentAnchor(document, ["first"], "premium-button");

    expect(document.currentText).toBe([
      "first: &premium-button",
      "  name: Shared",
      "  material: DIAMOND",
      "second: *premium-button",
      "third: *premium-button",
      ""
    ].join("\n"));
  });

  it("names an independent mapping so it can be reused again", () => {
    const source = [
      "base: &settings",
      "  enabled: true",
      "first: *settings",
      "second:",
      "  enabled: false",
      ""
    ].join("\n");
    const document = createSourceDocument("config.yml", encoder.encode(source));

    detachDocumentAlias(document, ["first"], ["base"]);
    expect(canAddDocumentAnchor(document.index.byPath.get("first"))).toBe(true);
    addDocumentAnchor(document, ["first"], "local-settings");

    expect(document.currentText).toContain("first: &local-settings\n  enabled: true\n");
    expect(parseAnchorName(document.index.byPath.get("first").source)).toBe("local-settings");

    replaceDocumentLiteral(document, ["first", "enabled"], "false");

    reuseDocumentAnchor(document, ["second"], "local-settings");
    expect(document.currentText).toContain("second: *local-settings\n");
    expect(document.changes.get("second").kind).toBe("reused-anchor");

    expect(undoDocumentAnchorReuse(document, ["second"])).toBe(true);
    expect(document.currentText).toContain("second:\n  enabled: false\n");

    expect(undoDocumentAnchorAddition(document, ["first"])).toBe(true);
    expect(document.currentText).toContain("first:\n  enabled: false\n");
    expect(document.changes.get("first").kind).toBe("detached-alias");
  });

  it("reuses a named independent copy in an option that already uses other settings", () => {
    const source = [
      "base: &settings",
      "  enabled: true",
      "first: *settings",
      "second: *settings",
      "",
    ].join("\n");
    const document = createSourceDocument("config.yml", encoder.encode(source));

    detachDocumentAlias(document, ["first"], ["base"]);
    addDocumentAnchor(document, ["first"], "custom-settings");
    replaceDocumentLiteral(document, ["first", "enabled"], "false");

    const second = document.index.byPath.get("second");
    expect(canAddDocumentAnchor(second)).toBe(false);
    expect(canReuseDocumentAnchor(second)).toBe(true);

    reuseDocumentAnchor(document, ["second"], "custom-settings");
    expect(document.currentText).toBe([
      "base: &settings",
      "  enabled: true",
      "first: &custom-settings",
      "  enabled: false",
      "second: *custom-settings",
      "",
    ].join("\n"));
  });

  it("names independent scalar and list copies so each can be reused again", () => {
    const source = [
      "shared-label: &label 'Original'",
      "first-label: *label",
      "second-label: 'Other'",
      "shared-worlds: &worlds [ world, world_nether ]",
      "first-worlds: *worlds",
      "second-worlds: [ custom ]",
      ""
    ].join("\n");
    const document = createSourceDocument("config.yml", encoder.encode(source));

    detachDocumentAlias(document, ["first-label"], ["shared-label"]);
    addDocumentAnchor(document, ["first-label"], "custom-label");
    replaceDocumentLiteral(document, ["first-label"], "&custom-label 'Changed'");
    reuseDocumentAnchor(document, ["second-label"], "custom-label");

    detachDocumentAlias(document, ["first-worlds"], ["shared-worlds"]);
    addDocumentAnchor(document, ["first-worlds"], "custom-worlds");
    const worlds = document.index.byPath.get("first-worlds");
    replaceDocumentValue(document, ["first-worlds"], formatSimpleSequence(worlds, ["world", "world_the_end"]));
    reuseDocumentAnchor(document, ["second-worlds"], "custom-worlds");

    expect(document.currentText).toBe([
      "shared-label: &label 'Original'",
      "first-label: &custom-label 'Changed'",
      "second-label: *custom-label",
      "shared-worlds: &worlds [ world, world_nether ]",
      "first-worlds: &custom-worlds [ world, world_the_end ]",
      "second-worlds: *custom-worlds",
      ""
    ].join("\n"));
  });

  it("adds reusable names to scalar and list values without changing their layout", () => {
    const source = "label: hello\nworlds:\n  - world\n  - world_nether\n";
    const document = createSourceDocument("config.yml", encoder.encode(source));

    addDocumentAnchor(document, ["label"], "shared-label");
    addDocumentAnchor(document, ["worlds"], "shared-worlds");

    expect(document.currentText).toBe("label: &shared-label hello\nworlds: &shared-worlds\n  - world\n  - world_nether\n");
  });

  it("creates, discovers, reuses, and detaches shared values inside list items", () => {
    const source = [
      "elements:",
      "  protected:",
      "    hover:",
      "      - '&cProtected region'",
      "      - '{$s}Location{$colon} {$p}%loc_x%, %loc_z%'",
      "  wilderness:",
      "    hover:",
      "      - '{$sep}Click to claim.'",
      "      - placeholder",
      ""
    ].join("\n");
    const document = createSourceDocument("map.yml", encoder.encode(source));
    const protectedHover = ["elements", "protected", "hover"];
    const wildernessHover = ["elements", "wilderness", "hover"];

    addDocumentSequenceItemAnchor(document, protectedHover, 1, "loc");
    expect(document.currentText).toContain("- &loc '{$s}Location{$colon} {$p}%loc_x%, %loc_z%'");

    const definitions = sequenceItemAnchorDefinitions(document, wildernessHover, 1);
    expect(definitions).toMatchObject([{
      name: "loc",
      source: "'{$s}Location{$colon} {$p}%loc_x%, %loc_z%'",
      path: protectedHover,
      itemIndex: 1
    }]);

    reuseDocumentSequenceItemAnchor(document, wildernessHover, 1, "loc");
    expect(document.currentText).toContain("      - *loc\n");

    detachDocumentSequenceItemAlias(document, wildernessHover, 1);
    expect(document.currentText).toContain("      - '{$s}Location{$colon} {$p}%loc_x%, %loc_z%'\n");
    expect(document.currentText).not.toContain("- *loc");
  });

  it("preserves flow-list spacing when sharing one item", () => {
    const document = createSourceDocument(
      "map.yml",
      encoder.encode("hover: [ first, 'second line' ]\nnext: [ keep, this ]\n")
    );

    addDocumentSequenceItemAnchor(document, ["hover"], 1, "line");
    reuseDocumentSequenceItemAnchor(document, ["next"], 1, "line");

    expect(document.currentText).toBe("hover: [ first, &line 'second line' ]\nnext: [ keep, *line ]\n");
  });

  it("stops sharing a list item by expanding its later aliases", () => {
    const source = [
      "first: [ one, &line 'shared line' ]",
      "second:",
      "  - before",
      "  - *line",
      "third: *line",
      ""
    ].join("\n");
    const document = createSourceDocument("map.yml", encoder.encode(source));

    removeDocumentSequenceItemAnchor(document, ["first"], 1);

    expect(document.currentText).toBe([
      "first: [ one, 'shared line' ]",
      "second:",
      "  - before",
      "  - 'shared line'",
      "third: 'shared line'",
      ""
    ].join("\n"));
    expect(undoDocumentAnchorRemoval(document, ["first"])).toBe(true);
    expect(document.currentText).toBe(source);
  });

  it("stops sharing a setting by preserving independent copies at every use", () => {
    const source = [
      "base: &settings",
      "  enabled: true",
      "first: *settings",
      "second: *settings",
      ""
    ].join("\n");
    const document = createSourceDocument("config.yml", encoder.encode(source));

    removeDocumentAnchor(document, ["base"]);

    expect(document.currentText).toBe([
      "base:",
      "  enabled: true",
      "first:",
      "  enabled: true",
      "second:",
      "  enabled: true",
      ""
    ].join("\n"));
    expect(document.changes.get("base")).toMatchObject({
      kind: "anchor-removed",
      reusableName: "settings",
      referenceCount: 2
    });

    expect(undoDocumentAnchorRemoval(document, ["base"])).toBe(true);
    expect(document.currentText).toBe(source);
  });

  it("stops sharing a scalar setting without changing its value", () => {
    const source = "base: &amount 5\nother: *amount\n";
    const document = createSourceDocument("config.yml", encoder.encode(source));

    removeDocumentAnchor(document, ["base"]);

    expect(document.currentText).toBe("base: 5\nother: 5\n");
  });

  it("replaces an independent mapping with earlier reusable settings and restores it exactly", () => {
    const source = [
      "base: &settings",
      "  enabled: true",
      "target:",
      "  enabled: false",
      "  message: Keep me",
      "next: true",
      ""
    ].join("\n");
    const document = createSourceDocument("config.yml", encoder.encode(source));

    reuseDocumentAnchor(document, ["target"], "settings");
    expect(document.currentText).toContain("target: *settings\nnext: true\n");
    expect(document.changes.get("target").kind).toBe("reused-anchor");

    expect(undoDocumentAnchorReuse(document, ["target"])).toBe(true);
    expect(document.currentText).toBe(source);
  });

  it("shares settings only when their value structures are compatible", () => {
    const source = [
      "shared-list: &worlds [world, world_nether]",
      "shared-section: &settings",
      "  enabled: true",
      "target:",
      "  enabled: false",
      ""
    ].join("\n");
    const document = createSourceDocument("config.yml", encoder.encode(source));

    expect(reusableValueShape(document.index.byPath.get("shared-list"), document.index)).toBe("list");
    expect(reusableValueShape(document.index.byPath.get("shared-section"), document.index)).toBe("section");
    expect(() => reuseDocumentAnchor(document, ["target"], "worlds"))
      .toThrow("same kind of value");
    expect(document.currentText).toBe(source);
  });

  it("keeps an inline section comment while reusing settings", () => {
    const source = "base: &settings\n  enabled: true\ntarget: # keep this explanation\n  enabled: false\nnext: true\n";
    const document = createSourceDocument("config.yml", encoder.encode(source));

    reuseDocumentAnchor(document, ["target"], "settings");
    expect(document.currentText).toContain("target: *settings # keep this explanation\nnext: true\n");

    undoDocumentAnchorReuse(document, ["target"]);
    expect(document.currentText).toBe(source);
  });

  it("reorders named mapping entries with their comments and restores the original order", () => {
    const source = [
      "ranks:",
      "  # Highest ordinary rank",
      "  officer:",
      "    name: Officer",
      "  # Default rank",
      "  member:",
      "    name: Member",
      "",
      "# Unrelated section help",
      "next: true",
      ""
    ].join("\n");
    const document = createSourceDocument("ranks.yml", encoder.encode(source));

    moveDocumentMappingEntry(document, ["ranks", "member"], -1);
    expect(document.currentText).toContain("ranks:\n  # Default rank\n  member:");
    expect(document.currentText.indexOf("member:")).toBeLessThan(document.currentText.indexOf("officer:"));
    expect(document.currentText).toContain("# Unrelated section help\nnext: true");
    expect(document.changes.get("order:ranks")).toMatchObject({ kind: "reordered" });

    moveDocumentMappingEntry(document, ["ranks", "member"], 1);
    expect(document.currentText).toBe(source);
    expect(document.changes.has("order:ranks")).toBe(false);
  });

  it("adds and removes inheritance rules without losing ordinary comments", () => {
    const source = "# Cost explanation\ncost: 5\n";
    const document = createSourceDocument("config.yml", encoder.encode(source));

    setDocumentAnnotation(document, ["cost"], "final", true);
    setDocumentAnnotation(document, ["cost"], "no-sync", true);
    expect(document.currentText).toBe("# Cost explanation\n# [Final]\n# [NoSync]\ncost: 5\n");
    expect(document.index.byPath.get("cost").annotations.map((annotation) => annotation.id)).toEqual(["final", "no-sync"]);
    expect(documentAnnotationChanged(document, ["cost"])).toBe(true);

    setDocumentAnnotation(document, ["cost"], "final", false);
    expect(document.currentText).toBe("# Cost explanation\n# [NoSync]\ncost: 5\n");

    expect(undoDocumentAnnotationChange(document, ["cost"])).toBe(true);
    expect(document.currentText).toBe(source);
    expect(documentAnnotationChanged(document, ["cost"])).toBe(false);
  });

  it("preserves text trailing an existing inheritance annotation", () => {
    const source = "  # [Final] Keep the rationale\n  value: true\n";
    const document = createSourceDocument("config.yml", encoder.encode(source));

    setDocumentAnnotation(document, ["value"], "final", false);

    expect(document.currentText).toBe("  # Keep the rationale\n  value: true\n");
  });

  it("does not rewrite source when the inheritance rules are saved unchanged", () => {
    const source = "# [NoSync]\n# [Final]\nvalue: true\n";
    const document = createSourceDocument("config.yml", encoder.encode(source));

    setDocumentAnnotation(document, ["value"], "no-sync", true);
    setDocumentAnnotation(document, ["value"], "final", true);

    expect(document.currentText).toBe(source);
    expect(documentAnnotationChanged(document, ["value"])).toBe(false);
  });

  it("accepts an advanced whole-source edit and rebuilds the visual index", () => {
    const document = createSourceDocument("config.yml", encoder.encode("enabled: true\n"));
    const replacement = [
      "'[fn-example]': &fn-example",
      "  args: [value]",
      "  return: *value",
      "generated: *fn-example [false]",
      ""
    ].join("\n");

    expect(replaceDocumentSource(document, replacement)).toBe(true);
    expect(document.index.byPath.get("generated").syntax.kind).toBe("function-call");
    expect([...document.changes.values()]).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "added", path: ["generated"] }),
      expect.objectContaining({ kind: "removed", path: ["enabled"] })
    ]));
    expect(decoder.decode(documentBytes(document))).toBe(replacement);

    expect(replaceDocumentSource(document, "enabled: true\n")).toBe(true);
    expect(document.changes.size).toBe(0);
  });

  it("tracks whole-source value edits against their visual setting paths", () => {
    const document = createSourceDocument("config.yml", encoder.encode([
      "enabled: true",
      "limits:",
      "  members: 10",
      ""
    ].join("\n")));

    expect(replaceDocumentSource(document, [
      "enabled: false",
      "limits:",
      "  members: 20",
      ""
    ].join("\n"))).toBe(true);

    expect(document.changes.get("enabled")).toMatchObject({
      kind: "changed",
      path: ["enabled"],
      previousSource: "true",
      nextSource: "false"
    });
    expect(document.changes.get(["limits", "members"].join("\u0000"))).toMatchObject({
      kind: "changed",
      path: ["limits", "members"],
      previousSource: "10",
      nextSource: "20"
    });
    expect(document.changes.has("limits")).toBe(false);
  });
});
