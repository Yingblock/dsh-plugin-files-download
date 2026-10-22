/**
 * Browser half: one download control on every row of the file tree.
 *
 * The tree owns the row and the seat, this plugin owns the control. It renders
 * into `sidebar.right.files.row.actions`, the keyed cell the file tree renders
 * after a file's name, so nothing here knows how the tree is drawn and the tree
 * keeps working when this plugin is absent.
 *
 * The control is a link, not a fetch: the browser's own download manager then
 * owns progress, cancellation, and the saved name, and not one byte of the file
 * passes through the page. The Host route behind it streams the file from the
 * composed filesystem, so files far above any in-page buffer are fine.
 *
 * This artifact is loaded by the client module loader, which hands the factory
 * a `require` over the shared module table; only the specifiers declared in
 * package.json's `dsh.client.inject` are guaranteed to answer, so everything
 * else is built from `react` and the DOM directly.
 */

window.__ModuleLoader__.load({
  id: 'dsh-plugin-files-download',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports

    const react = require('react')

    /** The Host route the package's node half registers; private to the two halves. */
    const DOWNLOAD_PATH = '/api/workspace-file.download'

    /** The row control's stylesheet, injected once when the bundle materializes. */
    const STYLES = `
[data-dsh-files-download] {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  padding: 0;
  color: var(--dsw-alias-label-tertiary);
  background: transparent;
  border: 0;
  border-radius: 6px;
  cursor: pointer;
}

[data-dsh-files-download]:hover {
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-interactive-bg-hover);
}
`

    /** The glyph: a tray and a downward arrow, drawn at the row icons' 16px. */
    const GLYPH = [
      'M8 1.5a.75.75 0 0 1 .75.75v5.19l1.72-1.72a.75.75 0 1 1 1.06 1.06L8 10.31 4.47 6.78a.75.75 0 0 1 1.06-1.06l1.72 1.72V2.25A.75.75 0 0 1 8 1.5Z',
      'M2.75 10.5a.75.75 0 0 1 .75.75v1.25h9v-1.25a.75.75 0 0 1 1.5 0v2a.75.75 0 0 1-.75.75h-10.5a.75.75 0 0 1-.75-.75v-2a.75.75 0 0 1 .75-.75Z',
    ]

    const zh = {
      'action.download': '下载 {name}',
    }

    const en = {
      'action.download': 'Download {name}',
    }

    /**
     * One row's control.
     * @param view - framework-standard `sessionId`, the row's owner props, and this plugin's `t`.
     * @returns the download link for the row.
     */
    function DownloadAction({ sessionId, path, name, t }) {
      const href = `${DOWNLOAD_PATH}?sessionId=${encodeURIComponent(sessionId)}&path=${encodeURIComponent(path)}`
      const label = t('action.download', { name })
      return react.createElement('a', {
        'data-dsh-files-download': '',
        href,
        download: '',
        title: label,
        'aria-label': label,
      }, react.createElement('svg', {
        width: 16, height: 16, viewBox: '0 0 16 16', fill: 'currentColor', 'aria-hidden': 'true',
      }, GLYPH.map((d, index) => react.createElement('path', { key: index, d }))))
    }

    exports.inject = ['slots', 'locale']

    /**
     * Register the row control, its copy, and its stylesheet.
     *
     * `sidebar.right.files.row.actions` is a single seat the tree renders once
     * per file row, handing that row's absolute path and name down as owner
     * props. One registration therefore serves every row.
     * @param ctx - client context carrying the slot registry and the locale registry.
     */
    exports.apply = function apply(ctx) {
      const SEAT = 'sidebar.right.files.row.actions'
      let renders = 0
      globalThis.__DSH_FILES_DOWNLOAD__ = {
        apply: true,
        registered: false,
        get renders() { return renders },
        version: 'single-seat',
      }

      ctx.effect(() => ctx.locale.register('filesDownload', { zh, en }), 'files-download: dictionaries')
      ctx.effect(() => ctx.slots.inject(SEAT, () => ctx.slots.register(
        { name: SEAT, locale: 'filesDownload' },
        row => {
          renders += 1
          globalThis.__DSH_FILES_DOWNLOAD__.registered = true
          return DownloadAction(row)
        },
      )), 'files-download: row control')

      if (typeof document !== 'undefined') {
        const existing = document.querySelector('style[data-dsh-files-download]')
        if (existing === null) {
          const tag = document.createElement('style')
          tag.dataset.dshFilesDownload = ''
          tag.textContent = STYLES
          document.head.appendChild(tag)
        }
      }
    }

    return module.exports
  },
})
