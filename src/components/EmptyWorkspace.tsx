import { FileCode2, FileText, FolderPlus, Sparkles } from 'lucide-react'
import { BrandMark } from './BrandMark'

export function EmptyWorkspace({
  vaultName,
  onCreateHtml,
  onCreateMarkdown,
  onCreateFolder,
}: {
  vaultName: string
  onCreateHtml: () => void
  onCreateMarkdown: () => void
  onCreateFolder: () => void
}) {
  return (
    <section className="empty-workspace">
      <div className="empty-workspace-inner">
        <div className="empty-workspace-mark" aria-hidden="true">
          <BrandMark size={22} />
        </div>
        <p className="eyebrow">{vaultName}</p>
        <h2>Pick a file from the sidebar, or start something new.</h2>
        <p className="empty-hint">
          Drop HTML or Markdown files in to import. Click a folder to drop into a specific spot. Right-click anything for the rest.
        </p>
        <div className="empty-actions">
          <button type="button" onClick={onCreateHtml}>
            <FileCode2 size={18} />
            <span>New HTML</span>
            <small>Cmd / Ctrl + N</small>
          </button>
          <button type="button" onClick={onCreateMarkdown}>
            <FileText size={18} />
            <span>New Markdown</span>
            <small>Cmd / Ctrl + Shift + N</small>
          </button>
          <button type="button" onClick={onCreateFolder}>
            <FolderPlus size={18} />
            <span>New Folder</span>
          </button>
        </div>
        <p className="empty-footnote">
          <Sparkles size={13} />
          <span>Markdown files render as a clean reader. Use [[wikilinks]] to point between notes.</span>
        </p>
      </div>
    </section>
  )
}
