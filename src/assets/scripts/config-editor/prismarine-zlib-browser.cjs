module.exports = {
  gzip(_input, callback) {
    callback(new Error("The browser schematic preview does not write schematics."));
  }
};
