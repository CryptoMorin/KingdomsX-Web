const MESSAGE_ENTRY_KEYS = new Set(["message", "sound", "actionbar", "titles"]);

export const MESSAGE_TITLE_STARTER_FIELDS = Object.freeze([
  Object.freeze(["title", '""']),
  Object.freeze(["subtitle", '""']),
  Object.freeze(["fade-in", "30"]),
  Object.freeze(["stay", "15"]),
  Object.freeze(["fade-out", "30"])
]);

export function messageEntryType() {
  return {
    kind: "object",
    typeName: "MessageEntry",
    description: "A player message with optional sound, action bar, and title effects.",
    optional: true,
    required: [],
    fields: [
      field("message", message("Chat message shown to the player.")),
      field("sound", {
        kind: "suggestion",
        typeName: "Sound",
        allowCustom: true,
        description: "Sound played when the message is sent. Volume and pitch may follow the sound name.",
        optional: true
      }),
      field("actionbar", message("Action bar message shown briefly above the player's hotbar.")),
      field("titles", {
        kind: "object",
        typeName: "MessageTitles",
        description: "Title and subtitle shown in the center of the player's screen.",
        optional: true,
        required: [],
        fields: [
          field("title", message("Main title text.")),
          field("subtitle", message("Subtitle text shown below the title.")),
          field("fade-in", ticks("Ticks used to fade the title in.")),
          field("stay", ticks("Ticks the title remains fully visible.")),
          field("fade-out", ticks("Ticks used to fade the title out."))
        ]
      })
    ]
  };
}

export function isExpandedMessageEntry(type) {
  if (type?.kind !== "object" || !type.fields?.length) {
    return false;
  }

  return type.fields.every((candidate) => MESSAGE_ENTRY_KEYS.has(candidate.key));
}

export function isMessageEntryType(type) {
  return type?.messageEntry === true || type?.typeName === "MessageEntry";
}

function field(key, type) {
  return { key, type };
}

function message(description) {
  return { kind: "string", typeName: "Message", description, optional: true };
}

function ticks(description) {
  return { kind: "integer", typeName: "Ticks", minimum: 0, description, optional: true };
}
