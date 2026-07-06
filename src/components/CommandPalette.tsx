import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
  FileCode2,
  FileText,
  Search,
} from 'lucide-react'
import type { VaultIndex } from '../shared/types'
import { fuzzyScore } from '../lib/fuzzy'

export interface PaletteAction {
  id: string
  label: string
  hint?: string
  icon?: ReactNode
  run: () => void
  keywords?: string[]
}

interface FileItem {
  type: 'file'
  id: string
  relativePath: string
  title: string
  isMarkdown: boolean
}

interface ActionItem {
  type: 'action'
  id: string
  label: string
  hint?: string
  icon?: ReactNode
  run: () => void
  keywords?: string[]
}

type PaletteItem = FileItem | ActionItem

const MAX_RESULTS = 16

export function CommandPalette({
  index,
  actions,
  onSelectFile,
  onClose,
}: {
  index: VaultIndex
  actions: PaletteAction[]
  onSelectFile: (relativePath: string) => void
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const listRef = useRef<HTMLUListElement | null>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const results = useMemo(() => filterItems(query, index, actions), [query, index, actions])

  useEffect(() => {
    setActiveIndex(0)
  }, [query])

  useEffect(() => {
    const item = listRef.current?.children[activeIndex] as HTMLElement | undefined
    item?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex])

  const select = (item: PaletteItem) => {
    if (item.type === 'file') {
      onSelectFile(item.relativePath)
    } else {
      item.run()
    }
    onClose()
  }

  return (
    <div className="palette-backdrop" role="dialog" aria-modal="true" aria-label="Command palette">
      <div className="palette">
        <div className="palette-input-row">
          <Search size={16} />
          <input
            ref={inputRef}
            value={query}
            placeholder="Jump to file, run command…"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault()
                onClose()
                return
              }

              if (event.key === 'ArrowDown') {
                event.preventDefault()
                setActiveIndex((current) => Math.min(results.length - 1, current + 1))
                return
              }

              if (event.key === 'ArrowUp') {
                event.preventDefault()
                setActiveIndex((current) => Math.max(0, current - 1))
                return
              }

              if (event.key === 'Enter') {
                event.preventDefault()
                const item = results[activeIndex]
                if (item) {
                  select(item)
                }
              }
            }}
          />
          <kbd className="palette-hint">esc</kbd>
        </div>

        {results.length === 0 ? (
          <div className="palette-empty">No matches.</div>
        ) : (
          <ul className="palette-results" ref={listRef}>
            {results.map((item, listIndex) => (
              <li
                key={item.id}
                role="option"
                aria-selected={listIndex === activeIndex}
                className={`palette-result ${listIndex === activeIndex ? 'active' : ''}`}
                onMouseEnter={() => setActiveIndex(listIndex)}
                onClick={() => select(item)}
              >
                <span className="palette-result-icon">{renderIcon(item)}</span>
                <span className="palette-result-label">{renderLabel(item)}</span>
                <span className="palette-result-hint">{renderHint(item)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function renderIcon(item: PaletteItem): ReactNode {
  if (item.type === 'file') {
    return item.isMarkdown ? <FileText size={14} /> : <FileCode2 size={14} />
  }
  return item.icon ?? <Search size={14} />
}

function renderLabel(item: PaletteItem): ReactNode {
  if (item.type === 'file') {
    return item.title
  }
  return item.label
}

function renderHint(item: PaletteItem): ReactNode {
  if (item.type === 'file') {
    return item.relativePath
  }
  return item.hint ?? 'Action'
}

function filterItems(query: string, index: VaultIndex, actions: PaletteAction[]): PaletteItem[] {
  const trimmed = query.trim().toLowerCase()
  const fileItems: FileItem[] = index.files.map((file) => ({
    type: 'file',
    id: `file:${file.relativePath}`,
    relativePath: file.relativePath,
    title: file.title,
    isMarkdown: /\.(md|markdown)$/i.test(file.relativePath),
  }))
  const actionItems: ActionItem[] = actions.map((action) => ({
    type: 'action',
    id: `action:${action.id}`,
    label: action.label,
    ...(action.hint !== undefined ? { hint: action.hint } : {}),
    ...(action.icon !== undefined ? { icon: action.icon } : {}),
    run: action.run,
    ...(action.keywords !== undefined ? { keywords: action.keywords } : {}),
  }))

  const all: PaletteItem[] = [...actionItems, ...fileItems]

  if (!trimmed) {
    return all.slice(0, MAX_RESULTS)
  }

  const scored = all
    .map((item) => ({ item, score: scoreItem(item, trimmed) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_RESULTS)

  return scored.map((entry) => entry.item)
}

function scoreItem(item: PaletteItem, query: string): number {
  const haystacks: string[] = []
  if (item.type === 'file') {
    haystacks.push(item.title.toLowerCase(), item.relativePath.toLowerCase())
  } else {
    haystacks.push(item.label.toLowerCase())
    if (item.hint) haystacks.push(item.hint.toLowerCase())
    if (item.keywords) haystacks.push(...item.keywords.map((k) => k.toLowerCase()))
  }

  let best = 0
  for (const hay of haystacks) {
    best = Math.max(best, fuzzyScore(hay, query))
  }

  return best
}
