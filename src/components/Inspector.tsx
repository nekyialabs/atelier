import { useState } from 'react'
import type { ReactNode } from 'react'
import { CircleAlert, FileText, Link2 } from 'lucide-react'
import { PromptPanel } from './PromptPanel'
import type { InspectorTab, VaultFile, VaultIndex, VaultLink } from '../shared/types'

export function Inspector({
  index,
  selectedFile,
  selectedPath,
  outgoingLinks,
  backlinks,
  missingLinks,
  collapsed,
  onSelect,
  onCopyPrompt,
  onScrollToHeading,
}: {
  index: VaultIndex
  selectedFile?: VaultFile
  selectedPath: string
  outgoingLinks: VaultLink[]
  backlinks: VaultLink[]
  missingLinks: VaultLink[]
  collapsed: boolean
  onSelect: (path: string) => void
  onCopyPrompt: (kind: 'create' | 'revise') => void
  onScrollToHeading: (index: number) => void
}) {
  const [tab, setTab] = useState<InspectorTab>('info')

  if (collapsed) {
    return null
  }

  return (
    <aside className="sidebar right-sidebar">
      <div className="inspector-tabs" role="tablist" aria-label="Inspector tabs">
        <TabButton tab="info" activeTab={tab} onChange={setTab} />
        <TabButton tab="links" activeTab={tab} onChange={setTab} />
        <TabButton tab="agent" activeTab={tab} onChange={setTab} />
      </div>

      {tab === 'info' ? (
        <div className="inspector-body">
          <InfoSection title="Metadata">
            <dl className="metadata-grid">
              <div>
                <dt>Files</dt>
                <dd>{index.files.length}</dd>
              </div>
              <div>
                <dt>Links</dt>
                <dd>{index.links.length}</dd>
              </div>
              <div>
                <dt>Size</dt>
                <dd>{selectedFile ? formatBytes(selectedFile.size) : '-'}</dd>
              </div>
              <div>
                <dt>Modified</dt>
                <dd>{selectedFile ? formatDate(selectedFile.modifiedAt) : '-'}</dd>
              </div>
            </dl>
            {selectedFile?.metadata.description ? <p className="description">{selectedFile.metadata.description}</p> : null}
          </InfoSection>
          <InfoSection title="Headings">
            <CompactList
              items={selectedFile?.headings ?? []}
              empty="No headings"
              onSelectIndex={onScrollToHeading}
            />
          </InfoSection>
        </div>
      ) : null}

      {tab === 'links' ? (
        <div className="inspector-body">
          <InfoSection title="Outgoing">
            <LinkList links={outgoingLinks} onSelect={onSelect} />
          </InfoSection>
          <InfoSection title="Backlinks">
            <LinkList links={backlinks} onSelect={onSelect} backlink />
          </InfoSection>
          <InfoSection title="Missing">
            {missingLinks.length ? <LinkList links={missingLinks} onSelect={onSelect} /> : <p className="empty-state">None</p>}
          </InfoSection>
        </div>
      ) : null}

      {tab === 'agent' ? (
        <div className="inspector-body">
          <InfoSection title="Agent Context">
            <PromptPanel selectedPath={selectedPath} onCopyPrompt={onCopyPrompt} />
          </InfoSection>
          <InfoSection title="CLI">
            <div className="cli-snippets">
              <code>atelier context "{index.rootPath}" --file "{selectedPath || 'index.html'}"</code>
              <code>atelier link-check "{index.rootPath}"</code>
            </div>
          </InfoSection>
        </div>
      ) : null}
    </aside>
  )
}

function TabButton({
  tab,
  activeTab,
  onChange,
}: {
  tab: InspectorTab
  activeTab: InspectorTab
  onChange: (tab: InspectorTab) => void
}) {
  return (
    <button type="button" className={activeTab === tab ? 'active' : ''} onClick={() => onChange(tab)}>
      {tab}
    </button>
  )
}

function InfoSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="info-section">
      <h3>{title}</h3>
      {children}
    </section>
  )
}

function CompactList({
  items,
  empty,
  onSelectIndex,
}: {
  items: string[]
  empty: string
  onSelectIndex?: (index: number) => void
}) {
  if (!items.length) {
    return <p className="empty-state">{empty}</p>
  }

  return (
    <ul className="compact-list">
      {items.slice(0, 10).map((item, index) =>
        onSelectIndex ? (
          // key includes the index because heading text can repeat within a
          // document; the index is also the position passed to the preview so
          // it scrolls to the matching heading in document order.
          <li key={`${index}-${item}`}>
            <button type="button" onClick={() => onSelectIndex(index)}>
              <FileText size={13} />
              <span>{item}</span>
            </button>
          </li>
        ) : (
          <li key={`${index}-${item}`}>
            <FileText size={13} />
            <span>{item}</span>
          </li>
        ),
      )}
    </ul>
  )
}

function LinkList({
  links,
  onSelect,
  backlink = false,
}: {
  links: VaultLink[]
  onSelect: (path: string) => void
  backlink?: boolean
}) {
  if (!links.length) {
    return <p className="empty-state">None</p>
  }

  return (
    <ul className="link-list">
      {links.map((link) => {
        const path = backlink ? link.from : link.resolvedTarget
        const clickable = Boolean(path && link.kind === 'html')

        return (
          <li key={`${link.from}-${link.rawHref}-${link.sourceTag}`}>
            <button type="button" disabled={!clickable} onClick={() => path && onSelect(path)}>
              {link.kind === 'missing' ? <CircleAlert size={14} /> : <Link2 size={14} />}
              <span>{backlink ? link.from : link.rawHref}</span>
              <small>{link.kind}</small>
            </button>
          </li>
        )
      })}
    </ul>
  )
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`
  }

  return `${(bytes / 1024).toFixed(1)} KB`
}

function formatDate(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(timestamp)
}
