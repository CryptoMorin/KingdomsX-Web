const minecraftData = require("minecraft-data");

function propValue(state, value) {
  if (state.type === "enum" || state.values) {
    return state.values[value];
  }

  if (state.type === "bool") {
    return !value;
  }

  return value;
}

module.exports = function prismarineBlock() {
  const registry = minecraftData("1.13.2");

  return class Block {
    constructor(stateId) {
      const block = registry.blocksByStateId[stateId];
      this.name = block?.name ?? "";
      this._properties = {};

      if (!block?.states) {
        return;
      }

      let data = stateId - block.minStateId;

      for (let index = block.states.length - 1; index >= 0; index -= 1) {
        const state = block.states[index];
        this._properties[state.name] = propValue(state, data % state.num_values);
        data = Math.floor(data / state.num_values);
      }
    }

    static fromStateId(stateId) {
      return new Block(stateId);
    }

    getProperties() {
      return this._properties;
    }
  };
};
