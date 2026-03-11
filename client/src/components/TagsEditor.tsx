import { useState } from 'react'

interface TagsEditorProps {
  tags: string[]
  onChange: (tags: string[]) => void
}

export default function TagsEditor({ tags, onChange }: TagsEditorProps) {
  const [input, setInput] = useState('')

  function commit(raw: string) {
    const tag = raw.trim().replace(/,$/, '')
    if (tag && !tags.includes(tag)) onChange([...tags, tag])
    setInput('')
  }

  function remove(tag: string) {
    onChange(tags.filter(t => t !== tag))
  }

  return (
    <div className="flex flex-wrap gap-1.5 items-center p-1.5 border border-border rounded-sm focus-within:border-accent transition-colors duration-standard min-h-[34px] bg-white">

      {tags.map(tag => (
        <span
          key={tag}
          className="inline-flex items-center gap-1 text-label font-medium bg-accent-light text-accent px-2 py-0.5 rounded-full"
        >
          {tag}
          <button
            type="button"
            onClick={() => remove(tag)}
            className="leading-none hover:text-accent-hover transition-colors duration-micro"
            aria-label={`Remove tag ${tag}`}
          >
            ×
          </button>
        </span>
      ))}

      <input
        value={input}
        onChange={e => setInput(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault()
            commit(input)
          }
          // Backspace on empty removes the last tag
          if (e.key === 'Backspace' && input === '' && tags.length > 0) {
            onChange(tags.slice(0, -1))
          }
        }}
        onBlur={() => { if (input.trim()) commit(input) }}
        placeholder={tags.length === 0 ? 'Add tags…' : ''}
        className="flex-1 min-w-[80px] text-body text-text-primary outline-none bg-transparent placeholder:text-text-placeholder"
      />
    </div>
  )
}
