import { useEffect, useRef, useState } from 'react'
import type { DragEvent as ReactDragEvent, MouseEvent as ReactMouseEvent } from 'react'
import {
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Copy,
  ExternalLink,
  FileCode2,
  FileText,
  FolderOpen,
  FolderPlus,
  Pencil,
  Search,
  Trash2,
} from 'lucide-react'
import { BrandMark } from './BrandMark'
import { ContextMenu, type ContextMenuItem } from './ContextMenu'
import type { VaultFile, VaultIndex } from '../shared/types'

const VAULT_DRAG_MIME = 'application/x-atelier-file'
const MARKDOWN_EXTENSIONS = new Set(['.md', '.markdown'])

interface TreeNode {
  name: string
  path: string
  children: TreeNode[]
  file?: VaultFile
}

interface ContextMenuState {
  x: number
  y: number
  items: ContextMenuItem[]
}

function basename(relativePath: string): string {
  const parts = relativePath.split('/')
  return parts[parts.length - 1] || relativePath
}

function joinFolder(folder: string, name: string): string {
  return folder ? `${folder}/${name}` : name
}

function isMarkdown(name: string): boolean {
  const lower = name.toLowerCase()
  for (const ext of MARKDOWN_EXTENSIONS) {
    if (lower.endsWith(ext)) {
      return true
    }
  }
  return false
}

export function VaultSidebar({
  index,
  selectedPath,
  query,
  collapsed,
  onQueryChange,
  onSelect,
  onOpenFolder,
  onCreateArtifact,
  onCreateMarkdown,
  onCreateFolder,
  onMoveFile,
  onImportFiles,
  onRenameFile,
  onDuplicateFile,
  onDeleteFile,
  onRevealInExplorer,
  onOpenInBrowser,
}: {
  index: VaultIndex
  selectedPath: string
  query: string
  collapsed: boolean
  onQueryChange: (query: string) => void
  onSelect: (path: string) => void
  onOpenFolder: () => void
  onCreateArtifact: () => void
  onCreateMarkdown: () => void
  onCreateFolder: (parentFolder?: string) => void
  onMoveFile: (fromPath: string, toPath: string) => void
  onImportFiles: (sourcePaths: string[], targetDirectory?: string) => void
  onRenameFile: (fromPath: string, newName: string) => void
  onDuplicateFile: (relativePath: string) => void
  onDeleteFile: (relativePath: string) => void
  onRevealInExplorer: (relativePath: string) => void
  onOpenInBrowser: (relativePath: string) => void
}) {
  const filteredFiles = filterFiles(index.files, query)
  const tree = buildTree(filteredFiles)
  const [hoveredFolder, setHoveredFolder] = useState<string | null>(null)
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [renamingPath, setRenamingPath] = useState<string | null>(null)
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(() => new Set())

  const toggleFolder = (folderPath: string) => {
    setCollapsedFolders((prev) => {
      const next = new Set(prev)
      if (next.has(folderPath)) {
        next.delete(folderPath)
      } else {
        next.add(folderPath)
      }
      return next
    })
  }

  const expandAll = () => {
    setCollapsedFolders(new Set())
  }

  const collapseAll = () => {
    const allFolders = collectAllFolderPaths(tree)
    setCollapsedFolders(allFolders)
  }

  // When a search query is active, force-expand everything so matches are visible.
  const isSearchActive = query.trim().length > 0
  const effectiveCollapsed = isSearchActive ? new Set<string>() : collapsedFolders

  const closeContextMenu = () => setContextMenu(null)

  const buildFileMenu = (file: VaultFile): ContextMenuItem[] => [
    {
      key: 'open-in-browser',
      label: 'Open in browser',
      icon: <ExternalLink size={14} />,
      onSelect: () => onOpenInBrowser(file.relativePath),
    },
    {
      key: 'reveal',
      label: 'Reveal in file manager',
      icon: <FolderOpen size={14} />,
      onSelect: () => onRevealInExplorer(file.relativePath),
    },
    {
      key: 'rename',
      label: 'Rename',
      icon: <Pencil size={14} />,
      separatorBefore: true,
      onSelect: () => setRenamingPath(file.relativePath),
    },
    {
      key: 'duplicate',
      label: 'Duplicate',
      icon: <Copy size={14} />,
      onSelect: () => onDuplicateFile(file.relativePath),
    },
    {
      key: 'delete',
      label: 'Move to trash',
      icon: <Trash2 size={14} />,
      destructive: true,
      separatorBefore: true,
      onSelect: () => onDeleteFile(file.relativePath),
    },
  ]

  const buildFolderMenu = (folderPath: string): ContextMenuItem[] => [
    {
      key: 'new-html-here',
      label: 'New HTML here',
      icon: <FileCode2 size={14} />,
      onSelect: onCreateArtifact,
    },
    {
      key: 'new-md-here',
      label: 'New Markdown here',
      icon: <FileText size={14} />,
      onSelect: onCreateMarkdown,
    },
    {
      key: 'new-folder',
      label: 'New Folder',
      icon: <FolderPlus size={14} />,
      onSelect: () => onCreateFolder(folderPath),
    },
    {
      key: 'reveal-folder',
      label: 'Reveal in file manager',
      icon: <FolderOpen size={14} />,
      separatorBefore: true,
      onSelect: () => onRevealInExplorer(folderPath),
    },
  ]

  const buildRootMenu = (): ContextMenuItem[] => [
    {
      key: 'new-html-root',
      label: 'New HTML',
      icon: <FileCode2 size={14} />,
      onSelect: onCreateArtifact,
    },
    {
      key: 'new-md-root',
      label: 'New Markdown',
      icon: <FileText size={14} />,
      onSelect: onCreateMarkdown,
    },
    {
      key: 'new-folder-root',
      label: 'New Folder',
      icon: <FolderPlus size={14} />,
      onSelect: () => onCreateFolder(),
    },
  ]

  const onTreeContext = (event: ReactMouseEvent<HTMLElement>) => {
    event.preventDefault()
    setContextMenu({ x: event.clientX, y: event.clientY, items: buildRootMenu() })
  }

  if (collapsed) {
    return (
      <aside className="sidebar left-sidebar collapsed-sidebar">
        <div className="brand-rail-mark" aria-hidden="true">
          <BrandMark size={18} />
        </div>
        <button type="button" className="rail-button" title="Open folder" onClick={onOpenFolder}>
          <FolderOpen size={18} />
        </button>
        <button type="button" className="rail-button" title="New HTML" onClick={onCreateArtifact}>
          <FileCode2 size={18} />
        </button>
        <button type="button" className="rail-button" title="New Markdown" onClick={onCreateMarkdown}>
          <FileText size={18} />
        </button>
      </aside>
    )
  }

  return (
    <aside className="sidebar left-sidebar">
      <header className="brand">
        <div className="brand-mark">
          <BrandMark size={18} />
        </div>
        <div>
          <h1>{index.vaultName}</h1>
        </div>
      </header>

      <div className="sidebar-toolbar">
        <label className="search-box">
          <Search size={14} />
          <input value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="Search" />
        </label>
        <button type="button" className="icon-button" title="New HTML (Ctrl+N)" onClick={onCreateArtifact}>
          <FileCode2 size={16} />
        </button>
        <button type="button" className="icon-button" title="New Markdown (Ctrl+Shift+N)" onClick={onCreateMarkdown}>
          <FileText size={16} />
        </button>
        <button type="button" className="icon-button" title="New Folder" onClick={() => onCreateFolder()}>
          <FolderPlus size={16} />
        </button>
        <button type="button" className="icon-button" title="Open folder" onClick={onOpenFolder}>
          <FolderOpen size={16} />
        </button>
      </div>

      <div className="tree-toolbar">
        <button type="button" className="icon-button" title="Expand all folders" onClick={expandAll}>
          <ChevronsUpDown size={14} />
        </button>
        <button type="button" className="icon-button" title="Collapse all folders" onClick={collapseAll}>
          <ChevronsDownUp size={14} />
        </button>
      </div>

      <nav className="file-tree" onContextMenu={onTreeContext}>
        {tree.map((node) => (
          <TreeBranch
            key={node.path}
            node={node}
            selectedPath={selectedPath}
            hoveredFolder={hoveredFolder}
            renamingPath={renamingPath}
            collapsedFolders={effectiveCollapsed}
            onToggleFolder={toggleFolder}
            onSelect={onSelect}
            onMoveFile={onMoveFile}
            onImportFiles={onImportFiles}
            onHoverFolder={setHoveredFolder}
            onCommitRename={(fromPath, newName) => {
              setRenamingPath(null)
              if (newName && newName !== basename(fromPath)) {
                onRenameFile(fromPath, newName)
              }
            }}
            onCancelRename={() => setRenamingPath(null)}
            onContextFile={(event, file) => {
              event.preventDefault()
              event.stopPropagation()
              setContextMenu({ x: event.clientX, y: event.clientY, items: buildFileMenu(file) })
            }}
            onContextFolder={(event, folderPath) => {
              event.preventDefault()
              event.stopPropagation()
              setContextMenu({ x: event.clientX, y: event.clientY, items: buildFolderMenu(folderPath) })
            }}
          />
        ))}
      </nav>

      {contextMenu ? (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextMenu.items}
          onClose={closeContextMenu}
        />
      ) : null}
    </aside>
  )
}

function TreeBranch({
  node,
  selectedPath,
  hoveredFolder,
  renamingPath,
  collapsedFolders,
  onToggleFolder,
  onSelect,
  onMoveFile,
  onImportFiles,
  onHoverFolder,
  onCommitRename,
  onCancelRename,
  onContextFile,
  onContextFolder,
  depth = 0,
}: {
  node: TreeNode
  selectedPath: string
  hoveredFolder: string | null
  renamingPath: string | null
  collapsedFolders: Set<string>
  onToggleFolder: (folderPath: string) => void
  onSelect: (path: string) => void
  onMoveFile: (fromPath: string, toPath: string) => void
  onImportFiles: (sourcePaths: string[], targetDirectory?: string) => void
  onHoverFolder: (folder: string | null) => void
  onCommitRename: (fromPath: string, newName: string) => void
  onCancelRename: () => void
  onContextFile: (event: ReactMouseEvent<HTMLElement>, file: VaultFile) => void
  onContextFolder: (event: ReactMouseEvent<HTMLElement>, folderPath: string) => void
  depth?: number
}) {
  if (node.file) {
    const filePath = node.file.relativePath
    const isRenaming = renamingPath === filePath
    const Icon = isMarkdown(node.name) ? FileText : FileCode2

    if (isRenaming) {
      return (
        <RenameInput
          initial={node.name}
          depth={depth}
          onCommit={(value) => onCommitRename(filePath, value)}
          onCancel={onCancelRename}
        />
      )
    }

    return (
      <button
        type="button"
        className={`tree-file ${selectedPath === filePath ? 'selected' : ''}`}
        style={{ paddingLeft: `${depth * 14 + 12}px` }}
        draggable
        onClick={() => onSelect(filePath)}
        onContextMenu={(event) => onContextFile(event, node.file!)}
        onDragStart={(event) => {
          event.dataTransfer.setData(VAULT_DRAG_MIME, filePath)
          event.dataTransfer.setData('text/plain', filePath)
          event.dataTransfer.effectAllowed = 'move'
        }}
      >
        <Icon size={14} />
        <span>{node.name}</span>
      </button>
    )
  }

  const folderPath = node.path
  const isHovered = hoveredFolder === folderPath
  const isCollapsed = collapsedFolders.has(folderPath)

  const onDragEnter = (event: ReactDragEvent<HTMLDivElement>) => {
    if (!hasMoveOrFiles(event)) {
      return
    }

    event.preventDefault()
    event.stopPropagation()
    onHoverFolder(folderPath)
  }

  const onDragOver = (event: ReactDragEvent<HTMLDivElement>) => {
    if (!hasMoveOrFiles(event)) {
      return
    }

    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = hasIntraVaultDrag(event) ? 'move' : 'copy'
    if (hoveredFolder !== folderPath) {
      onHoverFolder(folderPath)
    }
  }

  const onDragLeave = (event: ReactDragEvent<HTMLDivElement>) => {
    const next = event.relatedTarget as Node | null
    if (next && event.currentTarget.contains(next)) {
      return
    }
    if (hoveredFolder === folderPath) {
      onHoverFolder(null)
    }
  }

  const onDrop = (event: ReactDragEvent<HTMLDivElement>) => {
    if (!hasMoveOrFiles(event)) {
      return
    }

    event.preventDefault()
    event.stopPropagation()
    onHoverFolder(null)

    const moveSource = event.dataTransfer.getData(VAULT_DRAG_MIME)
    if (moveSource) {
      const target = joinFolder(folderPath, basename(moveSource))
      if (target !== moveSource) {
        onMoveFile(moveSource, target)
      }
      return
    }

    const files = Array.from(event.dataTransfer.files)
    if (files.length) {
      const paths = window.atelier.getDroppedFilePaths(files)
      if (paths.length) {
        onImportFiles(paths, folderPath)
      }
    }
  }

  return (
    <div
      className={`tree-folder ${isHovered ? 'drop-target' : ''}`}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <button
        type="button"
        className={`tree-folder-label ${isCollapsed ? 'collapsed' : 'expanded'}`}
        style={{ paddingLeft: `${depth * 14 + 10}px` }}
        onClick={() => onToggleFolder(folderPath)}
        onContextMenu={(event) => onContextFolder(event, folderPath)}
        aria-expanded={!isCollapsed}
      >
        <ChevronRight size={13} className="folder-chevron" />
        <span>{node.name}</span>
      </button>
      {!isCollapsed
        ? node.children.map((child) => (
            <TreeBranch
              key={child.path}
              node={child}
              selectedPath={selectedPath}
              hoveredFolder={hoveredFolder}
              renamingPath={renamingPath}
              collapsedFolders={collapsedFolders}
              onToggleFolder={onToggleFolder}
              onSelect={onSelect}
              onMoveFile={onMoveFile}
              onImportFiles={onImportFiles}
              onHoverFolder={onHoverFolder}
              onCommitRename={onCommitRename}
              onCancelRename={onCancelRename}
              onContextFile={onContextFile}
              onContextFolder={onContextFolder}
              depth={depth + 1}
            />
          ))
        : null}
    </div>
  )
}

function RenameInput({
  initial,
  depth,
  onCommit,
  onCancel,
}: {
  initial: string
  depth: number
  onCommit: (value: string) => void
  onCancel: () => void
}) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [value, setValue] = useState(initial)

  useEffect(() => {
    if (!inputRef.current) {
      return
    }

    inputRef.current.focus()
    const dotIndex = initial.lastIndexOf('.')
    if (dotIndex > 0) {
      inputRef.current.setSelectionRange(0, dotIndex)
    } else {
      inputRef.current.select()
    }
  }, [initial])

  return (
    <div className="tree-file rename-row" style={{ paddingLeft: `${depth * 14 + 12}px` }}>
      <FileCode2 size={14} />
      <input
        ref={inputRef}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onBlur={() => onCommit(value.trim())}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            onCommit(value.trim())
          } else if (event.key === 'Escape') {
            event.preventDefault()
            onCancel()
          }
        }}
      />
    </div>
  )
}

function hasIntraVaultDrag(event: ReactDragEvent<HTMLElement>): boolean {
  const types = event.dataTransfer.types
  return typeof types.includes === 'function'
    ? types.includes(VAULT_DRAG_MIME)
    : Array.from(types).includes(VAULT_DRAG_MIME)
}

function hasMoveOrFiles(event: ReactDragEvent<HTMLElement>): boolean {
  const types = event.dataTransfer.types
  const includes = (value: string) =>
    typeof types.includes === 'function' ? types.includes(value) : Array.from(types).includes(value)
  return includes(VAULT_DRAG_MIME) || includes('Files')
}

function filterFiles(files: VaultFile[], query: string): VaultFile[] {
  const trimmed = query.trim()

  if (!trimmed) {
    return files
  }

  const tagMatch = trimmed.match(/^tag:(.+)$/i)
  if (tagMatch) {
    const tagQuery = tagMatch[1].trim().toLowerCase()
    if (!tagQuery) {
      return files
    }
    return files.filter((file) =>
      file.metadata.tags?.some((tag) => tag.toLowerCase().includes(tagQuery)),
    )
  }

  const normalizedQuery = trimmed.toLowerCase()
  return files.filter(
    (file) =>
      file.relativePath.toLowerCase().includes(normalizedQuery) ||
      file.title.toLowerCase().includes(normalizedQuery),
  )
}

function buildTree(files: VaultFile[]): TreeNode[] {
  const root: TreeNode = { name: 'root', path: '', children: [] }

  for (const file of files) {
    const parts = file.relativePath.split('/')
    let current = root

    parts.forEach((part, indexOfPart) => {
      const path = parts.slice(0, indexOfPart + 1).join('/')
      const existing = current.children.find((child) => child.name === part)

      if (existing) {
        current = existing
        return
      }

      const node: TreeNode = {
        name: part,
        path,
        children: [],
        file: indexOfPart === parts.length - 1 ? file : undefined,
      }
      current.children.push(node)
      current = node
    })
  }

  sortTree(root.children)
  return root.children
}

function collectAllFolderPaths(nodes: TreeNode[]): Set<string> {
  const paths = new Set<string>()
  const visit = (node: TreeNode) => {
    if (!node.file) {
      paths.add(node.path)
      for (const child of node.children) {
        visit(child)
      }
    }
  }
  for (const node of nodes) {
    visit(node)
  }
  return paths
}

function sortTree(nodes: TreeNode[]): void {
  nodes.sort((a, b) => {
    if (Boolean(a.file) !== Boolean(b.file)) {
      return a.file ? 1 : -1
    }

    return a.name.localeCompare(b.name)
  })

  for (const node of nodes) {
    sortTree(node.children)
  }
}
