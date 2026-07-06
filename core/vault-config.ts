import { promises as fs } from 'node:fs'
import path from 'node:path'

export const CONFIG_DIRECTORY = '.htmlvault'
export const CONFIG_FILE = 'config.json'
export const TEMPLATES_DIRECTORY = 'templates'

export interface VaultConfig {
  vaultName?: string
  defaultTemplate?: string
  ignoredPaths?: string[]
}

export interface VaultTemplate {
  name: string
  format: 'html' | 'md'
  relativePath: string
  body: string
}

export async function writeVaultConfig(vaultRoot: string, config: VaultConfig): Promise<void> {
  const dir = path.join(vaultRoot, CONFIG_DIRECTORY)
  const file = path.join(dir, CONFIG_FILE)
  await fs.mkdir(dir, { recursive: true })

  const cleaned: VaultConfig = {}
  if (typeof config.vaultName === 'string' && config.vaultName.trim()) {
    cleaned.vaultName = config.vaultName.trim()
  }
  if (typeof config.defaultTemplate === 'string' && config.defaultTemplate.trim()) {
    cleaned.defaultTemplate = config.defaultTemplate.trim()
  }
  if (Array.isArray(config.ignoredPaths)) {
    const filtered = config.ignoredPaths
      .filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
      .map((entry) => entry.trim())
    if (filtered.length > 0) {
      cleaned.ignoredPaths = filtered
    }
  }

  await fs.writeFile(file, `${JSON.stringify(cleaned, null, 2)}\n`, 'utf8')
}

export async function readVaultConfig(vaultRoot: string): Promise<VaultConfig> {
  const configPath = path.join(vaultRoot, CONFIG_DIRECTORY, CONFIG_FILE)

  try {
    const raw = await fs.readFile(configPath, 'utf8')
    const parsed = JSON.parse(raw) as Partial<VaultConfig>
    return {
      ...(typeof parsed.vaultName === 'string' && parsed.vaultName.trim()
        ? { vaultName: parsed.vaultName.trim() }
        : {}),
      ...(typeof parsed.defaultTemplate === 'string' && parsed.defaultTemplate.trim()
        ? { defaultTemplate: parsed.defaultTemplate.trim() }
        : {}),
      ...(Array.isArray(parsed.ignoredPaths)
        ? {
            ignoredPaths: parsed.ignoredPaths.filter(
              (entry): entry is string => typeof entry === 'string' && entry.trim().length > 0,
            ),
          }
        : {}),
    }
  } catch (error) {
    // A missing config file is normal (vault has no config yet) → defaults.
    // Parse or permission errors are surfaced to the console so the failure is
    // not silently swallowed, but we still return defaults so the app can run.
    if (!isEnoent(error)) {
      console.error(`Failed to read vault config at ${configPath}:`, error)
    }
    return {}
  }
}

function isEnoent(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as NodeJS.ErrnoException).code === 'ENOENT'
  )
}

export async function listTemplates(vaultRoot: string): Promise<VaultTemplate[]> {
  const templatesDir = path.join(vaultRoot, CONFIG_DIRECTORY, TEMPLATES_DIRECTORY)
  const entries = await fs.readdir(templatesDir, { withFileTypes: true }).catch(() => [])
  const templates: VaultTemplate[] = []

  for (const entry of entries) {
    if (!entry.isFile()) {
      continue
    }

    const extension = path.extname(entry.name).toLowerCase()
    const format: 'html' | 'md' | null =
      extension === '.html' || extension === '.htm'
        ? 'html'
        : extension === '.md' || extension === '.markdown'
        ? 'md'
        : null

    if (!format) {
      continue
    }

    const absolute = path.join(templatesDir, entry.name)
    const body = await fs.readFile(absolute, 'utf8').catch(() => '')
    const stem = entry.name.slice(0, entry.name.length - extension.length)

    templates.push({
      name: stem,
      format,
      relativePath: `${CONFIG_DIRECTORY}/${TEMPLATES_DIRECTORY}/${entry.name}`,
      body,
    })
  }

  return templates.sort((a, b) => a.name.localeCompare(b.name))
}

export async function readTemplateBody(
  vaultRoot: string,
  templateName: string,
  format: 'html' | 'md',
): Promise<string | null> {
  // Template names are used to build a filesystem path directly. Reject any
  // name carrying path separators or parent-directory segments so a caller
  // cannot escape the templates directory (e.g. '../../secret').
  if (/[/\\]/.test(templateName) || templateName.includes('..')) {
    return null
  }

  const candidates =
    format === 'html'
      ? [`${templateName}.html`, `${templateName}.htm`]
      : [`${templateName}.md`, `${templateName}.markdown`]

  for (const candidate of candidates) {
    const absolute = path.join(vaultRoot, CONFIG_DIRECTORY, TEMPLATES_DIRECTORY, candidate)
    const body = await fs.readFile(absolute, 'utf8').catch(() => null)
    if (body !== null) {
      return body
    }
  }

  return null
}

export function fillTemplate(body: string, title: string): string {
  return body
    .replaceAll('{{title}}', title)
    .replaceAll('{{TITLE}}', title.toUpperCase())
    .replaceAll('{{date}}', new Date().toISOString().slice(0, 10))
}
