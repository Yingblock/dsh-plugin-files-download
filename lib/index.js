/**
 * The download route: one authenticated `GET` that streams a workspace file to
 * the browser under its own name.
 *
 * The file tree's download button cannot use an ordinary `dsh-resource://`
 * address, because a browser save has to be a real response with a
 * `content-disposition` header, and it must not be capped at the Remote byte
 * window. This route is that response: it resolves the Session's workspace root
 * the same way the Remote lookups do, streams the file through the composed
 * filesystem in bounded windows, and never buffers the whole file on either
 * side.
 *
 * The button and the route ship together, so the path is a private constant of
 * this package rather than a shared contract.
 */

/** The download route path, below the Web carrier's `/api` namespace. */
export const DOWNLOAD_PATH = '/api/workspace-file.download'

/** Bytes one streaming window asks the filesystem for. */
const WINDOW_BYTES = 1 << 20

/** Media types for the extensions worth naming; everything else is opaque bytes. */
const MEDIA_TYPES = {
  css: 'text/css',
  csv: 'text/csv',
  gif: 'image/gif',
  html: 'text/html',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  js: 'text/javascript',
  json: 'application/json',
  md: 'text/markdown',
  mjs: 'text/javascript',
  mp3: 'audio/mpeg',
  mp4: 'video/mp4',
  pdf: 'application/pdf',
  png: 'image/png',
  svg: 'image/svg+xml',
  txt: 'text/plain',
  wasm: 'application/wasm',
  webp: 'image/webp',
  xml: 'application/xml',
  yaml: 'text/yaml',
  yml: 'text/yaml',
  zip: 'application/zip',
}

/** Services the download route needs; all four are provided by the Web composition. */
export const inject = ['connection', 'sessions', 'sandboxPolicy', 'workspaceFiles']

/**
 * Register the download route inside Connection's authentication fence.
 * @param ctx - host context carrying the route registry, the Session store, the sandbox root fallback, and the workspace file service.
 */
export function apply(ctx) {
  ctx.connection.fetch.register({
    path: DOWNLOAD_PATH,
    methods: ['GET', 'HEAD'],
    requestBody: 'buffered',
    fetch: request => downloadResponse(ctx, request),
  })
}

/**
 * One download request: validate its coordinates, then stream the file.
 * @param ctx - the composed host context.
 * @param request - the authenticated request; its signal is the download's lifetime.
 * @returns the file response, or a bodiless status when the file cannot be served.
 */
async function downloadResponse(ctx, request) {
  const query = new URL(request.url).searchParams
  const sessionId = query.get('sessionId')
  const path = query.get('path')
  if (sessionId === null || sessionId === '' || path === null || path === '') {
    return new Response('missing sessionId or path query parameter', { status: 400 })
  }
  const { signal } = request
  try {
    signal.throwIfAborted()
    const scope = await workspaceScopeOf(ctx, sessionId)
    if (scope === undefined) return new Response('session not found', { status: 404 })
    // One stat up front: it rejects a missing path, a directory, and a symlink
    // before any byte of the response exists, and it names the size.
    const stat = await ctx.workspaceFiles.stat(scope, path, signal)
    const name = basenameOf(stat.absolutePath, path)
    // The route hands the browser a real file save, so the file name is
    // sanitized: control characters, separators, and the two dot segments
    // cannot shape the header or the saved path.
    const headers = {
      'content-type': MEDIA_TYPES[extensionOf(name)] ?? 'application/octet-stream',
      'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
      'cache-control': 'no-store',
      ...(stat.bytes === undefined ? {} : { 'content-length': String(stat.bytes) }),
    }
    if (request.method === 'HEAD') return new Response(null, { status: 200, headers })
    return new Response(streamFile(ctx, scope, path, signal), { status: 200, headers })
  } catch (error) {
    signal.throwIfAborted()
    return new Response(clientFailure(error), { status: statusOf(error), headers: { 'cache-control': 'no-store' } })
  }
}

/**
 * The workspace resolution every file operation takes, resolved here the way
 * the Remote lookup does: the live Session's header first, then persistence's
 * header-only read for a cold Session, and the deployment root when the chosen
 * header has no working directory.
 * @param ctx - the composed host context.
 * @param sessionId - the Session identity the tree was drawn for.
 * @returns the file scope, or `undefined` when neither source knows the Session.
 */
async function workspaceScopeOf(ctx, sessionId) {
  const live = ctx.sessions.get(sessionId)?.header
  const stored = live === undefined ? await ctx.get('sessionPersistence')?.stat(sessionId) : undefined
  const header = live ?? stored?.header
  if (header === undefined) return undefined
  return { sessionId, workspaceRoot: header.cwd ?? ctx.sandboxPolicy.workspaceRoot }
}

/**
 * Stream one file as a WHATWG `ReadableStream`, one bounded window at a time.
 *
 * The stream pulls: nothing is read before the consumer asks, so a browser that
 * stops accepting bytes (a cancelled download, a stalled socket) stops the
 * filesystem work instead of queueing the rest of the file in memory. A
 * producer error fails the stream rather than ending it, so a truncated
 * download is never presented as a complete file.
 * @param ctx - the composed host context.
 * @param scope - resolved workspace scope for the addressed Session.
 * @param path - the requested path, absolute or workspace-relative.
 * @param signal - the request's cancellation.
 * @returns the file's bytes.
 */
function streamFile(ctx, scope, path, signal) {
  const decodersReady = typeof Buffer !== 'undefined'
  const decode = data => decodersReady
    ? Buffer.from(data, 'base64')
    : Uint8Array.from(atob(data), character => character.charCodeAt(0))
  let offset = 0
  let done = false
  return new ReadableStream({
    async pull(controller) {
      if (done) {
        controller.close()
        return
      }
      try {
        const window = await ctx.workspaceFiles.readBytes(scope, path, { offset, length: WINDOW_BYTES }, signal)
        const bytes = decode(window.data)
        offset = window.offset + bytes.byteLength
        done = window.eof || bytes.byteLength === 0
        if (bytes.byteLength > 0) controller.enqueue(bytes)
        if (done) controller.close()
      } catch (error) {
        controller.error(error)
      }
    },
  }, { highWaterMark: 2 * WINDOW_BYTES, size: chunk => chunk.byteLength })
}

/** The last path segment, whatever separators the host reports. */
function basenameOf(absolutePath, requestedPath) {
  const source = absolutePath === '' ? requestedPath : absolutePath
  const trimmed = source.replace(/[/\\]+$/u, '')
  const cut = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  const name = trimmed.slice(cut + 1)
  return name === '' || name === '.' || name === '..' ? 'download' : name
}

/** The lower-cased extension of a file name, without its dot. */
function extensionOf(name) {
  const dot = name.lastIndexOf('.')
  return dot <= 0 ? '' : name.slice(dot + 1).toLowerCase()
}

/** The HTTP status one failure deserves: absence and wrong kind are the client's, everything else is ours. */
function statusOf(error) {
  const remote = remoteErrorOf(error)
  if (remote !== undefined) {
    if (remote.code === 'workspace-file/not-found' || remote.code === 'session/not-found') return 404
    if (remote.code === 'workspace-file/not-regular-file') return 422
  }
  return error?.code === 'ENOENT' || error?.code === 'ENOTDIR' ? 404 : 500
}

/**
 * A short client-facing reason for one failure. The message is never the
 * service's own: an internal error can name absolute host paths, which do not
 * belong in a browser response.
 * @param error - the thrown failure.
 * @returns a stable reason phrase.
 */
function clientFailure(error) {
  const remote = remoteErrorOf(error)
  if (remote !== undefined) return remote.code
  if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return 'workspace-file/not-found'
  return 'workspace-file/unavailable'
}

/**
 * Recognize one of this package's own Remote failures without importing the
 * protocol package: the marker plus a string code is the documented shape.
 * @param value - an unknown thrown value.
 * @returns the failure code, or `undefined` when the value is not one.
 */
function remoteErrorOf(value) {
  if (typeof value === 'object' && value !== null
    && value.isDSHRemoteError === true && typeof value.code === 'string') {
    return value
  }
  return undefined
}
