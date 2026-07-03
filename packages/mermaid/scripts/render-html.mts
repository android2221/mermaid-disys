/* eslint-disable no-console */

/**
 * @file Renders a single mermaid diagram to a self-contained, animated HTML page instead of a
 * static SVG/PNG. The mermaid bundle is inlined, so the output file has no external
 * dependencies and can be opened directly in a browser or hosted as-is.
 *
 * For diagram types that attach a runtime controller (currently distSys, via `bindFunctions`),
 * the animation is live in the output page, and a play/pause/stop/toggle-line control bar is
 * included automatically. Other diagram types still render correctly, just without controls.
 *
 * Usage: pnpm --filter mermaid render:html <diagram-file> [-o <output.html>] [--title <title>]
 */
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { basename, extname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
// `pnpm --filter mermaid render:html` (used when this is invoked from the repo root via the
// top-level `render:html` script) runs with cwd set to packages/mermaid, not wherever the user
// actually typed the command. INIT_CWD is set by pnpm/npm to that original directory, so
// relative input/output paths resolve the way the user expects either way.
const invocationCwd = process.env.INIT_CWD ?? process.cwd();

function fail(message: string): never {
  console.error(message);
  console.error(
    '\nUsage: pnpm --filter mermaid render:html <diagram-file> [-o <output.html>] [--title <title>]'
  );
  process.exit(1);
}

function parseArgs(argv: string[]) {
  let inputPath: string | undefined;
  let outputPath: string | undefined;
  let title: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '-o' || arg === '--output') {
      outputPath = argv[++i];
    } else if (arg === '--title') {
      title = argv[++i];
    } else if (arg === '-h' || arg === '--help') {
      fail('Render a mermaid diagram to a self-contained, animated HTML page.');
    } else if (arg.startsWith('-')) {
      fail(`Unknown option: ${arg}`);
    } else if (inputPath === undefined) {
      inputPath = arg;
    } else {
      fail(`Unexpected extra argument: ${arg}`);
    }
  }

  if (!inputPath) {
    fail('Missing required <diagram-file> argument.');
  }

  return { inputPath, outputPath, title };
}

function findBundle(): string {
  const candidates = ['../dist/mermaid.min.js', '../dist/mermaid.js'].map((rel) =>
    resolve(__dirname, rel)
  );
  const found = candidates.find(existsSync);
  if (!found) {
    fail(
      'Could not find a built mermaid bundle (dist/mermaid.min.js or dist/mermaid.js).\n' +
        'Build it first: pnpm build:mermaid'
    );
  }
  return found;
}

const escapeHtml = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function buildHtml(options: { title: string; bundleSource: string; diagramSource: string }): string {
  const { title, bundleSource, diagramSource } = options;

  if (bundleSource.includes('</script')) {
    // Defensive: would break out of the inline <script> tag below. Not expected in a minified
    // mermaid bundle, but fail loudly rather than silently emit a broken page.
    throw new Error('mermaid bundle contains a literal "</script" sequence; refusing to inline it.');
  }

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
<style>
  :root {
    --bg: #f5f7fa;
    --surface: #ffffff;
    --border: #d7dee6;
    --text: #14181f;
    --text-dim: #5b6472;
    --accent-2: #17796c;
    --accent-2-soft: #d9efec;
    --shadow: 0 1px 2px rgba(20, 24, 31, 0.05), 0 8px 24px rgba(20, 24, 31, 0.06);
    --mono: ui-monospace, "SF Mono", "Cascadia Code", "JetBrains Mono", Menlo, Consolas, monospace;
    --sans: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #0a0e13;
      --surface: #10151d;
      --border: #262f3c;
      --text: #e8edf4;
      --text-dim: #97a2b3;
      --accent-2: #5fd3c4;
      --accent-2-soft: rgba(95, 211, 196, 0.14);
      --shadow: 0 1px 2px rgba(0, 0, 0, 0.3), 0 12px 32px rgba(0, 0, 0, 0.35);
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--bg);
    color: var(--text);
    font-family: var(--sans);
  }
  .panel {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 10px;
    box-shadow: var(--shadow);
    padding: 28px;
    max-width: min(92vw, 900px);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 18px;
  }
  #mount { display: flex; justify-content: center; }
  #mount svg { max-width: 100%; height: auto; }
  .controls { display: flex; gap: 8px; }
  .controls[hidden] { display: none; }
  .controls button {
    font-family: var(--mono);
    font-size: 12px;
    letter-spacing: 0.03em;
    padding: 8px 14px;
    border-radius: 6px;
    border: 1px solid var(--border);
    background: var(--bg);
    color: var(--text);
    cursor: pointer;
  }
  .controls button:hover { border-color: var(--accent-2); color: var(--accent-2); }
  .controls button:focus-visible { outline: 2px solid var(--accent-2); outline-offset: 2px; }
</style>
</head>
<body>
  <div class="panel">
    <div id="mount"></div>
    <div class="controls" id="controls" hidden>
      <button type="button" id="btnPlay">&#9654; play</button>
      <button type="button" id="btnPause">&#10073;&#10073; pause</button>
      <button type="button" id="btnStop">&#9632; stop</button>
      <button type="button" id="btnTogglePath">&#8213; line</button>
    </div>
  </div>
<script>
${bundleSource}
</script>
<script>
(function () {
  var SRC = ${JSON.stringify(diagramSource)};
  mermaid.initialize({ startOnLoad: false, securityLevel: "loose" });
  mermaid.mermaidAPI.render("diagram", SRC).then(function (result) {
    var mount = document.getElementById("mount");
    mount.innerHTML = result.svg;
    var svgEl = mount.querySelector("svg");
    if (result.bindFunctions) {
      result.bindFunctions(svgEl);
    }
    if (svgEl.distSys) {
      document.getElementById("controls").hidden = false;
      document.getElementById("btnPlay").addEventListener("click", function () {
        svgEl.distSys.play();
      });
      document.getElementById("btnPause").addEventListener("click", function () {
        svgEl.distSys.pause();
      });
      document.getElementById("btnStop").addEventListener("click", function () {
        svgEl.distSys.stop();
      });
      document.getElementById("btnTogglePath").addEventListener("click", function () {
        svgEl.distSys.togglePath();
      });
    }
  }).catch(function (err) {
    document.getElementById("mount").textContent = "Render error: " + (err && err.message ? err.message : err);
  });
})();
</script>
</body>
</html>
`;
}

function main() {
  const { inputPath, outputPath, title } = parseArgs(process.argv.slice(2));

  const resolvedInput = resolve(invocationCwd, inputPath!);
  if (!existsSync(resolvedInput)) {
    fail(`Input file not found: ${resolvedInput}`);
  }
  const diagramSource = readFileSync(resolvedInput, 'utf-8');

  const resolvedOutput = resolve(
    invocationCwd,
    outputPath ?? `${basename(resolvedInput, extname(resolvedInput))}.html`
  );

  const bundlePath = findBundle();
  const bundleSource = readFileSync(bundlePath, 'utf-8');

  const html = buildHtml({
    title: title ?? basename(resolvedInput),
    bundleSource,
    diagramSource,
  });

  writeFileSync(resolvedOutput, html, 'utf-8');
  console.log(`Wrote ${resolvedOutput}`);
}

main();
