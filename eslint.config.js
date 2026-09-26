// Catches undefined names and unused imports across the ES modules (no plugins needed).
const browser = Object.fromEntries(
  ["window", "document", "navigator", "location", "history", "localStorage", "sessionStorage", "fetch", "setTimeout", "clearTimeout",
   "setInterval", "clearInterval", "console", "URL", "URLSearchParams", "Blob", "FileReader", "Image", "matchMedia", "getComputedStyle",
   "CSS", "Intl", "DataTransfer", "ClipboardEvent", "Event", "Notification", "caches", "self", "structuredClone", "createImageBitmap",
   "AbortController", "Request", "Response", "requestAnimationFrame", "TextEncoder", "TextDecoder", "btoa", "atob", "File", "Path2D"].map((k) => [k, "readonly"])
);

export default [
  {
    files: ["js/**/*.js", "sw.js"],
    languageOptions: { ecmaVersion: 2024, sourceType: "module", globals: browser },
    rules: {
      "no-undef": "error",
      "no-unused-vars": ["error", { args: "none", caughtErrors: "none", varsIgnorePattern: "^_" }],
    },
  },
  { files: ["sw.js"], languageOptions: { sourceType: "script" } },
  {
    files: ["scripts/**/*.mjs"],
    languageOptions: { ecmaVersion: 2024, sourceType: "module", globals: { process: "readonly", console: "readonly", fetch: "readonly", Intl: "readonly", URL: "readonly", setTimeout: "readonly", clearTimeout: "readonly", AbortController: "readonly" } },
    rules: { "no-undef": "error", "no-unused-vars": ["error", { args: "none", caughtErrors: "none" }] },
  },
  {
    // Scriptable (iOS) globals are declared at the top of widget/src/core.js.
    files: ["widget/src/**/*.js"],
    languageOptions: { ecmaVersion: 2024, sourceType: "module", globals: { Intl: "readonly", JSON: "readonly", Date: "readonly", module: "readonly" } },
    rules: { "no-undef": "error", "no-unused-vars": ["error", { args: "none", caughtErrors: "none" }] },
  },
];
