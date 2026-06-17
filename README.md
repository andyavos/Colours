# SCSS Colour Swatch Generator

Compiles SCSS from a **local directory or remote source**, extracts every colour value used, and writes a self-contained HTML reference page with searchable, copy-on-click swatches.

---

## Features

- Points at a local path, a GitHub/GitLab/Bitbucket repo, an SSH git URL, or a remote ZIP/tarball
- Shallow-clones remote repos (`--depth=1`) so large codebases stay fast
- Compiles SCSS entry files (non-partials) via the `sass` CLI
- Falls back to raw SCSS scanning when compilation isn't possible
- Detects `$variable` names and displays them as badges on each swatch
- Handles hex (`#fff`, `#ffffff`, `#ffffffff`), `rgb()`, and `rgba()` values
- Deduplicates colours and sorts by hue then luminance
- Alpha channel indicator on semi-transparent swatches
- Click any HEX or RGBA value to copy it to the clipboard
- Live search — filter by hex, rgba string, or SCSS variable name
- Single self-contained HTML file output — no dependencies at runtime

---

## Requirements

| Tool | Purpose | Required? |
|------|---------|-----------|
| Node.js ≥ 16 | Runs the script | Always |
| `sass` (npm) | Compiles SCSS | For compilation (auto-installed via npm install) |
| `git` | Clones remote repos | Only for git sources |
| `curl` or `wget` | Downloads ZIP/tarball | Only for archive sources |
| `unzip` or `python3` | Extracts ZIP archives | Only for `.zip` sources |
| `tar` | Extracts tarballs | Only for `.tar.gz` sources |

Install the Node dependency:

```bash
npm install
```

---

## Usage

```
node generate-swatches.js [source] [output-html] [options]
```

### Arguments

| Argument | Description | Default |
|----------|-------------|---------|
| `source` | Local path, git URL, or archive URL (see below) | `./scss` |
| `output-html` | Path to write the HTML file | `./swatches.html` |

### Options

| Flag | Description |
|------|-------------|
| `--scss-subdir=<path>` | Subdirectory within a cloned/extracted repo to scan |
| `--branch=<name>` | Git branch to clone (default: repo's default branch) |
| `--output=<path>` | Alternative to the positional output argument |
| `--keep-temp` | Keep the temporary clone/extract directory after running |

---

## Examples

### Local directory

```bash
node generate-swatches.js ./scss
node generate-swatches.js ./src/styles ./dist/swatches.html
```

### GitHub repository

```bash
# Whole repo
node generate-swatches.js https://github.com/org/repo

# Specific subdirectory within the repo
node generate-swatches.js https://github.com/twbs/bootstrap --scss-subdir=scss

# Specific branch
node generate-swatches.js https://github.com/org/repo --branch=develop --scss-subdir=assets/scss
```

### GitLab / Bitbucket

```bash
node generate-swatches.js https://gitlab.com/org/repo --scss-subdir=src/scss
node generate-swatches.js https://bitbucket.org/org/repo --scss-subdir=styles
```

### SSH git URL

```bash
node generate-swatches.js git@github.com:org/private-repo.git --scss-subdir=scss
```

> Requires your SSH key to be authorised for the remote. The key used is whatever `git` picks up from your SSH agent or `~/.ssh/config`.

### Remote ZIP or tarball

```bash
node generate-swatches.js https://example.com/theme.zip --scss-subdir=theme/scss
node generate-swatches.js https://example.com/styles.tar.gz
```

### npm scripts

```bash
# Uses defaults: ./scss → ./swatches.html
npm run swatches

# Bootstrap's SCSS from GitHub
npm run swatches:bootstrap

# Custom paths
npm run swatches:custom
```

---

## How it works

```
Source (local / git / zip / tarball)
        │
        ▼
  Resolve working directory
  (clone / download / extract if remote)
        │
        ▼
  Find non-partial SCSS entry files
  (files not prefixed with _)
        │
        ▼
  Compile each via: npx sass --no-source-map --style=expanded
  (compilation failures fall back to raw SCSS text)
        │
        ▼
  Scan compiled CSS for colour values
  • hex:  #rgb  #rrggbb  #rrggbbaa
  • func: rgb()  rgba()
        │
        ▼
  Scan raw SCSS for $variable declarations
  and match them back to extracted colours
        │
        ▼
  Deduplicate → sort by hue then luminance
        │
        ▼
  Write self-contained swatches.html
        │
        ▼
  Clean up temp directory (unless --keep-temp)
```

---

## Output page

The generated HTML file has no external dependencies and can be opened directly in any browser or committed to a repo as a living style reference.

Each swatch shows:
- A colour preview block (text label colour is auto-chosen for contrast)
- The HEX value — click to copy
- The RGB/RGBA value — click to copy
- Any `$variable` names that map to this colour, as badges
- An **α** badge on colours with an alpha channel

The toolbar search filters swatches in real time by hex value, rgba string, or variable name.

---

## Troubleshooting

**`sass` compilation fails with "Can't find stylesheet to import"** — this usually means a `@use` or `@import` references an npm package (e.g. `@use "minireset.css/minireset.css"`). The script automatically walks up the directory tree from the SCSS source and passes every `node_modules` folder it finds as a `--load-path` to `sass`. If it still fails, make sure you've run `npm install` (or the equivalent) in the project that owns the SCSS so the packages are physically present on disk.

**`sass` compilation fails for other reasons** — the script falls back to extracting colours from the raw SCSS source. Variables and mixins won't be expanded, but literal colour values will still be captured. Run `npm install` if `sass` isn't installed yet.

**`git clone` fails** — check that `git` is installed and in your `PATH`. For private repos over HTTPS you may need to supply credentials via a `.netrc` file or a credential helper. For SSH URLs, ensure your key is loaded (`ssh-add`).

**Wrong subdirectory** — if you see 0 colours from a remote repo, the SCSS may live in a subdirectory. Use `--keep-temp` on the first run to inspect the cloned structure, then rerun with the correct `--scss-subdir`.

**ZIP extraction fails** — the script tries `unzip` first, then falls back to `python3 -m zipfile`. Install either one.
