// @name Return to MooshieUI
// @description Send this hand-off document back to a MooshieUI destination.
var doc = app.activeDocument;
if (!doc || !doc.path) throw new Error("Open a document sent from MooshieUI first.");
var stem = doc.path.replace(/\.[^/.\\]+$/, "");
if (!patchy.io.fileExists(stem + ".mooshie-link.json")) {
  throw new Error("This document has no MooshieUI hand-off. Open it from MooshieUI first.");
}
var choices = ["Gallery", "Canvas base", "Raster layer", "Inpaint mask", "Prompt region"];
var targets = ["gallery", "base", "raster", "mask", "region"];
var options = patchy.ui.showOptions({
  title: "Return to MooshieUI",
  description: "Send the current pixels, including unsaved edits. Keep the MooshieUI transfer window open with its live connection enabled.",
  fields: [{ key: "destination", label: "Destination", type: "choice", value: choices[2], choices: choices }]
});
if (options) {
  var index = choices.indexOf(options.destination);
  if (index < 0) throw new Error("Unknown MooshieUI destination.");
  patchy.io.writeTextFile(stem + ".mooshie-request.json", JSON.stringify({target: targets[index]}));
  console.log("Return requested: " + choices[index]);
}
