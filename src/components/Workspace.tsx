import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import Editor from '@monaco-editor/react'
import {
  BookOpen,
  Code2,
  ExternalLink,
  FileCode2,
  GitFork,
  LayoutDashboard,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  RefreshCcw,
  Save,
  Settings,
} from 'lucide-react'
import { EmptyWorkspace } from './EmptyWorkspace'
import { GraphView } from './GraphView'
import type { Theme, VaultFile, VaultIndex, WorkspaceMode } from '../shared/types'

const MARKDOWN_EXTENSIONS = ['.md', '.markdown']

function isMarkdownPath(value: string): boolean {
  const lower = value.toLowerCase()
  return MARKDOWN_EXTENSIONS.some((ext) => lower.endsWith(ext))
}

export function Workspace({
  mode,
  sourceSplit,
  theme,
  index,
  selectedFile,
  selectedPath,
  content,
  dirty,
  busy,
  previewUrl,
  status,
  leftCollapsed,
  inspectorCollapsed,
  onContentChange,
  onModeChange,
  onSourceSplitChange,
  onOpenSettings,
  onSave,
  onReload,
  onSelectFile,
  onToggleLeft,
  onToggleInspector,
  onCreateHtml,
  onCreateMarkdown,
  onCreateFolder,
  onOpenInBrowser,
  onTagClick,
  onSaveMetadata,
}: {
  mode: WorkspaceMode
  sourceSplit: number
  theme: Theme
  index: VaultIndex
  selectedFile?: VaultFile
  selectedPath: string
  content: string
  dirty: boolean
  busy: boolean
  previewUrl: string
  status: string
  leftCollapsed: boolean
  inspectorCollapsed: boolean
  onContentChange: (content: string) => void
  onModeChange: (mode: WorkspaceMode) => void
  onSourceSplitChange: (split: number) => void
  onOpenSettings: () => void
  onSave: () => void
  onReload: () => void
  onSelectFile: (path: string) => void
  onToggleLeft: () => void
  onToggleInspector: () => void
  onCreateHtml: () => void
  onCreateMarkdown: () => void
  onCreateFolder: () => void
  onOpenInBrowser: (relativePath: string) => void
  onTagClick: (tag: string) => void
  onSaveMetadata: (updates: { description?: string; tags?: string[] }) => void
}) {
  const editorLanguage = isMarkdownPath(selectedPath) ? 'markdown' : 'html'
  const [draftSplit, setDraftSplit] = useState(sourceSplit)
  const [resizing, setResizing] = useState(false)
  const splitContainerRef = useRef<HTMLElement | null>(null)
  const [justSaved, setJustSaved] = useState(false)
  const previousStatusRef = useRef(status)

  useEffect(() => {
    const changed = status !== previousStatusRef.current
    previousStatusRef.current = status
    if (changed && status.startsWith('Saved ')) {
      setJustSaved(true)
      const timeout = setTimeout(() => setJustSaved(false), 340)
      return () => clearTimeout(timeout)
    }
  }, [status])

  const startResize = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!splitContainerRef.current) {
      return
    }

    event.preventDefault()
    setResizing(true)
    let nextCommittedSplit = draftSplit

    const updateSplit = (clientX: number) => {
      if (!splitContainerRef.current) {
        return
      }

      const rect = splitContainerRef.current.getBoundingClientRect()
      const nextSplit = ((clientX - rect.left) / rect.width) * 100
      nextCommittedSplit = clamp(nextSplit, 25, 75)
      setDraftSplit(nextCommittedSplit)
    }

    updateSplit(event.clientX)

    const onPointerMove = (moveEvent: PointerEvent) => updateSplit(moveEvent.clientX)
    const onPointerUp = () => {
      setResizing(false)
      onSourceSplitChange(nextCommittedSplit)
      window.removeEventListener('pointermove', onPointerMove)
    }

    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp, { once: true })
  }

  return (
    <main className="workspace">
      <header className="workspace-topbar">
        <div className="topbar-left">
          <button type="button" className="icon-button" title="Toggle files" onClick={onToggleLeft}>
            {leftCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
          </button>
          <div className="selected-title">
            <FileCode2 size={18} />
            <div>
              <strong>{selectedFile?.title ?? 'No file selected'}</strong>
              <span>{selectedPath}</span>
            </div>
          </div>
        </div>

        <div className="toolbar">
          <div className="segmented-control wide" aria-label="Workspace mode">
            <ModeButton mode="preview" activeMode={mode} icon={<LayoutDashboard size={15} />} onModeChange={onModeChange} />
            <ModeButton mode="split" activeMode={mode} icon={<Code2 size={15} />} onModeChange={onModeChange} />
            <ModeButton mode="source" activeMode={mode} icon={<FileCode2 size={15} />} onModeChange={onModeChange} />
            <ModeButton mode="reading" activeMode={mode} icon={<BookOpen size={15} />} onModeChange={onModeChange} />
            <ModeButton mode="graph" activeMode={mode} icon={<GitFork size={15} />} onModeChange={onModeChange} />
          </div>

          <button
            type="button"
            className="icon-button"
            title="Vault settings"
            onClick={onOpenSettings}
          >
            <Settings size={16} />
          </button>
          {selectedPath ? (
            <button
              type="button"
              className="icon-button"
              title="Open in system browser"
              onClick={() => onOpenInBrowser(selectedPath)}
            >
              <ExternalLink size={16} />
            </button>
          ) : null}
          <button type="button" className="icon-button" title="Reload file" onClick={onReload}>
            <RefreshCcw size={16} />
          </button>
          <button
            type="button"
            className={`save-button${justSaved ? ' save-pulse' : ''}`}
            disabled={!dirty || busy}
            onClick={onSave}
          >
            <Save size={16} />
            <span>{dirty ? 'Save' : 'Saved'}</span>
          </button>
          <button type="button" className="icon-button" title="Toggle inspector" onClick={onToggleInspector}>
            {inspectorCollapsed ? <PanelRightOpen size={16} /> : <PanelRightClose size={16} />}
          </button>
        </div>
      </header>

      {selectedFile && mode !== 'graph' ? (
        <PropertiesBar file={selectedFile} onTagClick={onTagClick} onSaveMetadata={onSaveMetadata} />
      ) : null}

      {!selectedPath && mode !== 'graph' ? (
        <EmptyWorkspace
          vaultName={index.vaultName}
          onCreateHtml={onCreateHtml}
          onCreateMarkdown={onCreateMarkdown}
          onCreateFolder={onCreateFolder}
        />
      ) : mode === 'graph' ? (
        <GraphView index={index} selectedPath={selectedPath} onSelect={onSelectFile} />
      ) : mode === 'reading' ? (
        <section className="reading-pane" key={`reading-${selectedPath}`}>
          {previewUrl ? (
            <iframe title="HTML reading view" src={previewUrl} sandbox="allow-scripts allow-forms" />
          ) : null}
        </section>
      ) : (
        <section
          ref={splitContainerRef}
          key="editor"
          className={`editor-preview-grid mode-${mode} ${resizing ? 'resizing' : ''}`}
        >
          {(mode === 'split' || mode === 'source') && (
            <div
              className="pane source-pane"
              style={mode === 'split' ? { flexBasis: `${draftSplit}%` } : undefined}
            >
              <div className="pane-label">
                <Code2 size={14} />
                <span>Source</span>
              </div>
              <Editor
                height="100%"
                defaultLanguage={editorLanguage}
                language={editorLanguage}
                path={selectedPath || undefined}
                theme={theme === 'dark' ? 'vs-dark' : 'vs'}
                value={content}
                options={{
                  minimap: { enabled: false },
                  fontFamily: 'Cascadia Code, Consolas, monospace',
                  fontSize: 13,
                  lineHeight: 20,
                  wordWrap: 'on',
                  scrollBeyondLastLine: false,
                  automaticLayout: true,
                }}
                onChange={(value) => onContentChange(value ?? '')}
              />
            </div>
          )}

          {mode === 'split' ? (
            <button
              type="button"
              className="split-resizer"
              title="Resize source and preview panes"
              aria-label="Resize source and preview panes"
              onPointerDown={startResize}
            />
          ) : null}

          {(mode === 'split' || mode === 'preview') && (
            <div
              key={selectedPath}
              className="pane preview-pane"
              style={mode === 'split' ? { flexBasis: `${100 - draftSplit}%` } : undefined}
            >
              <div className="pane-label">
                <LayoutDashboard size={14} />
                <span>Preview</span>
              </div>
              {previewUrl ? <iframe title="HTML preview" src={previewUrl} sandbox="allow-scripts allow-forms" /> : null}
            </div>
          )}
        </section>
      )}

      <footer className="status-bar">
        <span>{status}</span>
        <span>{dirty ? 'Unsaved changes' : 'Clean'}</span>
      </footer>
    </main>
  )
}

function ModeButton({
  mode,
  activeMode,
  icon,
  onModeChange,
}: {
  mode: WorkspaceMode
  activeMode: WorkspaceMode
  icon: ReactNode
  onModeChange: (mode: WorkspaceMode) => void
}) {
  return (
    <button type="button" className={activeMode === mode ? 'active' : ''} onClick={() => onModeChange(mode)}>
      {icon}
      <span>{mode}</span>
    </button>
  )
}

function PropertiesBar({
  file,
  onTagClick,
  onSaveMetadata,
}: {
  file: VaultFile
  onTagClick: (tag: string) => void
  onSaveMetadata: (updates: { description?: string; tags?: string[] }) => void
}) {
  const description = file.metadata.description?.trim() ?? ''
  const tags = file.metadata.tags?.filter((tag) => tag.trim().length > 0) ?? []
  const [editing, setEditing] = useState(false)
  const [draftDescription, setDraftDescription] = useState(description)
  const [draftTags, setDraftTags] = useState(tags.join(', '))

  useEffect(() => {
    setDraftDescription(description)
    setDraftTags(tags.join(', '))
    setEditing(false)
  }, [file.relativePath])

  if (!editing && !description && tags.length === 0) {
    return (
      <div className="properties-bar properties-bar-empty">
        <button
          type="button"
          className="properties-edit-trigger"
          onClick={() => setEditing(true)}
        >
          Add description or tags
        </button>
      </div>
    )
  }

  if (editing) {
    return (
      <form
        className="properties-bar properties-bar-editing"
        onSubmit={(event) => {
          event.preventDefault()
          const nextTags = draftTags
            .split(',')
            .map((t) => t.trim())
            .filter((t) => t.length > 0)
          onSaveMetadata({
            description: draftDescription.trim(),
            tags: nextTags,
          })
          setEditing(false)
        }}
      >
        <input
          className="properties-tags-input"
          placeholder="tags, comma-separated"
          value={draftTags}
          onChange={(event) => setDraftTags(event.target.value)}
        />
        <input
          className="properties-description-input"
          placeholder="Description"
          value={draftDescription}
          onChange={(event) => setDraftDescription(event.target.value)}
        />
        <button type="submit" className="properties-save">
          Save
        </button>
        <button
          type="button"
          className="properties-cancel"
          onClick={() => {
            setDraftDescription(description)
            setDraftTags(tags.join(', '))
            setEditing(false)
          }}
        >
          Cancel
        </button>
      </form>
    )
  }

  return (
    <div className="properties-bar">
      {tags.length ? (
        <div className="properties-tags">
          {tags.map((tag) => (
            <button
              key={tag}
              type="button"
              className="properties-tag"
              title={`Filter by tag: ${tag}`}
              onClick={() => onTagClick(tag)}
            >
              {tag}
            </button>
          ))}
        </div>
      ) : null}
      {description ? <p className="properties-description">{description}</p> : null}
      <button
        type="button"
        className="properties-edit-trigger"
        title="Edit metadata"
        onClick={() => setEditing(true)}
      >
        Edit
      </button>
    </div>
  )
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}
