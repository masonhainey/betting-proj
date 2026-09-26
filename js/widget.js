// The Scriptable installer: a short script you paste into Scriptable once. Each run it
// downloads the latest widget code from this site (widget/hedgehog-widget.js), keeps a copy
// for when you're offline, and runs it.

export function installerCode(site) {
  return `// hedgehog widget for Scriptable. Paste this whole thing into a new Scriptable script.
// It keeps itself up to date from ${site}
// icon-color: deep-purple; icon-glyph: chart-line;
const SITE = ${JSON.stringify(site)};
let fm = FileManager.local();
if (fm.isFileStoredIniCloud(module.filename)) fm = FileManager.iCloud();
const dir = fm.joinPath(module.filename.replace(/\\/[^/]*$/, ""), "hedgehog-lib");
const file = fm.joinPath(dir, "core.js");
try {
  const req = new Request(SITE + "widget/hedgehog-widget.js?t=" + Date.now());
  req.timeoutInterval = 10;
  const code = await req.loadString();
  if (req.response.statusCode === 200 && code.includes("hedgehog-widget")) {
    if (!fm.fileExists(dir)) fm.createDirectory(dir, true);
    fm.writeString(file, code);
  }
} catch (e) {}
if (fm.fileExists(file)) {
  if (fm.isFileStoredIniCloud(file)) await fm.downloadFileFromiCloud(file);
  await importModule("hedgehog-lib/core").run({ site: SITE });
} else {
  const w = new ListWidget();
  w.addText("🦔 hedgehog: couldn't download the widget. Check your connection and run it again.");
  if (config.runsInWidget) Script.setWidget(w); else await w.presentMedium();
  Script.complete();
}
`;
}
