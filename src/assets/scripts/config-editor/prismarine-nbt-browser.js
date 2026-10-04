import { Buffer } from "buffer";
import compoundTypes from "prismarine-nbt/compound.js";
import nbtTypes from "prismarine-nbt/nbt.json";
import optionalTypes from "prismarine-nbt/optional.js";
import ProtoDef from "protodef/src/protodef.js";

const proto = new ProtoDef(false);
proto.addTypes(compoundTypes);
proto.addTypes(optionalTypes.interpret);
proto.addTypes(nbtTypes);
proto.types.nbtTagName = proto.types.shortString;

export function parseUncompressed(input) {
  const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input);

  return proto.parsePacketBuffer("nbt", buffer).data;
}

export function writeUncompressed(value) {
  return proto.createPacketBuffer("nbt", value);
}

export function parse(input, format, callback) {
  if (typeof format === "function") {
    callback = format;
  }

  try {
    const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input);
    const parsed = parseUncompressed(buffer);
    const metadata = { buffer, size: buffer.byteLength };

    if (callback) {
      callback(null, parsed, "big", metadata);
      return;
    }

    return Promise.resolve({ parsed, type: "big", metadata });
  } catch (error) {
    if (callback) {
      callback(error);
      return;
    }

    return Promise.reject(error);
  }
}

export function simplify(data) {
  if (data.type === "compound") {
    return Object.fromEntries(
      Object.entries(data.value).map(([key, value]) => [key, simplify(value)])
    );
  }

  if (data.type === "list") {
    return data.value.value.map((value) => simplify({ type: data.value.type, value }));
  }

  return data.value;
}

export const comp = (value, name = "") => ({ type: "compound", name, value });
export const int = (value) => ({ type: "int", value });
export const intArray = (value = []) => ({ type: "intArray", value });
export const short = (value) => ({ type: "short", value });
export const string = (value) => ({ type: "string", value });
export const byteArray = (value = []) => ({ type: "byteArray", value });
export const list = (value) => ({
  type: "list",
  value: {
    type: value?.type ?? "end",
    value: value?.value ?? []
  }
});

export default {
  byteArray,
  comp,
  int,
  intArray,
  list,
  parse,
  parseUncompressed,
  short,
  simplify,
  string,
  writeUncompressed
};
