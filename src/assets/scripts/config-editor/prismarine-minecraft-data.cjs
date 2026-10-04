const blocks = require("minecraft-data/minecraft-data/data/pc/1.13.2/blocks.json");
const legacy = require("minecraft-data/minecraft-data/data/pc/common/legacy.json");

const blocksByName = Object.fromEntries(blocks.map((block) => [block.name, block]));
const blocksByStateId = [];

for (const block of blocks) {
  const firstState = block.minStateId ?? (block.id << 4);
  const lastState = block.maxStateId ?? firstState + 15;

  for (let stateId = firstState; stateId <= lastState; stateId += 1) {
    blocksByStateId[stateId] = block;
  }
}

const version = {
  type: "pc",
  minecraftVersion: "1.13.2",
  majorVersion: "1.13",
  dataVersion: 1631
};

function minecraftData() {
  return {
    blocks,
    blocksByName,
    blocksByStateId,
    isNewerOrEqualTo(other) {
      return other === "1.13" || other === "1.13.1" || other === "1.13.2";
    },
    version
  };
}

minecraftData.legacy = { pc: legacy };
minecraftData.versions = { pc: [{ ...version, version: 404, usesNetty: true, releaseType: "release" }] };

module.exports = minecraftData;
