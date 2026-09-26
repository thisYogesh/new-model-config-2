#!/usr/bin/env node
// Installed by Theme Factory (tf chat). Do not edit — regenerated each launch.
let input = "";
process.stdin.on("data", function (c) { input += c; });
process.stdin.on("end", function () {
  var cmd = "";
  try { cmd = ((JSON.parse(input) || {}).tool_input || {}).command || ""; } catch (e) {}
  var parts = String(cmd).toLowerCase().split(/\s+/);
  var themeDev = false, rawCheck = false;
  for (var i = 0; i < parts.length - 1; i++) {
    if (parts[i] === "theme" && parts[i + 1] === "dev") { themeDev = true; break; }
    if (parts[i] === "theme" && parts[i + 1] === "check") { rawCheck = true; break; }
    if (parts[i] === "npm" && parts[i + 1] === "run" && parts[i + 2] === "check") { rawCheck = true; break; }
  }
  if (themeDev) {
    process.stderr.write("Blocked by Theme Factory: do NOT run \`shopify theme dev\` or any blocking local preview server — it never returns and hangs this session. To let the user preview, push to an unpublished theme and share the preview URL. For a local hot-reload preview, tell the user to run \`tf serve --latest\` themselves. To debug a visual / 'not visible' issue, reason from the Liquid + CSS + schema, run \`tf _theme-check --path <theme-dir>\`, and inspect any screenshot the user provided.");
    process.exit(2);
  }
  if (rawCheck) {
    process.stderr.write("Blocked by Theme Factory: do NOT run raw \`shopify theme check\` or \`npm run check\` — on themes with a large offense baseline the output is megabytes and will blow your context window. Run \`tf _theme-check --path <theme-dir>\` instead: same linter, but the JSON is capped (30 issues, errors first, omissions reported as counts) and policy noise like MatchingTranslations is filtered into ignoredCounts.");
    process.exit(2);
  }
  process.exit(0);
});
