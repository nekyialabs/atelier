import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import MarkdownIt from 'markdown-it'
import { safeResolveVaultPath } from '../core/path-guards.js'
import { expandWikilinksToMarkdown } from '../core/wikilink.js'

const markdownRenderer = new MarkdownIt({ html: true, linkify: false, typographer: true })

type PreviewTheme = 'light' | 'dark'

function resolveTheme(value: string | null | undefined): PreviewTheme {
  return value === 'dark' ? 'dark' : 'light'
}

function renderMarkdownDocument(content: string, relativePath: string, theme: PreviewTheme = 'light'): string {
  const stripped = content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '')
  const expandedWikilinks = expandWikilinksToMarkdown(stripped)

  const body = markdownRenderer.render(expandedWikilinks)
  const escapedTitle = path.basename(relativePath).replace(/&/g, '&amp;').replace(/</g, '&lt;')

  const palette =
    theme === 'dark'
      ? {
          bg: '#16171a',
          fg: '#f0ede5',
          link: '#7ad7c5',
          codeBg: '#1d1e22',
          codeFg: '#cdc6b9',
          quoteBorder: '#7ad7c5',
          quoteFg: '#cdc6b9',
          rule: 'rgba(255, 255, 255, 0.12)',
          tableHeaderBg: '#1d1e22',
          tableBorder: 'rgba(255, 255, 255, 0.12)',
          colorScheme: 'dark',
        }
      : {
          bg: '#faf9f5',
          fg: '#1a1815',
          link: '#0d6f5e',
          codeBg: '#f1efe7',
          codeFg: '#1a1815',
          quoteBorder: '#0d6f5e',
          quoteFg: '#44403a',
          rule: 'rgba(20, 18, 12, 0.12)',
          tableHeaderBg: '#f1efe7',
          tableBorder: 'rgba(20, 18, 12, 0.12)',
          colorScheme: 'light',
        }

  return `<!doctype html>
<html lang="en" data-theme="${theme}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapedTitle}</title>
<style>
  :root { color-scheme: ${palette.colorScheme}; }
  body {
    margin: 0;
    padding: 56px 32px 96px;
    background: ${palette.bg};
    color: ${palette.fg};
    font-family: Newsreader, "Iowan Old Style", Georgia, serif;
    font-size: 18px;
    line-height: 1.65;
  }
  main { max-width: 720px; margin: 0 auto; }
  h1, h2, h3, h4 {
    font-family: Newsreader, Georgia, serif;
    font-weight: 500;
    letter-spacing: -0.015em;
    line-height: 1.2;
    margin-top: 1.6em;
    margin-bottom: 0.5em;
  }
  h1 { font-size: 2.2em; margin-top: 0; }
  h2 { font-size: 1.5em; }
  h3 { font-size: 1.2em; }
  p { margin: 0 0 1em; }
  a { color: ${palette.link}; text-decoration: underline; text-underline-offset: 3px; }
  ul, ol { padding-left: 1.4em; }
  li { margin-bottom: 0.4em; }
  blockquote {
    margin: 1.2em 0;
    padding: 0.4em 1em;
    border-left: 3px solid ${palette.quoteBorder};
    color: ${palette.quoteFg};
    font-style: italic;
  }
  code {
    font-family: ui-monospace, "Cascadia Code", Consolas, monospace;
    font-size: 0.9em;
    background: ${palette.codeBg};
    color: ${palette.codeFg};
    padding: 0.1em 0.35em;
    border-radius: 4px;
  }
  pre {
    margin: 1.2em 0;
    padding: 1em;
    background: ${palette.codeBg};
    color: ${palette.codeFg};
    border-radius: 8px;
    overflow-x: auto;
    line-height: 1.5;
  }
  pre code { background: transparent; padding: 0; font-size: 0.85em; }
  hr { border: 0; border-top: 1px solid ${palette.rule}; margin: 2em 0; }
  img { max-width: 100%; border-radius: 8px; }
  table { border-collapse: collapse; width: 100%; margin: 1em 0; }
  th, td { border: 1px solid ${palette.tableBorder}; padding: 0.5em 0.75em; text-align: left; }
  th { background: ${palette.tableHeaderBg}; font-weight: 600; }
</style>
</head>
<body>
<main>
${body}
</main>
</body>
</html>`
}

const MIME_TYPES: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.htm': 'text/html; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.webp': 'image/webp',
}

const NAVIGATION_SCRIPT = `<script>
(function () {
  if (window.__atelierInjected) return;
  window.__atelierInjected = true;

  function decodePreviewPath(pathname) {
    var stripped = pathname.replace(/^\\/preview\\//, '').replace(/^\\/+/, '');
    try { return decodeURIComponent(stripped); } catch (e) { return stripped; }
  }

  function postNavigate(relativePath) {
    window.parent.postMessage({ source: 'atelier-preview', type: 'navigate', relativePath: relativePath }, '*');
  }

  function postExternal(href) {
    window.parent.postMessage({ source: 'atelier-preview', type: 'open-external', href: href }, '*');
  }

  document.addEventListener('click', function (event) {
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

    var node = event.target;
    while (node && node.tagName !== 'A') node = node.parentElement;
    if (!node) return;

    var href = node.getAttribute('href');
    if (!href) return;
    if (href.charAt(0) === '#') return;

    var protocolMatch = href.match(/^[a-zA-Z][a-zA-Z\\d+.\\-]*:/);
    if (protocolMatch) {
      var protocol = protocolMatch[0].toLowerCase();
      if (protocol === 'http:' || protocol === 'https:' || protocol === 'mailto:' || protocol === 'tel:') {
        event.preventDefault();
        postExternal(href);
      }
      return;
    }

    event.preventDefault();
    try {
      var resolved = new URL(href, window.location.href);
      if (resolved.origin !== window.location.origin) {
        postExternal(resolved.href);
        return;
      }
      postNavigate(decodePreviewPath(resolved.pathname));
    } catch (e) {
      // Unresolvable, ignore
    }
  }, true);

  // Forward app-level keyboard shortcuts that the iframe would otherwise
  // swallow, so they behave the same whether focus is inside the preview or not.
  document.addEventListener('keydown', function (event) {
    if (!(event.ctrlKey || event.metaKey)) return;
    var key = (event.key || '').toLowerCase();
    if (key !== 's' && key !== 'k' && key !== 'n') return;
    event.preventDefault();
    window.parent.postMessage(
      { source: 'atelier-preview', type: 'shortcut', key: key, shiftKey: event.shiftKey === true },
      '*'
    );
  }, true);

  // Respond to host-initiated commands (e.g. clicking an outline heading).
  window.addEventListener('message', function (event) {
    var data = event.data;
    if (!data || data.source !== 'atelier-host') return;
    if (data.type === 'scroll-to-heading' && typeof data.index === 'number') {
      var headings = document.querySelectorAll('h1, h2, h3, h4, h5, h6');
      var target = headings[data.index];
      if (target && typeof target.scrollIntoView === 'function') {
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }
  }, false);
})();
</script>`

function injectNavigationScript(html: string): string {
  if (html.includes('</body>')) {
    return html.replace('</body>', `${NAVIGATION_SCRIPT}</body>`)
  }
  return `${html}${NAVIGATION_SCRIPT}`
}

export class PreviewServer {
  private server?: Server
  private port?: number
  private vaultRoot?: string
  private readonly unsavedContent = new Map<string, string>()

  async start(vaultRoot: string): Promise<string> {
    this.vaultRoot = vaultRoot

    if (!this.server) {
      this.server = createServer((request, response) => {
        void this.handleRequest(request, response)
      })

      await new Promise<void>((resolve, reject) => {
        this.server!.once('error', reject)
        this.server!.listen(0, '127.0.0.1', () => {
          this.server!.off('error', reject)
          const address = this.server!.address()
          if (!address || typeof address === 'string') {
            reject(new Error('Unable to allocate preview port.'))
            return
          }

          this.port = address.port
          resolve()
        })
      })
    }

    return this.baseUrl
  }

  get baseUrl(): string {
    if (!this.port) {
      throw new Error('Preview server has not started.')
    }

    return `http://127.0.0.1:${this.port}`
  }

  getPreviewUrl(relativePath: string): string {
    return `${this.baseUrl}/preview/${encodeRelativePath(relativePath)}`
  }

  setUnsavedContent(relativePath: string, content: string): string {
    this.unsavedContent.set(relativePath, content)
    return this.getPreviewUrl(relativePath)
  }

  clearUnsavedContent(relativePath: string): void {
    this.unsavedContent.delete(relativePath)
  }

  updateVaultRoot(vaultRoot: string): void {
    this.vaultRoot = vaultRoot
    this.unsavedContent.clear()
  }

  async stop(): Promise<void> {
    if (!this.server) {
      return
    }

    await new Promise<void>((resolve) => {
      this.server!.close(() => resolve())
    })
    this.server = undefined
    this.port = undefined
    this.unsavedContent.clear()
  }

  private async handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (!this.vaultRoot || !request.url) {
      sendStatus(response, 503, 'Preview server is not ready.')
      return
    }

    const requestUrl = new URL(request.url, this.baseUrl)
    const relativePath = decodeRequestPath(requestUrl.pathname)
    const theme = resolveTheme(requestUrl.searchParams.get('theme'))

    if (!relativePath) {
      sendStatus(response, 404, 'Not found.')
      return
    }

    const unsavedContent = this.unsavedContent.get(relativePath)
    if (unsavedContent !== undefined) {
      if (isMarkdownPath(relativePath)) {
        const rendered = renderMarkdownDocument(unsavedContent, relativePath, theme)
        const injected = injectNavigationScript(rendered)
        send(response, 200, 'text/html; charset=utf-8', Buffer.from(injected, 'utf8'))
        return
      }
      if (isHtmlPath(relativePath)) {
        const injected = injectNavigationScript(unsavedContent)
        send(response, 200, 'text/html; charset=utf-8', Buffer.from(injected, 'utf8'))
        return
      }
    }

    try {
      const absolutePath = safeResolveVaultPath(this.vaultRoot, relativePath)
      const data = await fs.readFile(absolutePath)

      if (isMarkdownPath(relativePath)) {
        const rendered = renderMarkdownDocument(data.toString('utf8'), relativePath, theme)
        const injected = injectNavigationScript(rendered)
        send(response, 200, 'text/html; charset=utf-8', Buffer.from(injected, 'utf8'))
        return
      }

      if (isHtmlPath(relativePath)) {
        const injected = injectNavigationScript(data.toString('utf8'))
        send(response, 200, 'text/html; charset=utf-8', Buffer.from(injected, 'utf8'))
        return
      }

      send(response, 200, getMimeType(relativePath), data)
    } catch {
      sendStatus(response, 404, 'Not found.')
    }
  }
}

function decodeRequestPath(pathname: string): string | null {
  const decoded = decodeURIComponent(pathname)
  const withoutPreviewPrefix = decoded.startsWith('/preview/')
    ? decoded.slice('/preview/'.length)
    : decoded.replace(/^\/+/, '')

  return withoutPreviewPrefix || null
}

function encodeRelativePath(relativePath: string): string {
  return relativePath
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/')
}

function getMimeType(relativePath: string): string {
  return MIME_TYPES[path.extname(relativePath).toLowerCase()] ?? 'application/octet-stream'
}

function isHtmlPath(relativePath: string): boolean {
  return ['.html', '.htm'].includes(path.extname(relativePath).toLowerCase())
}

function isMarkdownPath(relativePath: string): boolean {
  return ['.md', '.markdown'].includes(path.extname(relativePath).toLowerCase())
}

function send(response: ServerResponse, status: number, contentType: string, body: Buffer): void {
  response.writeHead(status, {
    'Content-Type': contentType,
    'Content-Length': body.byteLength,
    'Cache-Control': 'no-store',
  })
  response.end(body)
}

function sendStatus(response: ServerResponse, status: number, message: string): void {
  send(response, status, 'text/plain; charset=utf-8', Buffer.from(message, 'utf8'))
}
