#!/usr/bin/env node
import { promises as fs, realpathSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import chokidar from 'chokidar'
import type { CliResult, VaultContext, VaultIndex, VaultLink } from '../src/shared/types.js'
import { normalizeRelativePath } from '../core/path-guards.js'
import { createVaultContext } from '../core/vault-context.js'
import { createVaultIndex, shouldIgnoreEntry } from '../core/vault-indexer.js'
import {
  createDocument,
  createDocumentFromTitle,
  createFolder,
  createVault,
  deleteFile,
  duplicateFile,
  importFiles,
  lintVault,
  moveFile,
  renameFile,
  searchVault,
  updateDocument,
  type LintIssue,
  type LintResult,
  type SearchField,
  type SearchResult,
} from '../core/vault-ops.js'
import { fillTemplate, listTemplates, readTemplateBody, readVaultConfig } from '../core/vault-config.js'

const SCHEMA_VERSION = 1

const VALUE_FLAGS = new Set(['file', 'in', 'limit', 'content', 'format', 'title', 'name', 'to', 'template', 'target'])

interface RunResult {
  exitCode: number
  stdout: string
  stderr: string
}

interface ParsedArgs {
  args: string[]
  flags: Set<string>
  values: Map<string, string>
}

interface CliOverrides {
  stdinReader?: () => Promise<string>
  watcherFactory?: typeof chokidar.watch
  shouldKeepWatching?: () => boolean
}

export async function runCli(
  argv: string[],
  cwd = process.cwd(),
  overrides: CliOverrides = {},
): Promise<RunResult> {
  try {
    const parsed = parseArgs(argv)
    const command = parsed.args[0]
    const json = parsed.flags.has('json')

    if (!command || parsed.flags.has('help')) {
      return ok(formatHelp())
    }

    if (command === 'index') {
      const vaultPath = await resolveVaultPath(parsed.args[1], cwd)
      const index = await createVaultIndex(vaultPath)
      return output('index', vaultPath, index, json, formatIndex)
    }

    if (command === 'inspect') {
      const vaultPath = await resolveVaultPath(parsed.args[1], cwd)
      const filePath = normalizeCliFile(parsed.args[2])
      const context = await createVaultContext(vaultPath, filePath)
      return output('inspect', vaultPath, context, json, formatInspect)
    }

    if (command === 'context') {
      const vaultPath = await resolveVaultPath(parsed.args[1], cwd)
      const filePath = normalizeCliFile(parsed.values.get('file'))
      const context = await createVaultContext(vaultPath, filePath, {
        includeSource: parsed.flags.has('include-source'),
      })
      return output('context', vaultPath, context, json, formatContext)
    }

    if (command === 'link-check') {
      const vaultPath = await resolveVaultPath(parsed.args[1], cwd)
      const index = await createVaultIndex(vaultPath)
      const payload = {
        ok: index.links.every((link) => link.kind !== 'missing'),
        fileCount: index.files.length,
        linkCount: index.links.length,
        missingLinks: index.links.filter((link) => link.kind === 'missing'),
      }
      return output('link-check', vaultPath, payload, json, formatLinkCheck)
    }

    if (command === 'prompt') {
      const promptKind = parsed.args[1]
      const vaultPath = await resolveVaultPath(parsed.args[2], cwd)

      if (promptKind === 'create') {
        const payload = {
          prompt: `Create a new standalone HTML artifact inside this vault: ${vaultPath}. Use real .html files, relative links, and asset paths that remain local to the vault. Link it from index.html when useful.`,
        }
        return output('prompt create', vaultPath, payload, json, ({ prompt }) => `${prompt}\n`)
      }

      if (promptKind === 'revise') {
        const filePath = normalizeCliFile(parsed.values.get('file'))
        const payload = {
          file: filePath,
          prompt: `Revise ${filePath} inside this Atelier vault: ${vaultPath}. Preserve local relative links, keep it as a real standalone HTML file, and update any related pages if the navigation changes.`,
        }
        return output('prompt revise', vaultPath, payload, json, ({ prompt }) => `${prompt}\n`)
      }

      throw new Error('Prompt command must be "create" or "revise".')
    }

    if (command === 'create') {
      const vaultPath = await resolveVaultPath(parsed.args[1], cwd)
      const explicitPath = parsed.args[2]
      const title = parsed.values.get('title')
      const templateName = parsed.values.get('template')
      const formatArg = parsed.values.get('format')

      if (!explicitPath) {
        if (!title) {
          throw new Error('A relative path or --title is required.')
        }
        const format: 'html' | 'md' =
          formatArg === 'md' || formatArg === 'markdown'
            ? 'md'
            : formatArg === 'html' || formatArg === undefined
            ? 'html'
            : (() => {
                throw new Error(`Unknown format: ${formatArg}`)
              })()
        const result = await createDocumentFromTitle(vaultPath, title, format, templateName)
        const payload = {
          relativePath: result.relativePath,
          bytesWritten: Buffer.byteLength(result.content, 'utf8'),
          vault: summarizeIndex(result.index),
        }
        return output('create', vaultPath, payload, json, ({ relativePath: rp, bytesWritten }) =>
          `Created ${rp} (${bytesWritten} bytes)\n`,
        )
      }

      const relativePath = normalizeCliFile(explicitPath)
      let content = await readContentArgument(parsed, overrides)

      if (content === undefined) {
        const resolved = await resolveTemplateContent(vaultPath, relativePath, title, templateName)
        if (resolved !== null) {
          content = resolved
        }
      }

      const result = await createDocument(vaultPath, relativePath, {
        ...(content !== undefined ? { content } : {}),
        ...(title ? { title } : {}),
      })
      const payload = {
        relativePath: result.relativePath,
        bytesWritten: Buffer.byteLength(result.content, 'utf8'),
        vault: summarizeIndex(result.index),
      }
      return output('create', vaultPath, payload, json, ({ relativePath: rp, bytesWritten }) =>
        `Created ${rp} (${bytesWritten} bytes)\n`,
      )
    }

    if (command === 'import') {
      const vaultPath = await resolveVaultPath(parsed.args[1], cwd)
      const sources = parsed.args.slice(2)
      if (sources.length === 0) {
        throw new Error('At least one source file is required.')
      }
      const targetDirectory = parsed.values.get('target')
      const absoluteSources = sources.map((src) => path.resolve(cwd, src))
      const result = await importFiles(
        vaultPath,
        absoluteSources,
        targetDirectory ? normalizeRelativePath(targetDirectory) : undefined,
      )
      const payload = {
        importedPaths: result.importedPaths,
        vault: summarizeIndex(result.index),
      }
      return output('import', vaultPath, payload, json, ({ importedPaths }) =>
        importedPaths.length === 0
          ? 'No files imported.\n'
          : `# Imported ${importedPaths.length} file${importedPaths.length === 1 ? '' : 's'}\n${importedPaths.map((p) => `- ${p}`).join('\n')}\n`,
      )
    }

    if (command === 'templates') {
      const vaultPath = await resolveVaultPath(parsed.args[1], cwd)
      const templates = await listTemplates(vaultPath)
      const payload = {
        templates: templates.map((template) => ({
          name: template.name,
          format: template.format,
          relativePath: template.relativePath,
        })),
      }
      return output('templates', vaultPath, payload, json, ({ templates: list }) => {
        if (list.length === 0) {
          return 'No templates found. Add files to .htmlvault/templates/ in the vault.\n'
        }
        return `# Templates\n${list.map((t) => `- ${t.name} (${t.format})`).join('\n')}\n`
      })
    }

    if (command === 'update') {
      const vaultPath = await resolveVaultPath(parsed.args[1], cwd)
      const relativePath = normalizeCliFile(parsed.args[2])
      const content = await readContentArgument(parsed, overrides)
      if (content === undefined) {
        throw new Error('Provide content via --content "..." or --from-stdin.')
      }
      const result = await updateDocument(vaultPath, relativePath, content)
      const payload = {
        relativePath: result.relativePath,
        bytesWritten: Buffer.byteLength(content, 'utf8'),
        vault: summarizeIndex(result.index),
      }
      return output('update', vaultPath, payload, json, ({ relativePath: rp, bytesWritten }) =>
        `Updated ${rp} (${bytesWritten} bytes)\n`,
      )
    }

    if (command === 'move') {
      const vaultPath = await resolveVaultPath(parsed.args[1], cwd)
      const fromPath = normalizeCliFile(parsed.args[2])
      const toPath = normalizeCliFile(parsed.args[3])
      const result = await moveFile(vaultPath, fromPath, toPath)
      const payload = {
        fromPath: result.fromPath,
        toPath: result.toPath,
        vault: summarizeIndex(result.index),
      }
      return output('move', vaultPath, payload, json, ({ fromPath: f, toPath: t }) =>
        `Moved ${f} -> ${t}\n`,
      )
    }

    if (command === 'rename') {
      const vaultPath = await resolveVaultPath(parsed.args[1], cwd)
      const fromPath = normalizeCliFile(parsed.args[2])
      const newName = parsed.args[3] ?? parsed.values.get('name')
      if (!newName) {
        throw new Error('A new name is required.')
      }
      const result = await renameFile(vaultPath, fromPath, newName)
      const payload = {
        fromPath: result.fromPath,
        toPath: result.toPath,
        vault: summarizeIndex(result.index),
      }
      return output('rename', vaultPath, payload, json, ({ fromPath: f, toPath: t }) =>
        `Renamed ${f} -> ${t}\n`,
      )
    }

    if (command === 'duplicate') {
      const vaultPath = await resolveVaultPath(parsed.args[1], cwd)
      const filePath = normalizeCliFile(parsed.args[2])
      const result = await duplicateFile(vaultPath, filePath)
      const payload = {
        sourcePath: result.sourcePath,
        duplicatePath: result.duplicatePath,
        vault: summarizeIndex(result.index),
      }
      return output('duplicate', vaultPath, payload, json, ({ sourcePath: s, duplicatePath: d }) =>
        `Duplicated ${s} -> ${d}\n`,
      )
    }

    if (command === 'delete') {
      const vaultPath = await resolveVaultPath(parsed.args[1], cwd)
      const filePath = normalizeCliFile(parsed.args[2])
      const result = await deleteFile(vaultPath, filePath)
      const payload = {
        removedPath: result.removedPath,
        permanentlyDeleted: result.permanentlyDeleted ?? false,
        vault: summarizeIndex(result.index),
      }
      return output('delete', vaultPath, payload, json, ({ removedPath, permanentlyDeleted }) =>
        permanentlyDeleted
          ? `Permanently deleted (system trash unavailable) ${removedPath}\n`
          : `Deleted ${removedPath}\n`,
      )
    }

    if (command === 'mkdir') {
      const vaultPath = await resolveVaultPath(parsed.args[1], cwd)
      const folderPath = normalizeCliFile(parsed.args[2])
      const result = await createFolder(vaultPath, folderPath)
      const payload = {
        folderPath: result.folderPath,
        vault: summarizeIndex(result.index),
      }
      return output('mkdir', vaultPath, payload, json, ({ folderPath: fp }) =>
        `Created folder ${fp}\n`,
      )
    }

    if (command === 'search') {
      const vaultPath = await resolveVaultPath(parsed.args[1], cwd)
      const query = parsed.args[2]
      if (!query) {
        throw new Error('A search query is required.')
      }
      const fields = parseFields(parsed.values.get('in'))
      const limit = parseNumber(parsed.values.get('limit'), 25)
      const result = await searchVault(vaultPath, query, {
        ...(fields ? { fields } : {}),
        ...(limit !== undefined ? { limit } : {}),
        caseSensitive: parsed.flags.has('case-sensitive'),
      })
      return output('search', vaultPath, result, json, formatSearch)
    }

    if (command === 'lint') {
      const vaultPath = await resolveVaultPath(parsed.args[1], cwd)
      const result = await lintVault(vaultPath)
      return output('lint', vaultPath, result, json, formatLint)
    }

    if (command === 'watch') {
      const vaultPath = await resolveVaultPath(parsed.args[1], cwd)
      return runWatch(vaultPath, overrides)
    }

    if (command === 'init') {
      const target = parsed.args[1]
      if (!target) {
        throw new Error('A vault path is required.')
      }
      const absoluteTarget = path.resolve(cwd, target)
      const parentDir = path.dirname(absoluteTarget)
      const folderName = path.basename(absoluteTarget)
      const displayName = parsed.values.get('name')?.trim()
      const noWelcome = parsed.flags.has('no-welcome')

      const { vaultRoot } = await createVault(parentDir, folderName, {
        seedWelcome: !noWelcome,
        ...(displayName ? { displayName } : {}),
      })

      return output(
        'init',
        vaultRoot,
        {
          vaultRoot,
          vaultName: displayName ?? folderName,
          seededWelcome: !noWelcome,
        },
        json,
        formatInit,
      )
    }

    throw new Error(`Unknown command: ${command}`)
  } catch (error) {
    return {
      exitCode: 1,
      stdout: '',
      stderr: `${error instanceof Error ? error.message : String(error)}\n`,
    }
  }
}

function parseArgs(argv: string[]): ParsedArgs {
  const args: string[] = []
  const flags = new Set<string>()
  const values = new Map<string, string>()

  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index]

    if (!item.startsWith('--')) {
      args.push(item)
      continue
    }

    const equalsIndex = item.indexOf('=')
    if (equalsIndex !== -1) {
      const key = item.slice(2, equalsIndex)
      const value = item.slice(equalsIndex + 1)
      values.set(key, value)
      continue
    }

    const flag = item.slice(2)
    const next = argv[index + 1]

    if (next !== undefined && !next.startsWith('--') && VALUE_FLAGS.has(flag)) {
      values.set(flag, next)
      index += 1
      continue
    }

    flags.add(flag)
  }

  return { args, flags, values }
}

async function resolveVaultPath(vaultArg: string | undefined, cwd: string): Promise<string> {
  if (!vaultArg) {
    throw new Error('A vault path is required.')
  }

  const vaultPath = path.resolve(cwd, vaultArg)
  const stats = await fs.stat(vaultPath).catch(() => undefined)

  if (!stats?.isDirectory()) {
    throw new Error(`Vault path is not a directory: ${vaultPath}`)
  }

  return vaultPath
}

function normalizeCliFile(filePath: string | undefined): string {
  if (!filePath) {
    throw new Error('A file path is required.')
  }

  return normalizeRelativePath(filePath)
}

async function resolveTemplateContent(
  vaultPath: string,
  relativePath: string,
  title: string | undefined,
  templateName: string | undefined,
): Promise<string | null> {
  const extension = path.extname(relativePath).toLowerCase()
  const format: 'html' | 'md' | null =
    extension === '.html' || extension === '.htm'
      ? 'html'
      : extension === '.md' || extension === '.markdown'
      ? 'md'
      : null

  if (!format) {
    return null
  }

  const requested = templateName ?? (await readVaultConfig(vaultPath)).defaultTemplate
  if (!requested) {
    return null
  }

  const body = await readTemplateBody(vaultPath, requested, format)
  if (body === null) {
    throw new Error(`Template not found: ${requested}`)
  }

  return fillTemplate(body, title ?? path.basename(relativePath, extension))
}

async function readContentArgument(
  parsed: ParsedArgs,
  overrides: CliOverrides,
): Promise<string | undefined> {
  if (parsed.values.has('content')) {
    return parsed.values.get('content')
  }
  if (parsed.flags.has('from-stdin')) {
    const reader = overrides.stdinReader ?? readStdin
    return reader()
  }
  return undefined
}

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) {
    return ''
  }

  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}

function parseFields(value: string | undefined): SearchField[] | undefined {
  if (!value) {
    return undefined
  }

  const valid = new Set<SearchField>(['body', 'title', 'tags', 'headings'])
  if (value === 'all') {
    return ['body', 'title', 'tags', 'headings']
  }

  const fields = value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry): entry is SearchField => valid.has(entry as SearchField))

  if (fields.length === 0) {
    throw new Error(`--in must be one or more of: body, title, tags, headings, all`)
  }

  return fields
}

function parseNumber(value: string | undefined, fallback: number): number {
  if (value === undefined) {
    return fallback
  }
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Expected a positive number, got: ${value}`)
  }
  return Math.floor(parsed)
}

function summarizeIndex(index: VaultIndex): {
  vaultName: string
  rootPath: string
  fileCount: number
  linkCount: number
  generatedAt: number
} {
  return {
    vaultName: index.vaultName,
    rootPath: index.rootPath,
    fileCount: index.files.length,
    linkCount: index.links.length,
    generatedAt: index.generatedAt,
  }
}

async function runWatch(vaultPath: string, overrides: CliOverrides): Promise<RunResult> {
  const factory = overrides.watcherFactory ?? chokidar.watch
  const shouldKeep = overrides.shouldKeepWatching ?? (() => true)
  const config = await readVaultConfig(vaultPath)
  const userIgnored = config.ignoredPaths ?? []

  const watcher = factory(vaultPath, {
    ignored: (absolutePath: string) => {
      const relative = path.relative(vaultPath, absolutePath).replace(/\\/g, '/')
      if (!relative || relative === '.') {
        return false
      }
      const basename = path.basename(absolutePath)
      return shouldIgnoreEntry(relative, basename, userIgnored)
    },
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 25 },
  })

  process.stdout.write(
    `${JSON.stringify({ schemaVersion: SCHEMA_VERSION, type: 'watch:start', vaultPath, generatedAt: Date.now() })}\n`,
  )

  const emit = (type: 'added' | 'changed' | 'removed', filePath: string) => {
    const event = {
      schemaVersion: SCHEMA_VERSION,
      type,
      relativePath: path.relative(vaultPath, filePath).replaceAll(path.sep, '/'),
      generatedAt: Date.now(),
    }
    process.stdout.write(`${JSON.stringify(event)}\n`)
  }

  watcher.on('add', (p) => emit('added', p))
  watcher.on('change', (p) => emit('changed', p))
  watcher.on('unlink', (p) => emit('removed', p))

  await new Promise<void>((resolve) => {
    const interval = setInterval(() => {
      if (!shouldKeep()) {
        clearInterval(interval)
        resolve()
      }
    }, 250)

    process.on('SIGINT', () => {
      clearInterval(interval)
      resolve()
    })
  })

  await watcher.close()
  return ok('')
}

function output<TPayload>(
  command: string,
  vaultPath: string,
  payload: TPayload,
  json: boolean,
  formatMarkdown: (payload: TPayload) => string,
): RunResult {
  const result: CliResult<TPayload> = {
    schemaVersion: SCHEMA_VERSION,
    command,
    vaultPath,
    generatedAt: Date.now(),
    payload,
  }

  return ok(json ? `${JSON.stringify(result, null, 2)}\n` : formatMarkdown(payload))
}

function ok(stdout: string): RunResult {
  return {
    exitCode: 0,
    stdout,
    stderr: '',
  }
}

function formatHelp(): string {
  return `# Atelier CLI (schema v${SCHEMA_VERSION})

## Read
  atelier index <vault> [--json]
  atelier inspect <vault> <file> [--json]
  atelier context <vault> --file <file> [--include-source] [--json]
  atelier search <vault> <query> [--in body,title,tags,headings|all] [--limit N] [--case-sensitive] [--json]
  atelier link-check <vault> [--json]
  atelier lint <vault> [--json]

## Write
  atelier init <path> [--name "Display Name"] [--no-welcome] [--json]
  atelier create <vault> <path> [--title T] [--template name] [--content C | --from-stdin] [--json]
  atelier create <vault> --title T [--format html|md] [--template name] [--json]
  atelier import <vault> <file...> [--target <dir>] [--json]
  atelier update <vault> <file> [--content C | --from-stdin] [--json]
  atelier templates <vault> [--json]
  atelier move <vault> <from> <to> [--json]
  atelier rename <vault> <file> <new-name> [--json]
  atelier duplicate <vault> <file> [--json]
  atelier delete <vault> <file> [--json]
  atelier mkdir <vault> <folder> [--json]

## Stream
  atelier watch <vault>           # NDJSON events on stdout

## Prompt scaffolds
  atelier prompt create <vault>
  atelier prompt revise <vault> --file <file>

All --json output includes schemaVersion: ${SCHEMA_VERSION}.
`
}

function formatInit(payload: { vaultRoot: string; vaultName: string; seededWelcome: boolean }): string {
  const lines = [
    `# Atelier Initialized`,
    ``,
    `Path: ${payload.vaultRoot}`,
    `Name: ${payload.vaultName}`,
    `Welcome file: ${payload.seededWelcome ? 'index.html' : 'none'}`,
  ]
  return `${lines.join('\n')}\n`
}

function formatIndex(index: VaultIndex): string {
  const missingCount = index.links.filter((link) => link.kind === 'missing').length

  return `# Atelier Index

Vault: ${index.rootPath}
Files: ${index.files.length}
Links: ${index.links.length}
Missing links: ${missingCount}

## Files
${index.files.map((file) => `- ${file.relativePath} - ${file.title}`).join('\n')}
`
}

function formatInspect(context: VaultContext): string {
  return `# ${context.file.title}

Path: ${context.file.relativePath}
Size: ${context.file.size} bytes
Headings: ${context.file.headings.length}

## Outgoing Links
${formatLinks(context.outgoingLinks)}

## Backlinks
${formatLinks(context.backlinks)}

## Missing Links
${formatLinks(context.missingLinks)}
`
}

function formatContext(context: VaultContext): string {
  return `# Atelier Context

Vault: ${context.vaultPath}
Selected file: ${context.file.relativePath}
Title: ${context.file.title}

## Summary
- Outgoing links: ${context.outgoingLinks.length}
- Backlinks: ${context.backlinks.length}
- Missing links: ${context.missingLinks.length}
- Related files: ${context.relatedFiles.length}

## Related Files
${context.relatedFiles.map((file) => `- ${file.relativePath} - ${file.title}`).join('\n') || 'None'}

## Outgoing Links
${formatLinks(context.outgoingLinks)}

## Backlinks
${formatLinks(context.backlinks)}

## Missing Links
${formatLinks(context.missingLinks)}
${context.source ? `\n## Source\n\n\`\`\`html\n${context.source}\n\`\`\`\n` : ''}
`
}

function formatLinkCheck(payload: { ok: boolean; fileCount: number; linkCount: number; missingLinks: VaultLink[] }): string {
  return `# Atelier Link Check

Status: ${payload.ok ? 'OK' : 'Missing links found'}
Files: ${payload.fileCount}
Links: ${payload.linkCount}
Missing links: ${payload.missingLinks.length}

${payload.missingLinks.length ? formatLinks(payload.missingLinks) : 'No missing links.'}
`
}

function formatSearch(result: SearchResult): string {
  if (!result.matches.length) {
    return `# Atelier Search\n\nQuery: ${result.query}\nNo matches across ${result.fileCount} files.\n`
  }

  const lines = result.matches
    .map((match) => `- ${match.relativePath} (${match.field}): ${match.snippet}`)
    .join('\n')

  return `# Atelier Search

Query: ${result.query}
Fields: ${result.searchedFields.join(', ')}
Matches: ${result.matches.length} (of ${result.fileCount} files)

${lines}
`
}

function formatLint(result: LintResult): string {
  if (result.ok) {
    return `# Atelier Lint\n\nStatus: OK\nFiles: ${result.fileCount}\nLinks: ${result.linkCount}\n`
  }

  const grouped = result.issues.reduce<Record<string, LintIssue[]>>((acc, issue) => {
    acc[issue.kind] = acc[issue.kind] ?? []
    acc[issue.kind].push(issue)
    return acc
  }, {})

  const sections = Object.entries(grouped)
    .map(([kind, issues]) => {
      const lines = issues.map((issue) => `- ${issue.file}: ${issue.message}`).join('\n')
      return `## ${kind} (${issues.length})\n${lines}`
    })
    .join('\n\n')

  return `# Atelier Lint

Status: ${result.issues.length} issues
Files: ${result.fileCount}
Links: ${result.linkCount}

${sections}
`
}

function formatLinks(links: VaultLink[]): string {
  if (!links.length) {
    return 'None'
  }

  return links
    .map((link) => {
      const target = link.resolvedTarget ? ` -> ${link.resolvedTarget}` : ''
      return `- ${link.from}: ${link.rawHref}${target} (${link.kind})`
    })
    .join('\n')
}

function isEntryPoint(): boolean {
  if (!process.argv[1]) {
    return false
  }
  const moduleFile = fileURLToPath(import.meta.url)
  const argvFile = path.resolve(process.argv[1])
  if (argvFile === moduleFile) {
    return true
  }

  try {
    return realpathSync(argvFile) === realpathSync(moduleFile)
  } catch {
    return false
  }
}

if (isEntryPoint()) {
  runCli(process.argv.slice(2)).then((result) => {
    if (result.stdout) {
      process.stdout.write(result.stdout)
    }
    if (result.stderr) {
      process.stderr.write(result.stderr)
    }
    process.exitCode = result.exitCode
  })
}
