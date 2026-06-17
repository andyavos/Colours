#!/usr/bin/env node

/**
 * generate-swatches.js
 * Compiles SCSS from a local directory or remote source, extracts all colour
 * values, and outputs a self-contained HTML swatch reference page.
 *
 * Usage:
 *   node generate-swatches.js [source] [output-html] [--scss-subdir=path]
 *
 * Source can be:
 *   ./scss                              local directory (default)
 *   https://github.com/org/repo        GitHub repo (cloned via git)
 *   git@github.com:org/repo.git        SSH git URL
 *   https://example.com/styles.zip     Remote ZIP archive
 *   https://example.com/styles.tar.gz  Remote tarball
 *
 * Options:
 *   --scss-subdir=src/styles   Subdirectory within a cloned repo to scan
 *                              (default: scans whole repo)
 *   --branch=main              Git branch to clone (default: default branch)
 *   --output=./swatches.html   Output path (or pass as 2nd positional arg)
 *   --keep-temp                Don't delete the temporary cloned/extracted dir
 *
 * Examples:
 *   node generate-swatches.js ./scss
 *   node generate-swatches.js https://github.com/twbs/bootstrap --scss-subdir=scss
 *   node generate-swatches.js git@github.com:org/repo.git --branch=develop --scss-subdir=assets/scss
 *   node generate-swatches.js https://example.com/theme.zip --scss-subdir=theme/scss
 *
 * Dependencies (install once):
 *   npm install sass
 *   git must be available in PATH for remote git sources
 */

const path  = require("path");
const fs    = require("fs");
const os    = require("os");
const { execSync, spawnSync } = require("child_process");

// ─── Arg parsing ─────────────────────────────────────────────────────────────

const rawArgs = process.argv.slice(2);
const flags   = {};
const positional = [];

for (const arg of rawArgs) {
  if (arg.startsWith("--")) {
    const [key, ...rest] = arg.slice(2).split("=");
    flags[key] = rest.length ? rest.join("=") : true;
  } else {
    positional.push(arg);
  }
}

const SOURCE      = positional[0] || flags.source  || "./scss";
const OUTPUT_HTML = path.resolve(positional[1] || flags.output || "./swatches.html");
const SCSS_SUBDIR = flags["scss-subdir"] || null;
const GIT_BRANCH  = flags["branch"]      || null;
const KEEP_TEMP   = !!flags["keep-temp"];

// ─── Source type detection ────────────────────────────────────────────────────

function detectSourceType(src) {
  if (/^git@/i.test(src))                        return "git-ssh";
  if (/^https?:\/\/.+\.git($|\?)/i.test(src))   return "git-https";
  if (/^https?:\/\/github\.com\//i.test(src))   return "git-https";
  if (/^https?:\/\/gitlab\.com\//i.test(src))   return "git-https";
  if (/^https?:\/\/bitbucket\.org\//i.test(src)) return "git-https";
  if (/^https?:\/\/.+\.(zip)(\?.*)?$/i.test(src)) return "zip";
  if (/^https?:\/\/.+\.(tar\.gz|tgz)(\?.*)?$/i.test(src)) return "tarball";
  if (/^https?:\/\//i.test(src))                return "zip"; // optimistic fallback
  return "local";
}

// ─── Remote fetching ─────────────────────────────────────────────────────────

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "swatches-"));
}

function fetchRemote(src, type) {
  const tmpDir = makeTempDir();
  console.log(`  Temp dir  : ${tmpDir}`);

  if (type === "git-https" || type === "git-ssh") {
    // Verify git is available
    const gitCheck = spawnSync("git", ["--version"], { encoding: "utf8" });
    if (gitCheck.status !== 0) {
      console.error("❌  git not found in PATH. Install git to use remote repositories.");
      process.exit(1);
    }

    const cloneArgs = ["clone", "--depth=1"];
    if (GIT_BRANCH) cloneArgs.push("--branch", GIT_BRANCH);
    cloneArgs.push(src, tmpDir);

    console.log(`  Running   : git ${cloneArgs.join(" ")}`);
    const result = spawnSync("git", cloneArgs, { encoding: "utf8", stdio: "inherit" });
    if (result.status !== 0) {
      console.error("❌  git clone failed.");
      process.exit(1);
    }
    return tmpDir;
  }

  if (type === "zip" || type === "tarball") {
    // Need https module — built-in
    const https = require("https");
    const http  = require("http");
    const ext   = type === "tarball" ? ".tar.gz" : ".zip";
    const archivePath = path.join(tmpDir, `archive${ext}`);
    const extractDir  = path.join(tmpDir, "extracted");
    fs.mkdirSync(extractDir);

    console.log(`  Downloading: ${src}`);
    downloadSync(src, archivePath);
    console.log(`  Extracting…`);

    if (type === "zip") {
      // Use unzip if available, otherwise python3 zipfile
      const unzip = spawnSync("unzip", ["-q", archivePath, "-d", extractDir], { encoding: "utf8" });
      if (unzip.status !== 0) {
        // fallback: python3
        const py = spawnSync("python3", ["-c",
          `import zipfile,sys; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])`,
          archivePath, extractDir
        ], { encoding: "utf8" });
        if (py.status !== 0) {
          console.error("❌  Could not extract ZIP. Install unzip or python3.");
          process.exit(1);
        }
      }
    } else {
      const tar = spawnSync("tar", ["-xzf", archivePath, "-C", extractDir], { encoding: "utf8" });
      if (tar.status !== 0) {
        console.error("❌  Could not extract tarball. Ensure tar is available.");
        process.exit(1);
      }
    }

    // If the archive contained a single top-level folder, step into it
    const entries = fs.readdirSync(extractDir);
    if (entries.length === 1) {
      const inner = path.join(extractDir, entries[0]);
      if (fs.statSync(inner).isDirectory()) return inner;
    }
    return extractDir;
  }

  console.error(`❌  Unrecognised remote source type: ${type}`);
  process.exit(1);
}

function downloadSync(url, dest) {
  // Synchronous download via child process (curl or wget)
  const curl = spawnSync("curl", ["-sL", "-o", dest, url], { encoding: "utf8" });
  if (curl.status === 0) return;
  const wget = spawnSync("wget", ["-q", "-O", dest, url], { encoding: "utf8" });
  if (wget.status === 0) return;
  console.error("❌  Could not download file. Install curl or wget.");
  process.exit(1);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function hexToRgba(hex) {
  let h = hex.replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  if (h.length === 6) {
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
    return { r, g, b, a: 1 };
  }
  if (h.length === 8) {
    const [r, g, b, a] = [0, 2, 4, 6].map((i) => parseInt(h.slice(i, i + 2), 16));
    return { r, g, b, a: +(a / 255).toFixed(2) };
  }
  return null;
}

function rgbStringToRgba(str) {
  const m = str.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\/\s]+([\d.]+))?\s*\)/);
  if (!m) return null;
  return { r: +m[1], g: +m[2], b: +m[3], a: m[4] !== undefined ? +m[4] : 1 };
}

function rgbaToHex({ r, g, b, a }) {
  const hex = [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
  if (a < 1) {
    const ah = Math.round(a * 255).toString(16).padStart(2, "0");
    return `#${hex}${ah}`.toUpperCase();
  }
  return `#${hex}`.toUpperCase();
}

function colourKey({ r, g, b, a }) {
  return `${Math.round(r)},${Math.round(g)},${Math.round(b)},${a}`;
}

function luminance({ r, g, b }) {
  const s = [r, g, b].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * s[0] + 0.7152 * s[1] + 0.0722 * s[2];
}

function labelColour(rgba) {
  return luminance(rgba) > 0.35 ? "#111111" : "#FFFFFF";
}

function getHue({ r, g, b }) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  if (max === min) return 0;
  const d = max - min;
  let h = max === r ? (g - b) / d + (g < b ? 6 : 0)
        : max === g ? (b - r) / d + 2
        : (r - g) / d + 4;
  return h * 60;
}

// ─── Find SCSS entry points ───────────────────────────────────────────────────

function findScssFiles(dir) {
  if (!fs.existsSync(dir)) {
    console.error(`❌  SCSS directory not found: ${dir}`);
    process.exit(1);
  }
  const all = [];
  function walk(d) {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".scss") && !entry.name.startsWith("_")) all.push(full);
    }
  }
  walk(dir);
  return all;
}

// ─── Compile SCSS ─────────────────────────────────────────────────────────────

function compileScss(scssFiles) {
  const chunks = [];
  for (const file of scssFiles) {
    console.log(`  Compiling : ${path.basename(file)}`);
    try {
      const css = execSync(`npx sass --no-source-map --style=expanded "${file}"`, {
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
      });
      chunks.push(css);
    } catch (e) {
      console.warn(`  ⚠️  Could not compile ${path.basename(file)}: ${e.stderr || e.message}`);
    }
  }
  return chunks.join("\n");
}

// ─── Extract colours ──────────────────────────────────────────────────────────

function scanScssVars(dir, varMap) {
  if (!fs.existsSync(dir)) return;
  function walk(d) {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".scss")) {
        const src = fs.readFileSync(full, "utf8");
        for (const m of src.matchAll(/(\$[\w-]+)\s*:\s*(#[0-9a-fA-F]{3,8}|rgba?\([^;]+\))\s*[;!]/g)) {
          const raw  = m[2].trim();
          const rgba = raw.startsWith("#") ? hexToRgba(raw) : rgbStringToRgba(raw);
          if (rgba) {
            const k = colourKey(rgba);
            if (!varMap.has(k)) varMap.set(k, []);
            if (!varMap.get(k).includes(m[1])) varMap.get(k).push(m[1]);
          }
        }
      }
    }
  }
  walk(dir);
}

function extractColours(cssText, scssDir) {
  const seen   = new Map();
  const varMap = new Map();
  scanScssVars(scssDir, varMap);

  function processRgba(rgba) {
    if (!rgba) return;
    const k = colourKey(rgba);
    if (!seen.has(k)) seen.set(k, { hex: rgbaToHex(rgba), rgba, vars: [] });
  }

  for (const pat of [/#([0-9a-fA-F]{8})\b/g, /#([0-9a-fA-F]{6})\b/g, /#([0-9a-fA-F]{3})\b/g]) {
    let m; pat.lastIndex = 0;
    while ((m = pat.exec(cssText)) !== null) processRgba(hexToRgba(m[0]));
  }
  for (const m of cssText.matchAll(/rgba?\([^)]+\)/g)) processRgba(rgbStringToRgba(m[0]));

  for (const [k, entry] of seen) entry.vars = varMap.get(k) || [];
  return [...seen.values()];
}

// ─── Sort colours ─────────────────────────────────────────────────────────────

function sortColours(colours) {
  return colours.sort((a, b) => {
    const ha = getHue(a.rgba), hb = getHue(b.rgba);
    if (Math.abs(ha - hb) > 15) return ha - hb;
    return luminance(b.rgba) - luminance(a.rgba);
  });
}

// ─── Build HTML ───────────────────────────────────────────────────────────────

function buildHtml(colours, sourceLabel) {
  const count = colours.length;
  const now   = new Date().toLocaleString("en-GB", { dateStyle: "long", timeStyle: "short" });

  const swatches = colours.map(({ hex, rgba, vars }) => {
    const { r, g, b, a } = rgba;
    const rgbaStr  = a < 1 ? `rgba(${r}, ${g}, ${b}, ${a})` : `rgb(${r}, ${g}, ${b})`;
    const fg       = labelColour(rgba);
    const varBadges = vars.map(v => `<span class="var-badge">${v}</span>`).join("");
    return `
  <div class="swatch">
    <div class="swatch-preview" style="background:${rgbaStr}; color:${fg};">
      ${a < 1 ? `<span class="alpha-badge">α ${a}</span>` : ""}
    </div>
    <div class="swatch-info">
      <button class="copy-btn hex-val" data-value="${hex}" title="Copy HEX">${hex}</button>
      <button class="copy-btn rgba-val" data-value="${rgbaStr}" title="Copy RGBA">${rgbaStr}</button>
      ${varBadges ? `<div class="vars">${varBadges}</div>` : ""}
    </div>
  </div>`;
  }).join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Colour Swatches</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  :root {
    --bg: #0f0f0f; --surface: #1a1a1a; --surface-2: #242424;
    --border: #2e2e2e; --text: #e8e8e8; --text-muted: #888;
    --accent: #7c6af7; --radius: 10px;
    --font: 'Inter', 'Segoe UI', system-ui, sans-serif;
    --mono: 'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace;
  }
  body { background:var(--bg); color:var(--text); font-family:var(--font); min-height:100vh; padding:2rem; }
  header { max-width:1400px; margin:0 auto 2.5rem; display:flex; align-items:flex-end; justify-content:space-between; gap:1rem; flex-wrap:wrap; padding-bottom:1.5rem; border-bottom:1px solid var(--border); }
  .header-left h1 { font-size:1.75rem; font-weight:700; letter-spacing:-0.03em; color:#fff; }
  .header-left h1 span { color:var(--accent); }
  .header-left p { margin-top:0.35rem; font-size:0.8rem; color:var(--text-muted); font-family:var(--mono); }
  .pill { background:var(--surface-2); border:1px solid var(--border); border-radius:100px; padding:0.35rem 0.85rem; font-size:0.75rem; color:var(--text-muted); font-family:var(--mono); }
  .pill strong { color:var(--text); }
  .toolbar { max-width:1400px; margin:0 auto 2rem; display:flex; gap:1rem; align-items:center; flex-wrap:wrap; }
  .search-wrap { position:relative; flex:1; min-width:200px; max-width:360px; }
  .search-wrap svg { position:absolute; left:0.8rem; top:50%; transform:translateY(-50%); pointer-events:none; color:var(--text-muted); }
  #search { width:100%; background:var(--surface); border:1px solid var(--border); border-radius:var(--radius); color:var(--text); font-family:var(--mono); font-size:0.8rem; padding:0.55rem 0.9rem 0.55rem 2.4rem; outline:none; transition:border-color 0.15s; }
  #search::placeholder { color:var(--text-muted); }
  #search:focus { border-color:var(--accent); }
  #count-label { font-size:0.78rem; color:var(--text-muted); font-family:var(--mono); margin-left:auto; }
  .grid { max-width:1400px; margin:0 auto; display:grid; grid-template-columns:repeat(auto-fill,minmax(200px,1fr)); gap:1rem; }
  .swatch { border-radius:var(--radius); overflow:hidden; border:1px solid var(--border); background:var(--surface); display:flex; flex-direction:column; transition:transform 0.15s,box-shadow 0.15s; }
  .swatch:hover { transform:translateY(-3px); box-shadow:0 8px 24px rgba(0,0,0,.4); }
  .swatch-preview { height:110px; display:flex; align-items:flex-start; justify-content:flex-end; padding:0.5rem; }
  .alpha-badge { background:rgba(0,0,0,.35); backdrop-filter:blur(4px); border-radius:4px; font-size:0.65rem; font-family:var(--mono); padding:0.15rem 0.4rem; letter-spacing:0.05em; }
  .swatch-info { padding:0.75rem; display:flex; flex-direction:column; gap:0.4rem; background:var(--surface); }
  .copy-btn { background:var(--surface-2); border:1px solid var(--border); border-radius:6px; color:var(--text); font-family:var(--mono); font-size:0.72rem; padding:0.35rem 0.55rem; cursor:pointer; text-align:left; transition:background 0.1s,border-color 0.1s,color 0.1s; word-break:break-all; width:100%; }
  .copy-btn:hover { background:var(--border); border-color:var(--accent); }
  .copy-btn.copied { background:#1a2e1a; border-color:#3a7a3a; color:#6fcf6f; }
  .hex-val { font-weight:600; font-size:0.8rem; letter-spacing:0.05em; }
  .vars { display:flex; flex-wrap:wrap; gap:0.3rem; margin-top:0.1rem; }
  .var-badge { background:rgba(124,106,247,.15); border:1px solid rgba(124,106,247,.3); color:#b0a6fb; border-radius:4px; font-family:var(--mono); font-size:0.65rem; padding:0.15rem 0.45rem; }
  #toast { position:fixed; bottom:2rem; left:50%; transform:translateX(-50%) translateY(10px); background:var(--accent); color:#fff; font-size:0.8rem; font-family:var(--mono); padding:0.55rem 1.2rem; border-radius:100px; opacity:0; pointer-events:none; transition:opacity 0.2s,transform 0.2s; z-index:100; white-space:nowrap; }
  #toast.show { opacity:1; transform:translateX(-50%) translateY(0); }
  .no-results { grid-column:1/-1; text-align:center; padding:4rem 1rem; color:var(--text-muted); font-size:0.9rem; }
</style>
</head>
<body>
<header>
  <div class="header-left">
    <h1>Colour <span>Swatches</span></h1>
    <p>Source: <strong>${sourceLabel}</strong> · ${now}</p>
  </div>
  <div class="header-right">
    <span class="pill"><strong>${count}</strong> unique colours</span>
  </div>
</header>
<div class="toolbar">
  <div class="search-wrap">
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
    <input id="search" type="text" placeholder="Search hex, rgba, or variable…" autocomplete="off" spellcheck="false">
  </div>
  <span id="count-label">${count} colours</span>
</div>
<div class="grid" id="grid">
${swatches}
</div>
<div id="toast"></div>
<script>
  function showToast(msg){const t=document.getElementById('toast');t.textContent=msg;t.classList.add('show');clearTimeout(t._timer);t._timer=setTimeout(()=>t.classList.remove('show'),1800);}
  document.querySelectorAll('.copy-btn').forEach(btn=>{btn.addEventListener('click',()=>{navigator.clipboard.writeText(btn.dataset.value).then(()=>{btn.classList.add('copied');setTimeout(()=>btn.classList.remove('copied'),1200);showToast('Copied '+btn.dataset.value);});});});
  const searchEl=document.getElementById('search'),countEl=document.getElementById('count-label'),swatchEls=[...document.querySelectorAll('.swatch')];
  searchEl.addEventListener('input',()=>{const q=searchEl.value.toLowerCase().trim();let v=0;swatchEls.forEach(s=>{const show=!q||s.textContent.toLowerCase().includes(q);s.style.display=show?'':'none';if(show)v++;});countEl.textContent=q?\`\${v} of ${count} colours\`:\`${count} colours\`;let nr=document.querySelector('.no-results');if(v===0){if(!nr){nr=document.createElement('div');nr.className='no-results';nr.textContent='No colours match your search.';document.getElementById('grid').appendChild(nr);}}else if(nr)nr.remove();});
</script>
</body>
</html>`;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

console.log("\n🎨  SCSS Colour Swatch Generator");
console.log("────────────────────────────────");

const sourceType = detectSourceType(SOURCE);
console.log(`  Source    : ${SOURCE}`);
console.log(`  Type      : ${sourceType}`);
console.log(`  Output    : ${OUTPUT_HTML}`);
if (SCSS_SUBDIR) console.log(`  Subdir    : ${SCSS_SUBDIR}`);
if (GIT_BRANCH)  console.log(`  Branch    : ${GIT_BRANCH}`);
console.log();

let workingDir;
let tempDirToClean = null;

if (sourceType === "local") {
  workingDir = path.resolve(SOURCE);
} else {
  console.log("⚙️   Fetching remote source…");
  const fetchedRoot = fetchRemote(SOURCE, sourceType);
  tempDirToClean = fetchedRoot;
  workingDir = SCSS_SUBDIR ? path.join(fetchedRoot, SCSS_SUBDIR) : fetchedRoot;
  console.log(`  Working in: ${workingDir}\n`);
}

if (!fs.existsSync(workingDir)) {
  console.error(`❌  Directory not found: ${workingDir}`);
  if (SCSS_SUBDIR) console.error(`   (--scss-subdir="${SCSS_SUBDIR}" may be incorrect)`);
  process.exit(1);
}

console.log("⚙️   Finding SCSS entry files…");
const scssFiles = findScssFiles(workingDir);
console.log(`  Found ${scssFiles.length} entry file(s)${scssFiles.length === 0 ? " — will scan raw SCSS" : ""}.`);

console.log("\n⚙️   Compiling SCSS…");
const cssText = scssFiles.length > 0
  ? compileScss(scssFiles)
  : findScssFiles(workingDir)   // fallback: read raw scss text
      .concat(
        fs.readdirSync(workingDir)
          .filter(f => f.endsWith(".scss"))
          .map(f => path.join(workingDir, f))
      )
      .filter((v, i, a) => a.indexOf(v) === i)
      .map(f => { try { return fs.readFileSync(f, "utf8"); } catch { return ""; } })
      .join("\n");

console.log("\n⚙️   Extracting colours…");
const raw    = extractColours(cssText, workingDir);
const sorted = sortColours(raw);
console.log(`  Found ${sorted.length} unique colour${sorted.length !== 1 ? "s" : ""}.`);

console.log("\n⚙️   Building HTML…");
const sourceLabel = SCSS_SUBDIR ? `${SOURCE} → ${SCSS_SUBDIR}` : SOURCE;
const html = buildHtml(sorted, sourceLabel);
fs.mkdirSync(path.dirname(OUTPUT_HTML), { recursive: true });
fs.writeFileSync(OUTPUT_HTML, html, "utf8");

// Cleanup
if (tempDirToClean && !KEEP_TEMP) {
  try { fs.rmSync(tempDirToClean, { recursive: true, force: true }); } catch {}
}

console.log(`\n✅  Done → ${OUTPUT_HTML}\n`);
