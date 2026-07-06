import { promises as fs } from 'node:fs'
import path from 'node:path'
import * as cheerio from 'cheerio'
import type { VaultFile, VaultIndex } from '../src/shared/types.js'
import { normalizeRelativePath, safeResolveVaultPath } from './path-guards.js'
import {
  CONFIG_DIRECTORY,
  fillTemplate,
  readTemplateBody,
  readVaultConfig,
  writeVaultConfig,
} from './vault-config.js'
import { createVaultIndex, isHtmlPath, isMarkdownPath } from './vault-indexer.js'

const DEFAULT_HTML_TITLE = 'Untitled Artifact'
const DEFAULT_MD_TITLE = 'Untitled Note'

export type DocumentFormat = 'html' | 'md'

export interface CreateDocumentResult {
  relativePath: string
  content: string
  index: VaultIndex
}

export interface UpdateDocumentResult {
  relativePath: string
  index: VaultIndex
}

export interface MoveFileResult {
  fromPath: string
  toPath: string
  index: VaultIndex
}

export interface DuplicateFileResult {
  sourcePath: string
  duplicatePath: string
  index: VaultIndex
}

export interface DeleteFileResult {
  removedPath: string
  index: VaultIndex
  permanentlyDeleted?: boolean
}

export interface CreateFolderResult {
  folderPath: string
  index: VaultIndex
}

export interface ImportFilesResult {
  importedPaths: string[]
  index: VaultIndex
}

export interface CreateVaultResult {
  vaultRoot: string
}

export type SearchField = 'body' | 'title' | 'tags' | 'headings'

export interface SearchOptions {
  fields?: SearchField[]
  limit?: number
  caseSensitive?: boolean
}

export interface SearchMatch {
  relativePath: string
  title: string
  field: SearchField
  snippet: string
  matchIndex: number
}

export interface SearchResult {
  query: string
  matches: SearchMatch[]
  fileCount: number
  searchedFields: SearchField[]
}

export type LintKind =
  | 'missing-link'
  | 'missing-title'
  | 'missing-description'
  | 'orphan'
  | 'parse-error'

export interface LintIssue {
  file: string
  kind: LintKind
  message: string
  details?: Record<string, unknown>
}

export interface LintResult {
  ok: boolean
  fileCount: number
  linkCount: number
  issues: LintIssue[]
}

export interface VaultOpsHooks {
  trashItem?: (absolutePath: string) => Promise<void>
  beforeRefresh?: (relativePath?: string) => void
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

export function toSlug(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 64) || 'untitled-artifact'
  )
}

export function buildHtmlTemplate(title: string): string {
  const slug = toSlug(title)
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="description" content="${escapeHtml(title)} artifact page">
    <title>${escapeHtml(title)}</title>
    <style>
      body {
        margin: 0;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        color: #1f2428;
        background: #f6f2eb;
      }

      main {
        max-width: 960px;
        margin: 0 auto;
        padding: 56px 24px;
      }

      a {
        color: #006d75;
      }
    </style>
  </head>
  <body>
    <main>
      <p><a href="./index.html">Back to index</a></p>
      <h1>${escapeHtml(title)}</h1>
      <p>New HTML artifact: ${slug}</p>
    </main>
  </body>
</html>
`
}

export function buildMarkdownTemplate(title: string): string {
  return `---
title: ${title}
tags: []
---

# ${title}

`
}

export function buildWelcomeTemplate(vaultName: string): string {
  const safeName = escapeHtml(vaultName)
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="description" content="Welcome to your new Atelier vault">
    <title>Welcome — ${safeName}</title>
    <style>
      body {
        margin: 0;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        color: #1f2428;
        background: #f6f2eb;
      }

      main {
        max-width: 720px;
        margin: 0 auto;
        padding: 64px 24px;
        line-height: 1.6;
      }

      h1 {
        font-family: Newsreader, Georgia, serif;
        font-weight: 500;
        margin-bottom: 8px;
      }

      h2 {
        font-family: Newsreader, Georgia, serif;
        font-weight: 500;
        margin-top: 40px;
      }

      code {
        background: rgba(0, 0, 0, 0.05);
        padding: 2px 6px;
        border-radius: 4px;
        font-size: 0.9em;
      }

      a {
        color: #006d75;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>Welcome to ${safeName}</h1>
      <p>This is a fresh Atelier vault. Treat it as a folder of artifacts — HTML and Markdown files that link to one another like a small private website.</p>

      <h2>What you can do here</h2>
      <ul>
        <li>Drag HTML or Markdown files into the sidebar to import them</li>
        <li>Use <code>Cmd/Ctrl + K</code> to open the command palette</li>
        <li>Click any link in the preview to navigate the vault</li>
        <li>Edit metadata (description, tags) from the properties bar</li>
      </ul>

      <h2>Vault config &amp; templates</h2>
      <p>Each vault keeps a hidden config folder for vault-level settings. <code>config.json</code> sets the vault name, default template, and ignored paths. Drop template files (HTML or Markdown) into the templates subfolder and they'll appear when you create new files.</p>

      <p>Replace this file when you're ready — it's just a starting point.</p>
    </main>
  </body>
</html>
`
}

async function exists(absolutePath: string): Promise<boolean> {
  try {
    await fs.access(absolutePath)
    return true
  } catch {
    return false
  }
}

async function ensureRoot(vaultRoot: string): Promise<string> {
  const stats = await fs.stat(vaultRoot).catch(() => undefined)
  if (!stats?.isDirectory()) {
    throw new Error(`Vault path is not a directory: ${vaultRoot}`)
  }
  return vaultRoot
}

const INVALID_VAULT_NAME = /[<>:"/\\|?*\x00-\x1f]/

export async function createVault(
  parentDir: string,
  folderName: string,
  options: { seedWelcome?: boolean; displayName?: string } = {},
): Promise<CreateVaultResult> {
  const trimmedFolder = folderName.trim()
  if (!trimmedFolder) {
    throw new Error('Vault folder name is required.')
  }
  if (trimmedFolder === '.' || trimmedFolder === '..' || trimmedFolder.startsWith('.')) {
    throw new Error('Vault folder name cannot start with a dot.')
  }
  if (INVALID_VAULT_NAME.test(trimmedFolder)) {
    throw new Error('Vault folder name contains invalid characters.')
  }

  const parentStats = await fs.stat(parentDir).catch(() => undefined)
  if (!parentStats?.isDirectory()) {
    throw new Error(`Parent directory does not exist: ${parentDir}`)
  }

  const vaultRoot = path.join(parentDir, trimmedFolder)
  if (await exists(vaultRoot)) {
    throw new Error(`A folder with that name already exists: ${vaultRoot}`)
  }

  const displayName = options.displayName?.trim() || trimmedFolder

  await fs.mkdir(vaultRoot, { recursive: false })
  await fs.mkdir(path.join(vaultRoot, CONFIG_DIRECTORY), { recursive: true })
  await writeVaultConfig(vaultRoot, { vaultName: displayName })

  if (options.seedWelcome !== false) {
    await fs.writeFile(path.join(vaultRoot, 'index.html'), buildWelcomeTemplate(displayName), 'utf8')
  }

  return { vaultRoot }
}

export async function createDocument(
  vaultRoot: string,
  relativePath: string,
  options: { content?: string; title?: string } = {},
): Promise<CreateDocumentResult> {
  await ensureRoot(vaultRoot)
  const normalized = normalizeRelativePath(relativePath)
  if (!normalized) {
    throw new Error('A relative path is required.')
  }

  const absolute = safeResolveVaultPath(vaultRoot, normalized)
  if (await exists(absolute)) {
    throw new Error(`File already exists: ${normalized}`)
  }

  let content = options.content
  if (content === undefined) {
    if (isMarkdownPath(normalized)) {
      content = buildMarkdownTemplate(options.title ?? DEFAULT_MD_TITLE)
    } else if (isHtmlPath(normalized)) {
      content = buildHtmlTemplate(options.title ?? DEFAULT_HTML_TITLE)
    } else {
      content = ''
    }
  }

  await fs.mkdir(path.dirname(absolute), { recursive: true })
  await fs.writeFile(absolute, content, 'utf8')
  const index = await createVaultIndex(vaultRoot)
  return { relativePath: normalized, content, index }
}

export async function createDocumentFromTitle(
  vaultRoot: string,
  title: string,
  format: DocumentFormat,
  templateName?: string,
): Promise<CreateDocumentResult> {
  await ensureRoot(vaultRoot)
  const slug = toSlug(title)
  const extension = format === 'md' ? '.md' : '.html'
  let candidate = `${slug}${extension}`
  let absolute = safeResolveVaultPath(vaultRoot, candidate)
  let counter = 2

  while (await exists(absolute)) {
    candidate = `${slug}-${counter}${extension}`
    absolute = safeResolveVaultPath(vaultRoot, candidate)
    counter += 1
  }

  const content = await renderInitialContent(vaultRoot, title, format, templateName)
  await fs.writeFile(absolute, content, 'utf8')
  const index = await createVaultIndex(vaultRoot)
  return { relativePath: candidate, content, index }
}

async function renderInitialContent(
  vaultRoot: string,
  title: string,
  format: DocumentFormat,
  templateName?: string,
): Promise<string> {
  const requestedTemplate = templateName ?? (await readVaultConfig(vaultRoot)).defaultTemplate

  if (requestedTemplate) {
    const body = await readTemplateBody(vaultRoot, requestedTemplate, format)
    if (body !== null) {
      return fillTemplate(body, title)
    }
  }

  return format === 'md' ? buildMarkdownTemplate(title) : buildHtmlTemplate(title)
}

export async function updateDocument(
  vaultRoot: string,
  relativePath: string,
  content: string,
  hooks: VaultOpsHooks = {},
): Promise<UpdateDocumentResult> {
  await ensureRoot(vaultRoot)
  const normalized = normalizeRelativePath(relativePath)
  const absolute = safeResolveVaultPath(vaultRoot, normalized)

  const stats = await fs.stat(absolute).catch(() => undefined)
  if (!stats?.isFile()) {
    throw new Error(`File does not exist: ${normalized}`)
  }

  hooks.beforeRefresh?.(normalized)
  await fs.writeFile(absolute, content, 'utf8')
  const index = await createVaultIndex(vaultRoot)
  return { relativePath: normalized, index }
}

export async function moveFile(
  vaultRoot: string,
  fromPath: string,
  toPath: string,
  hooks: VaultOpsHooks = {},
): Promise<MoveFileResult> {
  await ensureRoot(vaultRoot)
  const normalizedFrom = normalizeRelativePath(fromPath)
  const normalizedTo = normalizeRelativePath(toPath)

  if (normalizedFrom === normalizedTo) {
    return { fromPath: normalizedFrom, toPath: normalizedTo, index: await createVaultIndex(vaultRoot) }
  }

  const absoluteFrom = safeResolveVaultPath(vaultRoot, normalizedFrom)
  const absoluteTo = safeResolveVaultPath(vaultRoot, normalizedTo)

  const fromStats = await fs.stat(absoluteFrom).catch(() => undefined)
  if (!fromStats?.isFile()) {
    throw new Error(`Source is not a file: ${normalizedFrom}`)
  }

  if (await exists(absoluteTo)) {
    throw new Error(`Target already exists: ${normalizedTo}`)
  }

  await fs.mkdir(path.dirname(absoluteTo), { recursive: true })
  hooks.beforeRefresh?.(normalizedFrom)
  await fs.rename(absoluteFrom, absoluteTo)
  const index = await createVaultIndex(vaultRoot)
  return { fromPath: normalizedFrom, toPath: normalizedTo, index }
}

export async function renameFile(
  vaultRoot: string,
  fromPath: string,
  newName: string,
  hooks: VaultOpsHooks = {},
): Promise<MoveFileResult> {
  const cleanedName = newName.trim()
  if (!cleanedName || cleanedName.includes('/') || cleanedName.includes('\\')) {
    throw new Error('Name cannot include path separators.')
  }

  const normalizedFrom = normalizeRelativePath(fromPath)
  const directory = path.posix.dirname(normalizedFrom)
  const targetRelative = directory === '.' ? cleanedName : `${directory}/${cleanedName}`
  return moveFile(vaultRoot, normalizedFrom, targetRelative, hooks)
}

export async function duplicateFile(
  vaultRoot: string,
  relativePath: string,
): Promise<DuplicateFileResult> {
  await ensureRoot(vaultRoot)
  const normalizedSource = normalizeRelativePath(relativePath)
  const absoluteSource = safeResolveVaultPath(vaultRoot, normalizedSource)

  const stats = await fs.stat(absoluteSource).catch(() => undefined)
  if (!stats?.isFile()) {
    throw new Error(`Source is not a file: ${normalizedSource}`)
  }

  const directory = path.posix.dirname(normalizedSource)
  const baseName = path.posix.basename(normalizedSource)
  const extension = path.posix.extname(baseName)
  const stem = baseName.slice(0, baseName.length - extension.length)
  let candidateName = `${stem}-copy${extension}`
  let counter = 2

  while (
    await exists(safeResolveVaultPath(vaultRoot, directory === '.' ? candidateName : `${directory}/${candidateName}`))
  ) {
    candidateName = `${stem}-copy-${counter}${extension}`
    counter += 1
  }

  const duplicateRelative = directory === '.' ? candidateName : `${directory}/${candidateName}`
  const absoluteDuplicate = safeResolveVaultPath(vaultRoot, duplicateRelative)
  await fs.copyFile(absoluteSource, absoluteDuplicate)
  const index = await createVaultIndex(vaultRoot)
  return { sourcePath: normalizedSource, duplicatePath: duplicateRelative, index }
}

export async function deleteFile(
  vaultRoot: string,
  relativePath: string,
  hooks: VaultOpsHooks = {},
): Promise<DeleteFileResult> {
  await ensureRoot(vaultRoot)
  const normalized = normalizeRelativePath(relativePath)
  const absolute = safeResolveVaultPath(vaultRoot, normalized)

  const stats = await fs.stat(absolute).catch(() => undefined)
  if (!stats) {
    throw new Error(`File not found: ${normalized}`)
  }

  hooks.beforeRefresh?.(normalized)

  const permanentDelete = async (): Promise<void> => {
    if (stats.isDirectory()) {
      await fs.rm(absolute, { recursive: true, force: true })
    } else {
      await fs.unlink(absolute)
    }
  }

  // Tracks whether the item bypassed the system trash and was removed
  // irreversibly. This is surfaced to callers so they can report honestly
  // rather than claiming the item was recoverable from the trash.
  let permanentlyDeleted = false

  if (hooks.trashItem) {
    try {
      await hooks.trashItem(absolute)
    } catch {
      // System trash was unavailable (e.g. no desktop shell / platform
      // limitation). Documented fall-through: still delete permanently, but
      // record that this was not a recoverable trash operation.
      await permanentDelete()
      permanentlyDeleted = true
    }
  } else {
    await permanentDelete()
    permanentlyDeleted = true
  }

  const index = await createVaultIndex(vaultRoot)
  return { removedPath: normalized, index, permanentlyDeleted }
}

export async function createFolder(
  vaultRoot: string,
  folderPath: string,
): Promise<CreateFolderResult> {
  await ensureRoot(vaultRoot)
  const normalized = normalizeRelativePath(folderPath)
  if (!normalized) {
    throw new Error('Folder path is required.')
  }

  const absolute = safeResolveVaultPath(vaultRoot, normalized)
  if (await exists(absolute)) {
    throw new Error(`Folder already exists: ${normalized}`)
  }

  await fs.mkdir(absolute, { recursive: true })
  const index = await createVaultIndex(vaultRoot)
  return { folderPath: normalized, index }
}

export async function importFiles(
  vaultRoot: string,
  sourcePaths: string[],
  targetDirectory?: string,
): Promise<ImportFilesResult> {
  await ensureRoot(vaultRoot)
  if (!Array.isArray(sourcePaths) || sourcePaths.length === 0) {
    return { importedPaths: [], index: await createVaultIndex(vaultRoot) }
  }

  const targetDirRelative = targetDirectory ? normalizeRelativePath(targetDirectory) : ''
  const targetDirAbsolute = targetDirRelative
    ? safeResolveVaultPath(vaultRoot, targetDirRelative)
    : path.resolve(vaultRoot)
  await fs.mkdir(targetDirAbsolute, { recursive: true })

  const importedPaths: string[] = []

  for (const sourcePath of sourcePaths) {
    if (typeof sourcePath !== 'string' || !sourcePath) {
      continue
    }

    const sourceStats = await fs.stat(sourcePath).catch(() => undefined)
    if (!sourceStats?.isFile()) {
      continue
    }

    const baseName = path.basename(sourcePath)
    const extension = path.extname(baseName)
    const stem = baseName.slice(0, baseName.length - extension.length) || 'file'
    let candidate = baseName
    let counter = 2

    while (
      (await exists(path.join(targetDirAbsolute, candidate))) ||
      importedPaths.some((existing) => path.basename(existing) === candidate && path.dirname(existing) === targetDirRelative)
    ) {
      candidate = `${stem}-${counter}${extension}`
      counter += 1
    }

    const destinationRelative = targetDirRelative ? `${targetDirRelative}/${candidate}` : candidate
    const destinationAbsolute = safeResolveVaultPath(vaultRoot, destinationRelative)
    await fs.copyFile(sourcePath, destinationAbsolute)
    importedPaths.push(destinationRelative)
  }

  const index = await createVaultIndex(vaultRoot)
  return { importedPaths, index }
}

export async function searchVault(
  vaultRoot: string,
  query: string,
  options: SearchOptions = {},
): Promise<SearchResult> {
  await ensureRoot(vaultRoot)
  const trimmed = query.trim()
  if (!trimmed) {
    throw new Error('Search query is required.')
  }

  const fields = options.fields ?? (['body', 'title', 'tags', 'headings'] as SearchField[])
  const limit = options.limit ?? 25
  const caseSensitive = options.caseSensitive ?? false
  const needle = caseSensitive ? trimmed : trimmed.toLowerCase()

  const index = await createVaultIndex(vaultRoot)
  const matches: SearchMatch[] = []

  for (const file of index.files) {
    const candidates: { field: SearchField; value: string }[] = []

    if (fields.includes('title')) {
      candidates.push({ field: 'title', value: file.title })
    }
    if (fields.includes('tags') && file.metadata.tags?.length) {
      candidates.push({ field: 'tags', value: file.metadata.tags.join(' ') })
    }
    if (fields.includes('headings') && file.headings.length) {
      candidates.push({ field: 'headings', value: file.headings.join('\n') })
    }
    if (fields.includes('body')) {
      const absolute = safeResolveVaultPath(vaultRoot, file.relativePath)
      try {
        const raw = await fs.readFile(absolute, 'utf8')
        const text = isHtmlPath(file.relativePath) ? extractTextFromHtml(raw) : raw
        candidates.push({ field: 'body', value: text })
      } catch {
        // Ignore unreadable files
      }
    }

    let bestMatch: SearchMatch | undefined

    for (const candidate of candidates) {
      const haystack = caseSensitive ? candidate.value : candidate.value.toLowerCase()
      const matchIndex = haystack.indexOf(needle)
      if (matchIndex < 0) {
        continue
      }

      const snippet = makeSnippet(candidate.value, matchIndex, trimmed.length)
      const fieldRank = fieldPriority(candidate.field)
      if (!bestMatch || fieldRank < fieldPriority(bestMatch.field)) {
        bestMatch = {
          relativePath: file.relativePath,
          title: file.title,
          field: candidate.field,
          snippet,
          matchIndex,
        }
      }
    }

    if (bestMatch) {
      matches.push(bestMatch)
    }

    if (matches.length >= limit) {
      break
    }
  }

  return {
    query: trimmed,
    matches,
    fileCount: index.files.length,
    searchedFields: fields,
  }
}

function fieldPriority(field: SearchField): number {
  switch (field) {
    case 'title':
      return 0
    case 'tags':
      return 1
    case 'headings':
      return 2
    case 'body':
      return 3
  }
}

function makeSnippet(value: string, matchIndex: number, matchLength: number): string {
  const radius = 32
  const start = Math.max(0, matchIndex - radius)
  const end = Math.min(value.length, matchIndex + matchLength + radius)
  const prefix = start > 0 ? '…' : ''
  const suffix = end < value.length ? '…' : ''
  return `${prefix}${value.slice(start, end).replace(/\s+/g, ' ').trim()}${suffix}`
}

function extractTextFromHtml(html: string): string {
  const $ = cheerio.load(html)
  $('script, style, noscript').remove()
  return $('body').text().replace(/\s+/g, ' ').trim() || $.text().replace(/\s+/g, ' ').trim()
}

export async function lintVault(vaultRoot: string): Promise<LintResult> {
  await ensureRoot(vaultRoot)
  const index = await createVaultIndex(vaultRoot)
  const issues: LintIssue[] = []

  for (const link of index.links) {
    if (link.kind === 'missing') {
      issues.push({
        file: link.from,
        kind: 'missing-link',
        message: `Missing link target: ${link.rawHref}`,
        details: { rawHref: link.rawHref, resolvedTarget: link.resolvedTarget },
      })
    }
  }

  for (const file of index.files) {
    if (!file.title || file.title === path.basename(file.relativePath)) {
      issues.push({
        file: file.relativePath,
        kind: 'missing-title',
        message: 'No <title>, <h1>, or frontmatter title present.',
      })
    }

    if (!file.metadata.description) {
      issues.push({
        file: file.relativePath,
        kind: 'missing-description',
        message: 'No description metadata.',
      })
    }

    if (isOrphan(file, index)) {
      issues.push({
        file: file.relativePath,
        kind: 'orphan',
        message: 'No incoming links from any other file in the vault.',
      })
    }
  }

  for (const file of index.files) {
    if (!isHtmlPath(file.relativePath)) {
      continue
    }

    try {
      const raw = await fs.readFile(safeResolveVaultPath(vaultRoot, file.relativePath), 'utf8')
      const $ = cheerio.load(raw)
      if ($('html').length === 0 && $('body').length === 0 && raw.trim()) {
        issues.push({
          file: file.relativePath,
          kind: 'parse-error',
          message: 'HTML did not parse with a recognizable <html>/<body> root.',
        })
      }
    } catch (parseError) {
      issues.push({
        file: file.relativePath,
        kind: 'parse-error',
        message: parseError instanceof Error ? parseError.message : String(parseError),
      })
    }
  }

  return {
    ok: issues.length === 0,
    fileCount: index.files.length,
    linkCount: index.links.length,
    issues,
  }
}

function isOrphan(file: VaultFile, index: VaultIndex): boolean {
  const baseName = path.basename(file.relativePath).toLowerCase()
  if (baseName === 'index.html' || baseName === 'index.htm' || baseName === 'index.md') {
    return false
  }

  const incoming = index.backlinks[file.relativePath] ?? []
  return incoming.length === 0
}

export async function readVaultIndex(vaultRoot: string): Promise<VaultIndex> {
  await ensureRoot(vaultRoot)
  return createVaultIndex(vaultRoot)
}

export async function readDocument(vaultRoot: string, relativePath: string): Promise<string> {
  await ensureRoot(vaultRoot)
  const normalized = normalizeRelativePath(relativePath)
  return fs.readFile(safeResolveVaultPath(vaultRoot, normalized), 'utf8')
}
