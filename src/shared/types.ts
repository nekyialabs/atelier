export type LinkKind = 'html' | 'asset' | 'external' | 'anchor' | 'missing'

export type WorkspaceMode = 'preview' | 'split' | 'source' | 'graph' | 'reading'

export type InspectorTab = 'info' | 'links' | 'agent'

export type Theme = 'dark' | 'light'

export interface VaultFile {
  relativePath: string
  title: string
  headings: string[]
  metadata: {
    description?: string
    tags?: string[]
  }
  size: number
  modifiedAt: number
}

export interface VaultLink {
  from: string
  rawHref: string
  resolvedTarget?: string
  label?: string
  kind: LinkKind
  sourceTag: 'a' | 'img' | 'script' | 'link' | 'wikilink'
}

export interface GraphNode {
  id: string
  title: string
}

export interface GraphEdge {
  from: string
  to: string
}

export interface VaultIndex {
  rootPath: string
  vaultName: string
  files: VaultFile[]
  links: VaultLink[]
  backlinks: Record<string, VaultLink[]>
  graph: {
    nodes: GraphNode[]
    edges: GraphEdge[]
  }
  generatedAt: number
}

export interface ActiveVaultState {
  index: VaultIndex
  previewBaseUrl: string
}

export interface AppSettings {
  recentVaults: string[]
  lastVaultPath?: string
  workspaceMode: WorkspaceMode
  sourceSplit: number
  leftSidebarCollapsed: boolean
  inspectorCollapsed: boolean
  theme: Theme
}

export type AppSettingsUpdate = Partial<AppSettings>

export interface InitialAppState {
  settings: AppSettings
  activeVault?: ActiveVaultState
}

export interface OpenVaultResult {
  settings: AppSettings
  activeVault: ActiveVaultState
}

export interface SaveFileResult {
  index: VaultIndex
  file: VaultFile
}

export interface CreateHtmlResult {
  relativePath: string
  content: string
  index: VaultIndex
}

export interface MoveFileResult {
  fromPath: string
  toPath: string
  index: VaultIndex
}

export interface ImportFilesResult {
  importedPaths: string[]
  index: VaultIndex
}

export interface DeleteFileResult {
  removedPath: string
  index: VaultIndex
  permanentlyDeleted?: boolean
}

export interface DuplicateFileResult {
  sourcePath: string
  duplicatePath: string
  index: VaultIndex
}

export interface CreateFolderResult {
  folderPath: string
  index: VaultIndex
}

export interface UpdateMetadataResult {
  relativePath: string
  index: VaultIndex
}

export interface VaultContext {
  vaultPath: string
  file: VaultFile
  outgoingLinks: VaultLink[]
  backlinks: VaultLink[]
  missingLinks: VaultLink[]
  relatedFiles: VaultFile[]
  source?: string
  generatedAt: number
}

export interface CliResult<TPayload = unknown> {
  schemaVersion: 1
  command: string
  vaultPath: string
  generatedAt: number
  payload: TPayload
}

export interface AtelierApi {
  getInitialState: () => Promise<InitialAppState>
  openFolder: () => Promise<OpenVaultResult | null>
  openPath: (rootPath: string) => Promise<OpenVaultResult>
  createDemoCopy: () => Promise<OpenVaultResult>
  pickDirectory: (options?: { title?: string; defaultPath?: string }) => Promise<string | null>
  createVaultAt: (parentDir: string, vaultName: string) => Promise<OpenVaultResult>
  closeVault: () => Promise<void>
  getVaultConfig: () => Promise<{
    config: { vaultName?: string; defaultTemplate?: string; ignoredPaths?: string[] }
    templates: Array<{ name: string; format: 'html' | 'md' }>
  }>
  saveVaultConfig: (config: {
    vaultName?: string
    defaultTemplate?: string
    ignoredPaths?: string[]
  }) => Promise<VaultIndex>
  getSettings: () => Promise<AppSettings>
  updateSettings: (update: AppSettingsUpdate) => Promise<AppSettings>
  readFile: (relativePath: string) => Promise<string>
  saveFile: (relativePath: string, content: string) => Promise<SaveFileResult>
  createHtml: (title?: string) => Promise<CreateHtmlResult>
  createMarkdown: (title?: string) => Promise<CreateHtmlResult>
  createFolder: (folderPath: string) => Promise<CreateFolderResult>
  renameFile: (fromPath: string, newName: string) => Promise<MoveFileResult>
  moveFile: (fromPath: string, toPath: string) => Promise<MoveFileResult>
  duplicateFile: (relativePath: string) => Promise<DuplicateFileResult>
  deleteFile: (relativePath: string) => Promise<DeleteFileResult>
  updateMetadata: (
    relativePath: string,
    updates: { description?: string; tags?: string[] },
  ) => Promise<UpdateMetadataResult>
  revealInExplorer: (relativePath: string) => Promise<void>
  openInBrowser: (relativePath: string) => Promise<void>
  importFiles: (sourcePaths: string[], targetDirectory?: string) => Promise<ImportFilesResult>
  getDroppedFilePaths: (files: File[]) => string[]
  setPreviewContent: (relativePath: string, content: string) => Promise<string>
  getPreviewUrl: (relativePath: string) => Promise<string>
  openExternal: (href: string) => Promise<void>
  onIndexUpdated: (listener: (index: VaultIndex) => void) => () => void
}
