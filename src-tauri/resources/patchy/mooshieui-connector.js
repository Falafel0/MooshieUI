// @name MooshieUI Connector
// @description Send the active Patchy document back to MooshieUI without
// @description flattening or saving it first. Choose exactly where it lands.
// @author MooshieUI
// @cli --script-arg target=raster

// This is a Patchy user-script integration, deliberately kept as a single
// visible command in File > Scripts > MooshieUI. MooshieUI reads the open
// document through Patchy's documented local connector, so this script only
// selects the destination and never writes over the artist's document.
var doc = app.activeDocument;
if (!doc || !doc.path) {
  throw new Error("Open a document sent from MooshieUI first.");
}

var stem = doc.path.replace(/\.[^/.\\]+$/, "");
if (!patchy.io.fileExists(stem + ".mooshie-link.json")) {
  throw new Error("This document has no MooshieUI hand-off. Open it from MooshieUI first.");
}

var DESTINATIONS = [
  { label: "Gallery", target: "gallery" },
  { label: "Canvas base", target: "base" },
  { label: "Raster layer", target: "raster" },
  { label: "Inpaint mask", target: "mask" },
  { label: "Prompt region", target: "region" }
];

function destinationForTarget(target) {
  for (var i = 0; i < DESTINATIONS.length; i++) {
    if (DESTINATIONS[i].target === target) return DESTINATIONS[i];
  }
  return null;
}

var requestedTarget = patchy.args && typeof patchy.args.target === "string"
  ? patchy.args.target.toLowerCase()
  : "";
var destination = destinationForTarget(requestedTarget);

if (!destination) {
  var choices = DESTINATIONS.map(function (item) { return item.label; });
  var options = patchy.ui.showOptions({
    title: "MooshieUI Connector",
    description: "Send the current pixels, including unsaved edits, to the open MooshieUI transfer. Choose where the result should land.",
    fields: [{
      key: "destination",
      label: "Send to",
      type: "choice",
      value: "Raster layer",
      choices: choices
    }]
  });
  if (!options) {
    console.log("MooshieUI return cancelled");
  } else {
    for (var j = 0; j < DESTINATIONS.length; j++) {
      if (DESTINATIONS[j].label === options.destination) destination = DESTINATIONS[j];
    }
  }
}

if (destination) {
  patchy.io.writeTextFile(
    stem + ".mooshie-request.json",
    JSON.stringify({ version: 2, target: destination.target, source: "MooshieUI Connector" })
  );
  console.log("MooshieUI return requested: " + destination.label);
}
