# dsh-plugin-files-download

Give every file row of the [DSH](https://github.com/deepseek-ai/deepseek-harness) web GUI's file tree a download button. One click saves the file under its own name, streamed from the Host — no size cap, nothing buffered in the page.

**中文说明见 [README.zh.md](README.zh.md)。**

```
Files  /home/me/project
├─ src/                        ← directories: no control
├─ README.md                ↓  ← files: download, always visible
└─ package.json             ↓
```

## What it adds

| Half | File | Role |
|---|---|---|
| Host | `lib/index.js` | Registers `GET\|HEAD /api/workspace-file.download?sessionId=…&path=…` inside the Connection authentication fence. Resolves the Session's workspace root the way the Remote lookups do, `stat`s the file to reject a missing path / directory / symlink, then streams the bytes in 1 MiB windows through `ctx.workspaceFiles` with `content-disposition: attachment` and the file's own name. |
| Browser | `lib/client.js` | Registers one cell into the file tree's `sidebar.right.files.row.actions` seat. The cell is a plain `<a download>` pointing at that route, so the browser's own download manager owns progress, cancellation, and the saved name. |

The file tree is not reimplemented: the seat is declared by `@deepseek-ai/dsh-client-ui-sidebar-files`, and this package only fills it.

## Requirements

The mounted `@deepseek-ai/dsh-client-ui-sidebar-files` client bundle must declare the `sidebar.right.files.row.actions` seat. Stock DSH releases before that seat existed **do not have it** — with such a bundle this plugin's registration fails loudly in the browser-half load report instead of half-rendering. See [Requires the seat](#requires-the-seat) for the one-file-per-package patch.

- DSH version: any build whose `ui-sidebar-files` declares the seat (see above)
- Node: >= 22 (the Host half uses `AbortSignal.any` and WHATWG `ReadableStream`)
- Browser: any modern one; the download is a normal navigation, no client-only APIs

## Install

The package ships prebuilt JavaScript, so installing needs **no build step**.

```sh
# straight from GitHub (pnpm forwards git specs unchanged)
dsh plugin --profile web add github:Yingblock/dsh-plugin-files-download

# or from a checkout / tarball
dsh plugin --profile web add /path/to/dsh-plugin-files-download
```

Or add the row by hand to the profile's `cordis.patch.yml`:

```yaml
- insert:
    - id: files-download
      name: dsh-plugin-files-download
```

**Restart `dsh web` afterwards.** The browser's client boot graph is composed at startup, so a running page keeps the graph it loaded with.

Then **hard-refresh the browser** (`Ctrl+Shift+R`). Bundle HMR only applies automatically while `pnpm run dev:web` is running.

### Uninstall

```sh
dsh plugin --profile web remove dsh-plugin-files-download
```

## Use

1. Open the right Sidebar's **Files** tab.
2. Every file row shows a `↓` control at its right edge, always visible (no hover needed). Directory rows show nothing.
3. Click it — the browser saves the file under its own name.

The control is a real navigation to the Host route, not a page-side fetch, so multi-hundred-MB files stream straight to disk.

## Requires the seat

The `sidebar.right.files.row.actions` seat belongs in the file tree's own package, because the tree owns the row it appears in. It is four small files in `packages/client/ui-sidebar-files`:

| File | Change |
|---|---|
| `src/client/slot-contract.ts` (new) | Declares the seat: `kind: 'single'`, `scope: 'session'`, owner props `{ path, name }` |
| `src/client/index.ts` | The files tab body declares it: `children: { 'sidebar.right.files.row.actions': { kind: 'single', scope: 'session' } }` |
| `src/client/FilesBody.tsx` | Renders it per file row: `renderSlot('sidebar.right.files.row.actions', { path, name })` inside the row |
| `src/client/FilesBody.module.css` | Row becomes `display:flex`; the action container is `flex: 0 0 auto` |

Then rebuild that one package:

```sh
tsc -b packages/client/ui-sidebar-files
pnpm --filter @deepseek-ai/dsh-client-ui-sidebar-files run bundle
```

Restart `dsh web` and hard-refresh the browser.

> **Why `single` and not `keyed`?** A keyed seat dispatches by *registration key* (`entriesOfSlot(key).find(e => e.options.key === entryKey)`), and its key domain is fixed at compile time. The file rows are a runtime set the plugin cannot enumerate, so a constant registration key would never match the tree's per-row dispatch key — the cell stays on the ledger and never renders. One `single` seat rendered once per row, carrying the row's identity in owner props, is the correct shape.

## Verify

Server side — no cookie required to see that the route sits behind authentication:

```sh
curl -s -o /dev/null -w '%{http_code}\n' \
  'http://127.0.0.1:3080/api/workspace-file.download?sessionId=x&path=y'
# 401 (unauthenticated)
```

Statuses once authenticated:

| Case | Response |
|---|---|
| OK | `200`, streamed bytes, `content-disposition: attachment` |
| Missing `sessionId`/`path` | `400 missing sessionId or path query parameter` |
| Unknown session | `404 session not found` |
| Missing file | `404` |
| Not a regular file | `422` |

Client side, in the browser console:

```js
JSON.stringify(globalThis.__DSH_FILES_DOWNLOAD__)
// {"apply":true,"registered":true,"renders":9,"version":"single-seat"}
// `renders` equals the number of file rows currently rendered.
```

`globalThis.__DSH_FILES_DOWNLOAD__` is a read-only diagnostic object; it adds no UI and no render work.

## Limits

- **Files only.** No directory/zip download.
- **Session scope.** The route resolves the Session's workspace root from the live Session header, falling back to persistence's header-only stat for a cold Session. The GUI's current Session is always live, so this is transparent in normal use.
- **Read authority is `ctx.fs`'s.** A file the composed filesystem can read can be downloaded, including paths outside the workspace — the same authority the built-in preview uses.
- **The saved name is the file's own basename.** Platform-illegal or colliding names are the browser's to handle; this package does not rewrite them.
- **Always visible, by design.** The control does not depend on hover. To make it hover-only, restore `opacity: 0` on `.actions` plus an `.item:hover .actions` rule in the tree's stylesheet.

## License

MIT — see [LICENSE](LICENSE).
