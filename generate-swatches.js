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
const DEBUG       = !!flags["debug"];

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
    // Percentage alpha: rgba(255 255 255 / 80%) or rgba(255, 255, 255, 80%)
    const pct = str.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)[\s,\/]+([\d.]+)%\s*\)/);
    if (pct) return { r: +pct[1], g: +pct[2], b: +pct[3], a: +(+pct[4] / 100).toFixed(4) };

    // Standard: rgba(255, 255, 255, 0.8) or modern rgba(255 255 255 / 0.8)
    const m = str.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\/\s]+([\d.]+))?\s*\)/);
    if (m) return { r: +m[1], g: +m[2], b: +m[3], a: m[4] !== undefined ? +m[4] : 1 };

    // hsl/hsla: convert to rgb so it gets the same key as compiled output
    const hsl = str.match(/hsla?\(\s*([\d.]+)[,\s]+([\d.]+)%?[,\s]+([\d.]+)%?(?:[,\/\s]+([\d.]+)%?)?\s*\)/);
    if (hsl) {
        const h = +hsl[1] / 360, s = +hsl[2] / 100, l = +hsl[3] / 100;
        const a = hsl[4] !== undefined
            ? (hsl[4].includes('%') ? +hsl[4] / 100 : +hsl[4])
            : 1;
        const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
        const p = 2 * l - q;
        const hue2rgb = (t) => {
            if (t < 0) t += 1; if (t > 1) t -= 1;
            if (t < 1/6) return p + (q - p) * 6 * t;
            if (t < 1/2) return q;
            if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
            return p;
        };
        return {
            r: Math.round(hue2rgb(h + 1/3) * 255),
            g: Math.round(hue2rgb(h) * 255),
            b: Math.round(hue2rgb(h - 1/3) * 255),
            a,
        };
    }

    return null;
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

/**
 * Walk up from `startDir` collecting every node_modules directory found,
 * stopping at the filesystem root. Returns an array of absolute paths.
 * This lets sass resolve packages like `minireset.css` regardless of where
 * node_modules lives relative to the scss source tree.
 */
function findNodeModulesPaths(startDir) {
    const found = [];
    let current = path.resolve(startDir);
    while (true) {
        const candidate = path.join(current, "node_modules");
        if (fs.existsSync(candidate)) found.push(candidate);
        const parent = path.dirname(current);
        if (parent === current) break; // filesystem root
        current = parent;
    }
    return found;
}

function compileScss(scssFiles, scssDir) {
    // Build --load-path flags from every node_modules folder up the tree.
    // We search from the scss directory itself so monorepo/nested setups work.
    const nodeModulesPaths = findNodeModulesPaths(scssDir);
    const loadPathFlags = nodeModulesPaths
        .map(p => `--load-path="${p}"`)
        .join(" ");

    if (nodeModulesPaths.length > 0) {
        console.log(`  node_modules found at:`);
        nodeModulesPaths.forEach(p => console.log(`    ${p}`));
    }

    const chunks = [];
    for (const file of scssFiles) {
        console.log(`  Compiling : ${path.basename(file)}`);
        try {
            const cmd = `npx sass --no-source-map --style=expanded ${loadPathFlags} "${file}"`;
            const css = execSync(cmd, {
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

    // Collect all SCSS source from the directory first, then resolve in passes.
    // This is necessary because variables reference other variables:
    //   $red-stop: #ff7a60;
    //   $red-stop_20: rgba($red-stop, 0.20);   ← can't parse without knowing $red-stop
    //   $green-waiting: $green-two;             ← alias chain

    const sources = [];
    function walk(d) {
        for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
            const full = path.join(d, entry.name);
            if (entry.isDirectory()) walk(full);
            else if (entry.name.endsWith(".scss")) {
                if (DEBUG) process.stderr.write(`  [debug] scanning: ${path.relative(dir, full) || entry.name}\n`);
                sources.push(fs.readFileSync(full, "utf8"));
            }
        }
    }
    walk(dir);
    const allScss = sources.join("\n");

    // ── Pass 1: $var → literal hex  ──────────────────────────────────────────
    // e.g.  $red-stop: #ff7a60;
    const hexVars = new Map();
    const HEX_RE = /(\$[\w-]+)\s*:\s*(#[0-9a-fA-F]{3,8})\s*(?:!default\s*)?;/g;
    for (const m of allScss.matchAll(HEX_RE)) {
        const rgba = hexToRgba(m[2]);
        if (!rgba) continue;
        if (!hexVars.has(m[1])) hexVars.set(m[1], rgba);
        // Also register directly into varMap so $white, $blue etc get badges
        const k = colourKey(rgba);
        if (!varMap.has(k)) varMap.set(k, []);
        if (!varMap.get(k).includes(m[1])) varMap.get(k).push(m[1]);
    }

    // ── Pass 2: $var → $other-var (alias chains, one level)  ─────────────────
    // e.g.  $green-waiting: $green-two;
    const ALIAS_RE = /(\$[\w-]+)\s*:\s*(\$[\w-]+)\s*(?:!default\s*)?;/g;
    for (const m of allScss.matchAll(ALIAS_RE)) {
        if (!hexVars.has(m[1]) && hexVars.has(m[2])) {
            hexVars.set(m[1], hexVars.get(m[2]));
        }
    }
    // Second alias sweep to catch chains two levels deep
    for (const m of allScss.matchAll(ALIAS_RE)) {
        if (!hexVars.has(m[1]) && hexVars.has(m[2])) {
            hexVars.set(m[1], hexVars.get(m[2]));
        }
    }

    if (DEBUG) {
        process.stderr.write(`  [debug] hexVars resolved: ${hexVars.size}\n`);
        for (const [k, v] of hexVars) process.stderr.write(`    ${k} → rgb(${v.r},${v.g},${v.b})\n`);
    }

    // ── Pass 3: $var → rgba($other-var, alpha)  ───────────────────────────────
    // e.g.  $white_08: rgba($white, 0.08);
    const RGBA_VARREF_RE = /(\$[\w-]+)\s*:\s*rgba\(\s*(\$[\w-]+)\s*,\s*([\d.]+)\s*\)\s*(?:!default\s*)?;/g;
    for (const m of allScss.matchAll(RGBA_VARREF_RE)) {
        const declName = m[1];
        const base     = hexVars.get(m[2]);
        if (!base) {
            if (DEBUG) process.stderr.write(`    [skip] ${declName}: can't resolve ${m[2]}\n`);
            continue;
        }
        const rgba = { r: base.r, g: base.g, b: base.b, a: +m[3] };
        const k = colourKey(rgba);
        if (!varMap.has(k)) varMap.set(k, []);
        if (!varMap.get(k).includes(declName)) {
            varMap.get(k).push(declName);
            if (DEBUG) process.stderr.write(`    ${declName} → rgba(${rgba.r},${rgba.g},${rgba.b},${rgba.a}) key=${k}\n`);
        }
        // Also register the resolved base colour itself against the base var name
        const baseKey = colourKey(base);
        if (!varMap.has(baseKey)) varMap.set(baseKey, []);
    }

    // ── Pass 4: $var → rgba(#hex, alpha)  ────────────────────────────────────
    // e.g.  $querybg: rgba(#a56dff, 0.12);
    const RGBA_HEXREF_RE = /(\$[\w-]+)\s*:\s*rgba\(\s*(#[0-9a-fA-F]{3,8})\s*,\s*([\d.]+)\s*\)\s*(?:!default\s*)?;/g;
    for (const m of allScss.matchAll(RGBA_HEXREF_RE)) {
        const base = hexToRgba(m[2]);
        if (!base) continue;
        const rgba = { r: base.r, g: base.g, b: base.b, a: +m[3] };
        const k = colourKey(rgba);
        if (!varMap.has(k)) varMap.set(k, []);
        if (!varMap.get(k).includes(m[1])) {
            varMap.get(k).push(m[1]);
            if (DEBUG) process.stderr.write(`    ${m[1]} → rgba(${rgba.r},${rgba.g},${rgba.b},${rgba.a}) key=${k}\n`);
        }
    }

    // ── Pass 5: $var → rgba(r, g, b, alpha)  literal numbers  ────────────────
    // e.g.  $ai_accent_1: rgba(191, 57, 137, 1);
    const RGBA_LITERAL_RE = /(\$[\w-]+)\s*:\s*(rgba?\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+[^)]*\))\s*(?:!default\s*)?;/g;
    for (const m of allScss.matchAll(RGBA_LITERAL_RE)) {
        const rgba = rgbStringToRgba(m[2]);
        if (!rgba) continue;
        const k = colourKey(rgba);
        if (!varMap.has(k)) varMap.set(k, []);
        if (!varMap.get(k).includes(m[1])) {
            varMap.get(k).push(m[1]);
            if (DEBUG) process.stderr.write(`    ${m[1]} → key=${k}\n`);
        }
    }

    // ── Pass 6: CSS custom properties  ───────────────────────────────────────
    // e.g.  --white-08: rgba(255, 255, 255, 0.08);
    const CSS_VAR_RE = /(--[\w-]+)\s*:\s*(#[0-9a-fA-F]{3,8}|rgba?\([^)]+\))\s*;/g;
    for (const m of allScss.matchAll(CSS_VAR_RE)) {
        const raw = m[2].trim();
        const rgba = raw.startsWith("#") ? hexToRgba(raw) : rgbStringToRgba(raw);
        if (!rgba) continue;
        const k = colourKey(rgba);
        if (!varMap.has(k)) varMap.set(k, []);
        if (!varMap.get(k).includes(m[1])) varMap.get(k).push(m[1]);
    }

    if (DEBUG) process.stderr.write(`  [debug] varMap total entries: ${varMap.size}\n`);
}

function extractColours(cssText, scssDir) {
    const seen   = new Map();
    const varMap = new Map();

    if (DEBUG) process.stderr.write("\n[debug] === scanScssVars ===\n");
    scanScssVars(scssDir, varMap);
    if (DEBUG) process.stderr.write(`[debug] varMap has ${varMap.size} entries\n`);

    function processRgba(rgba) {
        if (!rgba) return;
        const k = colourKey(rgba);
        if (!seen.has(k)) seen.set(k, { hex: rgbaToHex(rgba), rgba, vars: [] });
    }

    // Pass 1: compiled CSS (most accurate — variables are resolved to their values)
    if (DEBUG) process.stderr.write("\n[debug] === Pass 1: compiled CSS ===\n");
    for (const pat of [/#([0-9a-fA-F]{8})\b/g, /#([0-9a-fA-F]{6})\b/g, /#([0-9a-fA-F]{3})\b/g]) {
        let m; pat.lastIndex = 0;
        while ((m = pat.exec(cssText)) !== null) processRgba(hexToRgba(m[0]));
    }
    for (const m of cssText.matchAll(/(?:rgba?|hsla?)\([^)]+\)/g)) processRgba(rgbStringToRgba(m[0]));
    if (DEBUG) process.stderr.write(`[debug] seen after pass 1: ${seen.size} colours\n`);

    // Pass 2: raw SCSS source files — catches colours from files that failed to
    // compile (e.g. missing npm imports) and ensures every declared colour is
    // present in `seen` so varMap entries are never silently dropped.
    if (DEBUG) process.stderr.write("\n[debug] === Pass 2: raw SCSS scan ===\n");
    function walkScss(d) {
        for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
            const full = path.join(d, entry.name);
            if (entry.isDirectory()) walkScss(full);
            else if (entry.name.endsWith(".scss")) {
                const src = fs.readFileSync(full, "utf8");
                for (const pat of [/#([0-9a-fA-F]{8})\b/g, /#([0-9a-fA-F]{6})\b/g, /#([0-9a-fA-F]{3})\b/g]) {
                    let m; pat.lastIndex = 0;
                    while ((m = pat.exec(src)) !== null) processRgba(hexToRgba(m[0]));
                }
                for (const m of src.matchAll(/(?:rgba?|hsla?)\([^)]+\)/g)) {
                    const rgba = rgbStringToRgba(m[0]);
                    if (DEBUG && rgba) process.stderr.write(`  "${m[0]}" → key: ${colourKey(rgba)}\n`);
                    processRgba(rgba);
                }
            }
        }
    }
    if (fs.existsSync(scssDir)) walkScss(scssDir);
    if (DEBUG) process.stderr.write(`[debug] seen after pass 2: ${seen.size} colours\n`);

    // Attach variable names from the varMap to every matched colour
    if (DEBUG) process.stderr.write("\n[debug] === var attachment ===\n");
    for (const [k, entry] of seen) {
        entry.vars = varMap.get(k) || [];
        if (DEBUG && entry.vars.length > 0) process.stderr.write(`  ${k} → [${entry.vars.join(", ")}]\n`);
    }
    if (DEBUG) process.stderr.write(`[debug] colours with vars: ${[...seen.values()].filter(e => e.vars.length).length}\n`);

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
    ? compileScss(scssFiles, workingDir)
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
