import { app, BrowserWindow, Menu, dialog, ipcMain, shell } from 'electron'
import electronUpdater from 'electron-updater'
import chokidar, { type FSWatcher } from 'chokidar'

const { autoUpdater } = electronUpdater
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PreviewServer } from './preview-server.js'
import { createVaultIndex, shouldIgnoreEntry } from '../core/vault-indexer.js'
import { listTemplates, readVaultConfig, writeVaultConfig, type VaultConfig } from '../core/vault-config.js'
import {
  createDocumentFromTitle,
  createFolder as createFolderOp,
  createVault as createVaultOp,
  deleteFile as deleteFileOp,
  duplicateFile as duplicateFileOp,
  importFiles as importFilesOp,
  moveFile as moveFileOp,
  readDocument,
  renameFile as renameFileOp,
  updateDocument,
} from '../core/vault-ops.js'
import { writeMetadata } from '../core/metadata-writer.js'
import { safeResolveVaultPath } from '../core/path-guards.js'
import { readSettings, updateSettings, withRecentVault, writeSettings } from '../core/settings.js'
import type {
  ActiveVaultState,
  AppSettings,
  AppSettingsUpdate,
  CreateFolderResult,
  CreateHtmlResult,
  DeleteFileResult,
  DuplicateFileResult,
  ImportFilesResult,
  InitialAppState,
  MoveFileResult,
  OpenVaultResult,
  SaveFileResult,
  UpdateMetadataResult,
  VaultFile,
  VaultIndex,
} from '../src/shared/types.js'

let mainWindow: BrowserWindow | undefined
let currentVaultRoot: string | undefined
let currentIndex: VaultIndex | undefined
let currentIgnoredPaths: readonly string[] = []
let watcher: FSWatcher | undefined
let reindexTimer: NodeJS.Timeout | undefined

const previewServer = new PreviewServer()
const preloadPath = fileURLToPath(new URL('./preload.js', import.meta.url))
const rendererDevUrl = process.env.VITE_DEV_SERVER_URL

async function createWindow(): Promise<void> {
  Menu.setApplicationMenu(null)
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1120,
    minHeight: 720,
    title: 'Atelier',
    autoHideMenuBar: true,
    backgroundColor: '#0c0b09',
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })
  mainWindow.setMenuBarVisibility(false)

  if (rendererDevUrl) {
    await mainWindow.loadURL(rendererDevUrl)
  } else {
    await mainWindow.loadFile(path.join(app.getAppPath(), 'dist', 'index.html'))
  }
}

async function initializeVault(rootPath: string): Promise<ActiveVaultState> {
  await ensureDirectory(rootPath)
  currentVaultRoot = rootPath
  const config = await readVaultConfig(rootPath)
  currentIgnoredPaths = config.ignoredPaths ?? []
  await previewServer.start(currentVaultRoot)
  previewServer.updateVaultRoot(currentVaultRoot)
  currentIndex = await createVaultIndex(currentVaultRoot, { userIgnored: currentIgnoredPaths })
  await startWatcher(currentVaultRoot)

  return {
    index: currentIndex,
    previewBaseUrl: previewServer.baseUrl,
  }
}

async function openVault(rootPath: string): Promise<OpenVaultResult> {
  const activeVault = await initializeVault(rootPath)
  const settings = withRecentVault(await readAppSettings(), rootPath)
  const savedSettings = await writeSettings(getSettingsPath(), settings)

  return {
    settings: savedSettings,
    activeVault,
  }
}

async function startWatcher(rootPath: string): Promise<void> {
  if (watcher) {
    await watcher.close()
  }

  watcher = chokidar.watch(rootPath, {
    ignored: (absolutePath) => {
      const relative = path.relative(rootPath, absolutePath).replace(/\\/g, '/')
      if (!relative || relative === '.') {
        return false
      }
      const basename = path.basename(absolutePath)
      return shouldIgnoreEntry(relative, basename, currentIgnoredPaths)
    },
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: 100,
      pollInterval: 25,
    },
  })

  watcher.on('add', scheduleReindex)
  watcher.on('change', scheduleReindex)
  watcher.on('unlink', scheduleReindex)
  watcher.on('addDir', scheduleReindex)
  watcher.on('unlinkDir', scheduleReindex)
}

function scheduleReindex(): void {
  if (reindexTimer) {
    clearTimeout(reindexTimer)
  }

  reindexTimer = setTimeout(() => {
    void refreshIndex()
  }, 150)
}

async function refreshIndex(): Promise<VaultIndex> {
  if (!currentVaultRoot) {
    throw new Error('No vault is open.')
  }

  currentIndex = await createVaultIndex(currentVaultRoot, { userIgnored: currentIgnoredPaths })
  mainWindow?.webContents.send('vault:index-updated', currentIndex)
  return currentIndex
}

function broadcastIndex(index: VaultIndex): void {
  currentIndex = index
  mainWindow?.webContents.send('vault:index-updated', index)
}

async function getFileByPath(relativePath: string): Promise<VaultFile> {
  const index = currentIndex ?? (await refreshIndex())
  const file = index.files.find((item) => item.relativePath === relativePath)

  if (!file) {
    throw new Error(`File is not indexed: ${relativePath}`)
  }

  return file
}

function getSettingsPath(): string {
  return path.join(app.getPath('userData'), 'settings.json')
}

async function readAppSettings(): Promise<AppSettings> {
  return readSettings(getSettingsPath())
}

function requireVaultRoot(): string {
  if (!currentVaultRoot) {
    throw new Error('No vault is open.')
  }

  return currentVaultRoot
}

async function ensureDirectory(rootPath: string): Promise<void> {
  const stats = await fs.stat(rootPath).catch(() => undefined)

  if (!stats?.isDirectory()) {
    throw new Error(`Vault path is not a directory: ${rootPath}`)
  }
}

async function resolveDemoVaultSource(): Promise<string> {
  // In development the demo vault sits next to the app source; in packaged
  // builds it is bundled as an extra resource under resourcesPath. Prefer the
  // app path (matches the renderer's loadFile resolution) and fall back to the
  // packaged resources directory.
  const candidates = [
    path.join(app.getAppPath(), 'demo-vault'),
    ...(process.resourcesPath ? [path.join(process.resourcesPath, 'demo-vault')] : []),
  ]

  for (const candidate of candidates) {
    if (await pathExists(candidate)) {
      return candidate
    }
  }

  // Nothing found; return the primary candidate so ensureDirectory throws a
  // clear, actionable error rather than a misleading cwd-relative path.
  return candidates[0]
}

async function createDemoVaultCopy(): Promise<string> {
  const source = await resolveDemoVaultSource()
  await ensureDirectory(source)

  const documentsPath = app.getPath('documents')
  const baseDestination = path.join(documentsPath, 'Atelier Demo')
  let destination = baseDestination
  let counter = 2

  while (await pathExists(destination)) {
    destination = `${baseDestination} ${counter}`
    counter += 1
  }

  await fs.cp(source, destination, { recursive: true })
  return destination
}

async function pathExists(absolutePath: string): Promise<boolean> {
  try {
    await fs.access(absolutePath)
    return true
  } catch {
    return false
  }
}

ipcMain.handle('app:get-initial-state', async (): Promise<InitialAppState> => {
  const settings = await readAppSettings()

  return {
    settings,
    ...(currentIndex ? { activeVault: { index: currentIndex, previewBaseUrl: previewServer.baseUrl } } : {}),
  }
})

ipcMain.handle('settings:get', async (): Promise<AppSettings> => {
  return readAppSettings()
})

ipcMain.handle('settings:update', async (_event, update: AppSettingsUpdate): Promise<AppSettings> => {
  return updateSettings(getSettingsPath(), update)
})

ipcMain.handle('vault:open-folder', async (): Promise<OpenVaultResult | null> => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    title: 'Open Atelier Vault',
    properties: ['openDirectory'],
  })

  if (result.canceled || !result.filePaths[0]) {
    return null
  }

  return openVault(result.filePaths[0])
})

ipcMain.handle('vault:open-path', async (_event, rootPath: string): Promise<OpenVaultResult> => {
  return openVault(rootPath)
})

ipcMain.handle('vault:create-demo-copy', async (): Promise<OpenVaultResult> => {
  return openVault(await createDemoVaultCopy())
})

ipcMain.handle(
  'vault:pick-directory',
  async (
    _event,
    options: { title?: string; defaultPath?: string } | undefined,
  ): Promise<string | null> => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: options?.title ?? 'Choose folder',
      defaultPath: options?.defaultPath ?? app.getPath('documents'),
      properties: ['openDirectory', 'createDirectory'],
    })

    if (result.canceled || !result.filePaths[0]) {
      return null
    }

    return result.filePaths[0]
  },
)

ipcMain.handle(
  'vault:create-at',
  async (_event, parentDir: string, vaultName: string): Promise<OpenVaultResult> => {
    const { vaultRoot } = await createVaultOp(parentDir, vaultName)
    return openVault(vaultRoot)
  },
)

ipcMain.handle(
  'vault:get-config',
  async (): Promise<{ config: VaultConfig; templates: Array<{ name: string; format: 'html' | 'md' }> }> => {
    const root = requireVaultRoot()
    const [config, templates] = await Promise.all([readVaultConfig(root), listTemplates(root)])
    return {
      config,
      templates: templates.map((t) => ({ name: t.name, format: t.format })),
    }
  },
)

ipcMain.handle(
  'vault:save-config',
  async (_event, config: VaultConfig): Promise<VaultIndex> => {
    const root = requireVaultRoot()
    await writeVaultConfig(root, config)
    currentIgnoredPaths = config.ignoredPaths ?? []
    return refreshIndex()
  },
)

ipcMain.handle('vault:close', async (): Promise<void> => {
  if (watcher) {
    await watcher.close()
    watcher = undefined
  }
  if (reindexTimer) {
    clearTimeout(reindexTimer)
    reindexTimer = undefined
  }
  await previewServer.stop()
  currentVaultRoot = undefined
  currentIndex = undefined
  currentIgnoredPaths = []
})

ipcMain.handle('vault:read-file', async (_event, relativePath: string): Promise<string> => {
  return readDocument(requireVaultRoot(), relativePath)
})

ipcMain.handle('vault:save-file', async (_event, relativePath: string, content: string): Promise<SaveFileResult> => {
  const result = await updateDocument(requireVaultRoot(), relativePath, content, {
    beforeRefresh: (path) => {
      if (path) {
        previewServer.clearUnsavedContent(path)
      }
    },
  })
  broadcastIndex(result.index)

  return {
    index: result.index,
    file: await getFileByPath(result.relativePath),
  }
})

ipcMain.handle('vault:create-html', async (_event, title = 'Untitled Artifact'): Promise<CreateHtmlResult> => {
  const result = await createDocumentFromTitle(requireVaultRoot(), title, 'html')
  broadcastIndex(result.index)
  return result
})

ipcMain.handle('vault:create-markdown', async (_event, title = 'Untitled Note'): Promise<CreateHtmlResult> => {
  const result = await createDocumentFromTitle(requireVaultRoot(), title, 'md')
  broadcastIndex(result.index)
  return result
})

ipcMain.handle('vault:create-folder', async (_event, folderPath: string): Promise<CreateFolderResult> => {
  const result = await createFolderOp(requireVaultRoot(), folderPath)
  broadcastIndex(result.index)
  return result
})

ipcMain.handle('vault:move-file', async (_event, fromPath: string, toPath: string): Promise<MoveFileResult> => {
  const result = await moveFileOp(requireVaultRoot(), fromPath, toPath, {
    beforeRefresh: (path) => {
      if (path) {
        previewServer.clearUnsavedContent(path)
      }
    },
  })
  broadcastIndex(result.index)
  return result
})

ipcMain.handle('vault:rename-file', async (_event, fromPath: string, newName: string): Promise<MoveFileResult> => {
  const result = await renameFileOp(requireVaultRoot(), fromPath, newName, {
    beforeRefresh: (path) => {
      if (path) {
        previewServer.clearUnsavedContent(path)
      }
    },
  })
  broadcastIndex(result.index)
  return result
})

ipcMain.handle('vault:duplicate-file', async (_event, relativePath: string): Promise<DuplicateFileResult> => {
  const result = await duplicateFileOp(requireVaultRoot(), relativePath)
  broadcastIndex(result.index)
  return result
})

ipcMain.handle('vault:delete-file', async (_event, relativePath: string): Promise<DeleteFileResult> => {
  const result = await deleteFileOp(requireVaultRoot(), relativePath, {
    trashItem: (absolute) => shell.trashItem(absolute),
    beforeRefresh: (path) => {
      if (path) {
        previewServer.clearUnsavedContent(path)
      }
    },
  })
  broadcastIndex(result.index)
  return result
})

ipcMain.handle(
  'vault:import-files',
  async (_event, sourcePaths: string[], targetDirectory?: string): Promise<ImportFilesResult> => {
    const result = await importFilesOp(requireVaultRoot(), sourcePaths, targetDirectory)
    broadcastIndex(result.index)
    return result
  },
)

ipcMain.handle(
  'vault:update-metadata',
  async (_event, relativePath: string, updates: { description?: string; tags?: string[] }): Promise<UpdateMetadataResult> => {
    const root = requireVaultRoot()
    const current = await readDocument(root, relativePath)
    const next = writeMetadata(current, relativePath, updates)
    const result = await updateDocument(root, relativePath, next, {
      beforeRefresh: (path) => {
        if (path) {
          previewServer.clearUnsavedContent(path)
        }
      },
    })
    broadcastIndex(result.index)
    return { relativePath: result.relativePath, index: result.index }
  },
)

ipcMain.handle('vault:reveal-in-explorer', async (_event, relativePath: string): Promise<void> => {
  const root = requireVaultRoot()
  const absolute = safeResolveVaultPath(root, relativePath)
  if (!(await pathExists(absolute))) {
    return
  }
  shell.showItemInFolder(absolute)
})

ipcMain.handle('vault:open-in-browser', async (_event, relativePath: string): Promise<void> => {
  const root = requireVaultRoot()
  const absolute = safeResolveVaultPath(root, relativePath)
  if (!(await pathExists(absolute))) {
    return
  }
  await shell.openPath(absolute)
})

ipcMain.handle('preview:set-content', (_event, relativePath: string, content: string): string => {
  return previewServer.setUnsavedContent(relativePath, content)
})

ipcMain.handle('preview:get-url', (_event, relativePath: string): string => {
  return previewServer.getPreviewUrl(relativePath)
})

ipcMain.handle('shell:open-external', async (_event, href: string): Promise<void> => {
  if (typeof href !== 'string' || !href) {
    return
  }

  try {
    const parsed = new URL(href)
    if (['http:', 'https:', 'mailto:', 'tel:'].includes(parsed.protocol)) {
      await shell.openExternal(href)
    }
  } catch {
    // Ignore unparseable URLs
  }
})

function setupAutoUpdater(): void {
  // Only packaged builds have update metadata; dev runs skip entirely.
  if (!app.isPackaged) {
    return
  }

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('update-downloaded', (info) => {
    const win = BrowserWindow.getAllWindows()[0]
    void dialog
      .showMessageBox(win, {
        type: 'info',
        title: 'Update ready',
        message: `Atelier ${info.version} is ready.`,
        detail: 'Restart to apply, or it will install on next quit.',
        buttons: ['Restart now', 'Later'],
        defaultId: 0,
        cancelId: 1,
      })
      .then(({ response }) => {
        if (response === 0) {
          autoUpdater.quitAndInstall()
        }
      })
  })

  autoUpdater.on('error', (updateError) => {
    // Never let update plumbing break the app — log and move on.
    console.error('[auto-updater]', updateError?.message ?? updateError)
  })

  const check = () => {
    autoUpdater.checkForUpdates().catch((checkError: unknown) => {
      console.error('[auto-updater] check failed:', checkError)
    })
  }

  // First check shortly after launch, then every 4 hours while running.
  setTimeout(check, 15_000)
  setInterval(check, 4 * 60 * 60 * 1000)
}

app.whenReady().then(async () => {
  await readAppSettings()
  await createWindow()
  setupAutoUpdater()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  void watcher?.close()
  void previewServer.stop()
})
