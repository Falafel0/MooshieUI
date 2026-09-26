// MooshieUI's unattended Patchy bridge. The source PSD/PSB is passed as the
// final CLI argument; Patchy opens it before running this script. Keep the
// exported image separate from the user's layered document.
var documentToExport = app.activeDocument;
if (!documentToExport) throw new Error("No Patchy document was opened");
if (!patchy.args.out) throw new Error("Missing output PNG path");
documentToExport.exportAs(patchy.args.out);
console.log("MooshieUI export complete");
