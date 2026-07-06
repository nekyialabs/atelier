import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DragEvent as ReactDragEvent } from 'react'
import {
  BookOpen,
  Code2,
  ExternalLink,
  FileCode2,
  FilePlus2,
  FileText,
  FileUp,
  FolderOpen,
  FolderPlus,
  LayoutDashboard,
  Moon,
  Sun,
} from 'lucide-react'
import { BrandMark } from './components/BrandMark'
import { CommandPalette, type PaletteAction } from './components/CommandPalette'
import { Inspector } from './components/Inspector'
import { PromptDialog, type PromptDialogConfig } from './components/PromptDialog'
import {
  VaultSettingsDialog,
  type VaultSettingsTemplate,
  type VaultSettingsValues,
} from './components/VaultSettingsDialog'
import { VaultSidebar } from './components/VaultSidebar'
import { WelcomeScreen } from './components/WelcomeScreen'
import { Workspace } from './components/Workspace'
import type { ActiveVaultState, AppSettings, OpenVaultResult, Theme, WorkspaceMode } from './shared/types'
import './App.css'

function buildPreviewUrl(base: string, theme: Theme): string {
  const sep = base.includes('?') ? '&' : '?'
  return `${base}${sep}v=${Date.now()}&theme=${theme}`
}

function App() {
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [activeVault, setActiveVault] = useState<ActiveVaultState | null>(null)
  const [selectedPath, setSelectedPath] = useState('')
  const [content, setContent] = useState('')
  const [savedContent, setSavedContent] = useState('')
  const [previewUrl, setPreviewUrl] = useState('')
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('Ready')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [shellDropTarget, setShellDropTarget] = useState<string | null>(null)
  const [promptRequest, setPromptRequest] = useState<{
    config: PromptDialogConfig
    resolve: (value: string | null) => void
  } | null>(null)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [settingsState, setSettingsState] = useState<{
    initial: VaultSettingsValues
    templates: VaultSettingsTemplate[]
  } | null>(null)

  const themeRef = useRef<Theme>('light')

  const askForName = useCallback((config: PromptDialogConfig): Promise<string | null> => {
    return new Promise<string | null>((resolve) => {
      setPromptRequest({ config, resolve })
    })
  }, [])

  const index = activeVault?.index ?? null
  const selectedFile = useMemo(
    () => index?.files.find((file) => file.relativePath === selectedPath),
    [index, selectedPath],
  )
  const outgoingLinks = useMemo(
    () => index?.links.filter((link) => link.from === selectedPath) ?? [],
    [index, selectedPath],
  )
  const backlinks = useMemo(
    () => (selectedPath && index ? index.backlinks[selectedPath] ?? [] : []),
    [index, selectedPath],
  )
  const missingLinks = useMemo(
    () => outgoingLinks.filter((link) => link.kind === 'missing'),
    [outgoingLinks],
  )
  const dirty = content !== savedContent

  const updateSettings = useCallback(async (update: Partial<AppSettings>) => {
    setSettings((current) => (current ? { ...current, ...update } : current))
    const saved = await window.atelier.updateSettings(update)
    setSettings(saved)
    return saved
  }, [])

  const loadFile = useCallback(async (relativePath: string) => {
    setBusy(true)
    setError(null)
    try {
      const nextContent = await window.atelier.readFile(relativePath)
      const url = await window.atelier.setPreviewContent(relativePath, nextContent)
      setSelectedPath(relativePath)
      setContent(nextContent)
      setSavedContent(nextContent)
      setPreviewUrl(buildPreviewUrl(url, themeRef.current))
      setStatus(relativePath)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError))
    } finally {
      setBusy(false)
    }
  }, [])

  const applyOpenResult = useCallback(
    async (result: OpenVaultResult) => {
      setSettings(result.settings)
      setActiveVault(result.activeVault)
      setQuery('')
      const firstPath = pickInitialFile(result.activeVault)
      if (firstPath) {
        await loadFile(firstPath)
      } else {
        setSelectedPath('')
        setContent('')
        setSavedContent('')
        setPreviewUrl('')
        setStatus('Vault opened with no HTML files')
      }
    },
    [loadFile],
  )

  useEffect(() => {
    if (settings) {
      document.documentElement.setAttribute('data-theme', settings.theme)
      themeRef.current = settings.theme
    }
  }, [settings?.theme])

  useEffect(() => {
    let active = true

    window.atelier
      .getInitialState()
      .then(async (state) => {
        if (!active) {
          return
        }

        setSettings(state.settings)
        if (state.activeVault) {
          setActiveVault(state.activeVault)
          const firstPath = pickInitialFile(state.activeVault)
          if (firstPath) {
            await loadFile(firstPath)
          }
        }
      })
      .catch((initialError) => {
        setError(initialError instanceof Error ? initialError.message : String(initialError))
      })

    const unsubscribe = window.atelier.onIndexUpdated((nextIndex) => {
      setActiveVault((current) => (current ? { ...current, index: nextIndex } : current))
      setStatus(`${nextIndex.files.length} HTML artifacts indexed`)
    })

    return () => {
      active = false
      unsubscribe()
    }
  }, [loadFile])

  useEffect(() => {
    if (!selectedPath) {
      return
    }

    const handle = window.setTimeout(() => {
      window.atelier.setPreviewContent(selectedPath, content).then((url) => {
        setPreviewUrl(buildPreviewUrl(url, themeRef.current))
      })
    }, 250)

    return () => window.clearTimeout(handle)
  }, [content, selectedPath, settings?.theme])

  const openFolder = async () => {
    setBusy(true)
    setError(null)
    try {
      const result = await window.atelier.openFolder()
      if (result) {
        await applyOpenResult(result)
      }
    } catch (openError) {
      setError(openError instanceof Error ? openError.message : String(openError))
    } finally {
      setBusy(false)
    }
  }

  const openPath = async (rootPath: string) => {
    setBusy(true)
    setError(null)
    try {
      await applyOpenResult(await window.atelier.openPath(rootPath))
    } catch (openError) {
      setError(openError instanceof Error ? openError.message : String(openError))
    } finally {
      setBusy(false)
    }
  }

  const createDemoCopy = async () => {
    setBusy(true)
    setError(null)
    try {
      await applyOpenResult(await window.atelier.createDemoCopy())
    } catch (demoError) {
      setError(demoError instanceof Error ? demoError.message : String(demoError))
    } finally {
      setBusy(false)
    }
  }

  const openVaultSettings = async () => {
    setError(null)
    try {
      const { config, templates } = await window.atelier.getVaultConfig()
      setSettingsState({ initial: config, templates })
    } catch (configError) {
      setError(configError instanceof Error ? configError.message : String(configError))
    }
  }

  const saveVaultSettings = async (values: VaultSettingsValues) => {
    const updatedIndex = await window.atelier.saveVaultConfig(values)
    setActiveVault((current) => (current ? { ...current, index: updatedIndex } : current))
    setSettingsState(null)
    setStatus('Vault settings saved')
  }

  const closeVault = async () => {
    setBusy(true)
    setError(null)
    try {
      await window.atelier.closeVault()
      setActiveVault(null)
      setSelectedPath('')
      setContent('')
      setSavedContent('')
      setPreviewUrl('')
      setStatus('Vault closed')
      setQuery('')
    } catch (closeError) {
      setError(closeError instanceof Error ? closeError.message : String(closeError))
    } finally {
      setBusy(false)
    }
  }

  const createNewVault = async () => {
    setError(null)
    const parentDir = await window.atelier.pickDirectory({
      title: 'Choose location for new vault',
    })
    if (!parentDir) {
      return
    }

    const vaultName = await askForName({
      title: 'Name your vault',
      message: 'A new folder will be created at this location.',
      defaultValue: 'My Vault',
      submitLabel: 'Create',
    })
    if (!vaultName) {
      return
    }

    setBusy(true)
    try {
      await applyOpenResult(await window.atelier.createVaultAt(parentDir, vaultName))
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : String(createError))
    } finally {
      setBusy(false)
    }
  }

  const createArtifact = useCallback(async () => {
    const title = await askForName({
      title: 'New HTML artifact',
      message: 'Name your artifact. The file will be saved to the vault root.',
      defaultValue: 'New Artifact',
      submitLabel: 'Create',
    })
    if (!title) {
      return
    }

    setBusy(true)
    setError(null)
    try {
      const result = await window.atelier.createHtml(title)
      setActiveVault((current) => (current ? { ...current, index: result.index } : current))
      setSelectedPath(result.relativePath)
      setContent(result.content)
      setSavedContent(result.content)
      const url = await window.atelier.setPreviewContent(result.relativePath, result.content)
      setPreviewUrl(buildPreviewUrl(url, themeRef.current))
      setStatus(`Created ${result.relativePath}`)
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : String(createError))
    } finally {
      setBusy(false)
    }
  }, [askForName])

  const createMarkdownNote = useCallback(async () => {
    const title = await askForName({
      title: 'New Markdown note',
      message: 'Name your note. Frontmatter is added automatically.',
      defaultValue: 'New Note',
      submitLabel: 'Create',
    })
    if (!title) {
      return
    }

    setBusy(true)
    setError(null)
    try {
      const result = await window.atelier.createMarkdown(title)
      setActiveVault((current) => (current ? { ...current, index: result.index } : current))
      setSelectedPath(result.relativePath)
      setContent(result.content)
      setSavedContent(result.content)
      const url = await window.atelier.setPreviewContent(result.relativePath, result.content)
      setPreviewUrl(buildPreviewUrl(url, themeRef.current))
      setStatus(`Created ${result.relativePath}`)
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : String(createError))
    } finally {
      setBusy(false)
    }
  }, [askForName])

  const createFolder = useCallback(
    async (parentFolder?: string) => {
      const name = await askForName({
        title: 'New folder',
        message: parentFolder ? `Created inside ${parentFolder}` : 'Created at the vault root.',
        defaultValue: 'New Folder',
        submitLabel: 'Create',
      })
      if (!name) {
        return
      }

      if (name.includes('/') || name.includes('\\')) {
        setError('Folder name cannot include path separators.')
        return
      }

      const folderPath = parentFolder ? `${parentFolder}/${name}` : name

      setBusy(true)
      setError(null)
      try {
        const result = await window.atelier.createFolder(folderPath)
        setActiveVault((current) => (current ? { ...current, index: result.index } : current))
        setStatus(`Created folder ${result.folderPath}`)
      } catch (folderError) {
        setError(folderError instanceof Error ? folderError.message : String(folderError))
      } finally {
        setBusy(false)
      }
    },
    [askForName],
  )

  const renameFile = useCallback(
    async (fromPath: string, newName: string) => {
      if (!fromPath || !newName) {
        return
      }

      setBusy(true)
      setError(null)
      try {
        const result = await window.atelier.renameFile(fromPath, newName)
        setActiveVault((current) => (current ? { ...current, index: result.index } : current))
        if (selectedPath === result.fromPath) {
          setSelectedPath(result.toPath)
        }
        setStatus(`Renamed to ${result.toPath}`)
      } catch (renameError) {
        setError(renameError instanceof Error ? renameError.message : String(renameError))
      } finally {
        setBusy(false)
      }
    },
    [selectedPath],
  )

  const duplicateFile = useCallback(async (relativePath: string) => {
    setBusy(true)
    setError(null)
    try {
      const result = await window.atelier.duplicateFile(relativePath)
      setActiveVault((current) => (current ? { ...current, index: result.index } : current))
      setStatus(`Duplicated to ${result.duplicatePath}`)
    } catch (duplicateError) {
      setError(duplicateError instanceof Error ? duplicateError.message : String(duplicateError))
    } finally {
      setBusy(false)
    }
  }, [])

  const deleteFile = useCallback(
    async (relativePath: string) => {
      setBusy(true)
      setError(null)
      try {
        const result = await window.atelier.deleteFile(relativePath)
        setActiveVault((current) => (current ? { ...current, index: result.index } : current))
        if (selectedPath === result.removedPath) {
          setSelectedPath('')
          setContent('')
          setSavedContent('')
          setPreviewUrl('')
        }
        setStatus(
          result.permanentlyDeleted
            ? `Permanently deleted (system trash unavailable): ${result.removedPath}`
            : `Moved to trash: ${result.removedPath}`,
        )
      } catch (deleteError) {
        setError(deleteError instanceof Error ? deleteError.message : String(deleteError))
      } finally {
        setBusy(false)
      }
    },
    [selectedPath],
  )

  const revealInExplorer = useCallback(async (relativePath: string) => {
    try {
      await window.atelier.revealInExplorer(relativePath)
    } catch (revealError) {
      setError(revealError instanceof Error ? revealError.message : String(revealError))
    }
  }, [])

  const openInBrowser = useCallback(async (relativePath: string) => {
    try {
      await window.atelier.openInBrowser(relativePath)
    } catch (openError) {
      setError(openError instanceof Error ? openError.message : String(openError))
    }
  }, [])

  const saveMetadata = useCallback(
    async (updates: { description?: string; tags?: string[] }) => {
      if (!selectedPath) {
        return
      }

      setBusy(true)
      setError(null)
      try {
        const result = await window.atelier.updateMetadata(selectedPath, updates)
        setActiveVault((current) => (current ? { ...current, index: result.index } : current))
        const fresh = await window.atelier.readFile(result.relativePath)
        setContent(fresh)
        setSavedContent(fresh)
        const url = await window.atelier.setPreviewContent(result.relativePath, fresh)
        setPreviewUrl(buildPreviewUrl(url, themeRef.current))
        setStatus(`Updated metadata for ${result.relativePath}`)
      } catch (metadataError) {
        setError(metadataError instanceof Error ? metadataError.message : String(metadataError))
      } finally {
        setBusy(false)
      }
    },
    [selectedPath],
  )

  const moveFile = useCallback(
    async (fromPath: string, toPath: string) => {
      if (!fromPath || !toPath || fromPath === toPath) {
        return
      }

      setBusy(true)
      setError(null)
      try {
        const result = await window.atelier.moveFile(fromPath, toPath)
        setActiveVault((current) => (current ? { ...current, index: result.index } : current))
        if (selectedPath === result.fromPath) {
          setSelectedPath(result.toPath)
        }
        setStatus(`Moved to ${result.toPath}`)
      } catch (moveError) {
        setError(moveError instanceof Error ? moveError.message : String(moveError))
      } finally {
        setBusy(false)
      }
    },
    [selectedPath],
  )

  const dragCounter = useRef(0)

  const isExternalFileDrag = (event: ReactDragEvent<HTMLElement>): boolean => {
    const types = event.dataTransfer.types
    if (!types) {
      return false
    }
    const includes = (value: string) =>
      typeof types.includes === 'function' ? types.includes(value) : Array.from(types).includes(value)
    return includes('Files') && !includes('application/x-atelier-file')
  }

  const onShellDragEnter = (event: ReactDragEvent<HTMLDivElement>) => {
    if (!isExternalFileDrag(event)) {
      return
    }

    event.preventDefault()
    dragCounter.current += 1
    setShellDropTarget('root')
  }

  const onShellDragOver = (event: ReactDragEvent<HTMLDivElement>) => {
    if (!isExternalFileDrag(event)) {
      return
    }

    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
  }

  const onShellDragLeave = (event: ReactDragEvent<HTMLDivElement>) => {
    if (!isExternalFileDrag(event)) {
      return
    }

    dragCounter.current = Math.max(0, dragCounter.current - 1)
    if (dragCounter.current === 0) {
      setShellDropTarget(null)
    }
  }

  const onShellDrop = (event: ReactDragEvent<HTMLDivElement>) => {
    if (!isExternalFileDrag(event)) {
      return
    }

    event.preventDefault()
    dragCounter.current = 0
    setShellDropTarget(null)

    const files = Array.from(event.dataTransfer.files)
    if (!files.length) {
      return
    }

    const paths = window.atelier.getDroppedFilePaths(files)
    if (paths.length) {
      void importFiles(paths)
    }
  }

  const importFiles = useCallback(
    async (sourcePaths: string[], targetDirectory?: string) => {
      if (!sourcePaths.length) {
        return
      }

      setBusy(true)
      setError(null)
      try {
        const result = await window.atelier.importFiles(sourcePaths, targetDirectory)
        setActiveVault((current) => (current ? { ...current, index: result.index } : current))
        if (result.importedPaths.length === 0) {
          setStatus('No files imported')
          return
        }

        setStatus(
          result.importedPaths.length === 1
            ? `Imported ${result.importedPaths[0]}`
            : `Imported ${result.importedPaths.length} files`,
        )

        const firstHtml = result.importedPaths.find((relativePath) =>
          /\.html?$/i.test(relativePath),
        )
        if (firstHtml) {
          await loadFile(firstHtml)
        }
      } catch (importError) {
        setError(importError instanceof Error ? importError.message : String(importError))
      } finally {
        setBusy(false)
      }
    },
    [loadFile],
  )

  const saveCurrentFile = useCallback(async () => {
    if (!selectedPath || !dirty) {
      return
    }

    setBusy(true)
    setError(null)
    try {
      const result = await window.atelier.saveFile(selectedPath, content)
      setActiveVault((current) => (current ? { ...current, index: result.index } : current))
      setSavedContent(content)
      const url = await window.atelier.getPreviewUrl(selectedPath)
      setPreviewUrl(buildPreviewUrl(url, themeRef.current))
      setStatus(`Saved ${selectedPath}`)
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError))
    } finally {
      setBusy(false)
    }
  }, [content, dirty, selectedPath])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const modifier = event.ctrlKey || event.metaKey
      if (!modifier) {
        return
      }

      const key = event.key.toLowerCase()

      if (key === 's') {
        event.preventDefault()
        void saveCurrentFile()
        return
      }

      if (key === 'n') {
        event.preventDefault()
        if (event.shiftKey) {
          void createMarkdownNote()
        } else {
          void createArtifact()
        }
        return
      }

      if (key === 'k') {
        event.preventDefault()
        setPaletteOpen((open) => !open)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [createArtifact, createMarkdownNote, saveCurrentFile])

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const data = event.data as
        | {
            source?: string
            type?: string
            relativePath?: string
            href?: string
            key?: string
            shiftKey?: boolean
          }
        | null
      if (!data || data.source !== 'atelier-preview') {
        return
      }

      if (data.type === 'shortcut') {
        // Keyboard shortcuts fired from inside the preview iframe. Validate the
        // key strictly and mirror the window-level keydown handler's actions.
        const key = data.key
        if (key !== 's' && key !== 'k' && key !== 'n') {
          return
        }
        if (key === 's') {
          void saveCurrentFile()
        } else if (key === 'k') {
          setPaletteOpen((open) => !open)
        } else if (key === 'n') {
          if (data.shiftKey === true) {
            void createMarkdownNote()
          } else {
            void createArtifact()
          }
        }
        return
      }

      if (data.type === 'navigate' && typeof data.relativePath === 'string') {
        const target = data.relativePath
        const files = activeVault?.index.files ?? []
        const exact = files.find((file) => file.relativePath === target)
        if (exact) {
          void loadFile(exact.relativePath)
        } else {
          const targetBase = target.split('/').pop() ?? target
          const targetStem = targetBase.replace(/\.[^.]+$/, '').toLowerCase()
          const byBasename = files.find((file) => {
            const base = file.relativePath.split('/').pop() ?? file.relativePath
            const stem = base.replace(/\.[^.]+$/, '').toLowerCase()
            return stem === targetStem
          })
          if (byBasename) {
            void loadFile(byBasename.relativePath)
          } else {
            setStatus(`Not in vault: ${target}`)
          }
        }
      } else if (data.type === 'open-external' && typeof data.href === 'string') {
        void window.atelier.openExternal(data.href)
      }
    }

    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [activeVault, loadFile, saveCurrentFile, createMarkdownNote, createArtifact])

  const scrollToHeading = useCallback((index: number) => {
    // The preview iframes are sandboxed without allow-same-origin, so they have
    // an opaque origin; postMessage must target '*'. Only the mounted preview
    // iframe carries the injected listener that reacts to 'atelier-host'
    // messages, so broadcasting to every iframe is safe and avoids threading a
    // ref down through Workspace.
    document.querySelectorAll('iframe').forEach((frame) => {
      frame.contentWindow?.postMessage(
        { source: 'atelier-host', type: 'scroll-to-heading', index },
        '*',
      )
    })
  }, [])

  const copyPrompt = async (kind: 'create' | 'revise') => {
    if (!index) {
      return
    }

    const prompt =
      kind === 'create'
        ? `Create a new standalone HTML artifact inside this vault: ${index.rootPath}. Use real .html files, relative links, and asset paths that remain local to the vault. Link it from index.html when useful.`
        : `Revise ${selectedPath} inside this Atelier vault: ${index.rootPath}. Preserve local relative links, keep it as a real standalone HTML file, and update any related pages if the navigation changes.`

    await navigator.clipboard.writeText(prompt)
    setStatus('Prompt copied')
  }

  if (!settings) {
    return (
      <main className="loading-shell">
        <BrandMark size={34} />
        <h1>Atelier</h1>
        <div className="loading-skeleton" aria-hidden="true">
          <span className="skeleton-bar skeleton-bar-a" />
          <span className="skeleton-bar skeleton-bar-b" />
          <span className="skeleton-bar skeleton-bar-c" />
        </div>
        <p className="sr-only">Loading workspace</p>
      </main>
    )
  }

  const promptDialog = promptRequest ? (
    <PromptDialog
      config={promptRequest.config}
      onSubmit={(value) => {
        promptRequest.resolve(value)
        setPromptRequest(null)
      }}
      onCancel={() => {
        promptRequest.resolve(null)
        setPromptRequest(null)
      }}
    />
  ) : null

  const settingsDialog = settingsState ? (
    <VaultSettingsDialog
      initial={settingsState.initial}
      templates={settingsState.templates}
      theme={settings.theme}
      currentVaultPath={index?.rootPath ?? ''}
      currentVaultName={index?.vaultName ?? 'Vault'}
      recentVaults={settings.recentVaults}
      onSave={saveVaultSettings}
      onChangeTheme={(theme) => void updateSettings({ theme })}
      onOpenVault={(rootPath) => {
        setSettingsState(null)
        void openPath(rootPath)
      }}
      onPickFolder={() => {
        setSettingsState(null)
        void openFolder()
      }}
      onCreateNewVault={() => {
        setSettingsState(null)
        void createNewVault()
      }}
      onCloseVault={() => {
        setSettingsState(null)
        void closeVault()
      }}
      onCancel={() => setSettingsState(null)}
    />
  ) : null

  if (!activeVault || !index) {
    return (
      <>
        <WelcomeScreen
          settings={settings}
          busy={busy}
          error={error}
          onOpenFolder={() => void openFolder()}
          onCreateVault={() => void createNewVault()}
          onCreateDemo={() => void createDemoCopy()}
          onOpenRecent={(rootPath) => void openPath(rootPath)}
        />
        {promptDialog}
        {settingsDialog}
      </>
    )
  }

  return (
    <div
      className={`app-shell ${settings.leftSidebarCollapsed ? 'left-collapsed' : ''} ${
        settings.inspectorCollapsed ? 'inspector-collapsed' : ''
      } ${shellDropTarget ? 'drop-target' : ''}`}
      onDragEnter={onShellDragEnter}
      onDragOver={onShellDragOver}
      onDragLeave={onShellDragLeave}
      onDrop={onShellDrop}
    >
      <VaultSidebar
        index={index}
        selectedPath={selectedPath}
        query={query}
        collapsed={settings.leftSidebarCollapsed}
        onQueryChange={setQuery}
        onSelect={(path) => void loadFile(path)}
        onOpenFolder={() => void openFolder()}
        onCreateArtifact={() => void createArtifact()}
        onCreateMarkdown={() => void createMarkdownNote()}
        onCreateFolder={(parent) => void createFolder(parent)}
        onMoveFile={(fromPath, toPath) => void moveFile(fromPath, toPath)}
        onImportFiles={(sources, target) => void importFiles(sources, target)}
        onRenameFile={(fromPath, newName) => void renameFile(fromPath, newName)}
        onDuplicateFile={(relativePath) => void duplicateFile(relativePath)}
        onDeleteFile={(relativePath) => void deleteFile(relativePath)}
        onRevealInExplorer={(relativePath) => void revealInExplorer(relativePath)}
        onOpenInBrowser={(relativePath) => void openInBrowser(relativePath)}
      />

      <Workspace
        mode={settings.workspaceMode}
        sourceSplit={settings.sourceSplit}
        theme={settings.theme}
        index={index}
        selectedFile={selectedFile}
        selectedPath={selectedPath}
        content={content}
        dirty={dirty}
        busy={busy}
        previewUrl={previewUrl}
        status={error ?? status}
        leftCollapsed={settings.leftSidebarCollapsed}
        inspectorCollapsed={settings.inspectorCollapsed}
        onContentChange={setContent}
        onModeChange={(mode: WorkspaceMode) => void updateSettings({ workspaceMode: mode })}
        onSourceSplitChange={(sourceSplit) => void updateSettings({ sourceSplit })}
        onOpenSettings={() => void openVaultSettings()}
        onSave={() => void saveCurrentFile()}
        onReload={() => selectedPath && void loadFile(selectedPath)}
        onSelectFile={(path) => void loadFile(path)}
        onToggleLeft={() => void updateSettings({ leftSidebarCollapsed: !settings.leftSidebarCollapsed })}
        onToggleInspector={() => void updateSettings({ inspectorCollapsed: !settings.inspectorCollapsed })}
        onCreateHtml={() => void createArtifact()}
        onCreateMarkdown={() => void createMarkdownNote()}
        onCreateFolder={() => void createFolder()}
        onOpenInBrowser={(relativePath) => void openInBrowser(relativePath)}
        onTagClick={(tag) => setQuery(`tag:${tag}`)}
        onSaveMetadata={(updates) => void saveMetadata(updates)}
      />

      <Inspector
        index={index}
        selectedFile={selectedFile}
        selectedPath={selectedPath}
        outgoingLinks={outgoingLinks}
        backlinks={backlinks}
        missingLinks={missingLinks}
        collapsed={settings.inspectorCollapsed}
        onSelect={(path) => void loadFile(path)}
        onCopyPrompt={(kind) => void copyPrompt(kind)}
        onScrollToHeading={scrollToHeading}
      />

      {shellDropTarget ? (
        <div className="shell-drop-overlay" aria-hidden="true">
          <div className="shell-drop-card">
            <FileUp size={28} />
            <strong>Drop files into vault</strong>
            <span>HTML, assets, anything.</span>
          </div>
        </div>
      ) : null}

      {promptDialog}
      {settingsDialog}

      {paletteOpen ? (
        <CommandPalette
          index={index}
          actions={buildPaletteActions({
            closeVault: () => void closeVault(),
            openSettings: () => void openVaultSettings(),
            theme: settings.theme,
            selectedPath,
            createArtifact,
            createMarkdownNote,
            createFolder,
            openFolder,
            toggleTheme: () => void updateSettings({ theme: nextTheme(settings.theme) }),
            setMode: (mode) => void updateSettings({ workspaceMode: mode }),
            openInBrowser,
            revealInExplorer,
          })}
          onSelectFile={(relativePath) => void loadFile(relativePath)}
          onClose={() => setPaletteOpen(false)}
        />
      ) : null}
    </div>
  )
}

function buildPaletteActions(opts: {
  theme: Theme
  selectedPath: string
  createArtifact: () => Promise<void>
  createMarkdownNote: () => Promise<void>
  createFolder: (parent?: string) => Promise<void>
  openFolder: () => Promise<void>
  closeVault: () => void
  openSettings: () => void
  toggleTheme: () => void
  setMode: (mode: WorkspaceMode) => void
  openInBrowser: (relativePath: string) => Promise<void>
  revealInExplorer: (relativePath: string) => Promise<void>
}): PaletteAction[] {
  const actions: PaletteAction[] = [
    {
      id: 'new-html',
      label: 'New HTML',
      hint: 'Cmd/Ctrl + N',
      icon: <FileCode2 size={14} />,
      keywords: ['create', 'artifact'],
      run: () => void opts.createArtifact(),
    },
    {
      id: 'new-markdown',
      label: 'New Markdown',
      hint: 'Cmd/Ctrl + Shift + N',
      icon: <FileText size={14} />,
      keywords: ['note', 'md', 'create'],
      run: () => void opts.createMarkdownNote(),
    },
    {
      id: 'new-folder',
      label: 'New Folder',
      icon: <FolderPlus size={14} />,
      keywords: ['mkdir', 'directory'],
      run: () => void opts.createFolder(),
    },
    {
      id: 'open-folder',
      label: 'Open Vault…',
      icon: <FolderOpen size={14} />,
      keywords: ['switch', 'load'],
      run: () => void opts.openFolder(),
    },
    {
      id: 'close-vault',
      label: 'Close Vault',
      keywords: ['exit', 'leave', 'switch'],
      run: opts.closeVault,
    },
    {
      id: 'vault-settings',
      label: 'Vault Settings…',
      keywords: ['config', 'options', 'preferences', 'ignored', 'template'],
      run: opts.openSettings,
    },
    {
      id: 'toggle-theme',
      label: opts.theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme',
      icon: opts.theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />,
      keywords: ['dark', 'light', 'mode'],
      run: opts.toggleTheme,
    },
    {
      id: 'mode-preview',
      label: 'View: Preview',
      icon: <LayoutDashboard size={14} />,
      keywords: ['render', 'mode'],
      run: () => opts.setMode('preview'),
    },
    {
      id: 'mode-split',
      label: 'View: Split',
      icon: <Code2 size={14} />,
      keywords: ['source', 'editor', 'mode'],
      run: () => opts.setMode('split'),
    },
    {
      id: 'mode-source',
      label: 'View: Source',
      icon: <FilePlus2 size={14} />,
      keywords: ['code', 'editor', 'mode'],
      run: () => opts.setMode('source'),
    },
    {
      id: 'mode-reading',
      label: 'View: Reading',
      icon: <BookOpen size={14} />,
      keywords: ['read', 'book', 'mode'],
      run: () => opts.setMode('reading'),
    },
    // 'View: Graph' palette entry removed until GraphView is rebuilt properly
    // (ring layout collapses on real vaults). Mode plumbing intentionally kept.
  ]

  if (opts.selectedPath) {
    actions.push(
      {
        id: 'open-in-browser',
        label: 'Open current file in system browser',
        icon: <ExternalLink size={14} />,
        keywords: ['browser', 'system'],
        run: () => void opts.openInBrowser(opts.selectedPath),
      },
      {
        id: 'reveal-in-explorer',
        label: 'Reveal current file in file manager',
        icon: <FolderOpen size={14} />,
        keywords: ['explorer', 'finder', 'reveal'],
        run: () => void opts.revealInExplorer(opts.selectedPath),
      },
    )
  }

  return actions
}

function pickInitialFile(activeVault: ActiveVaultState): string {
  return (
    activeVault.index.files.find((file) => file.relativePath === 'index.html')?.relativePath ??
    activeVault.index.files[0]?.relativePath ??
    ''
  )
}

function nextTheme(theme: Theme): Theme {
  return theme === 'dark' ? 'light' : 'dark'
}

export default App
