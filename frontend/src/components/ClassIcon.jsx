import { BookOpen, Check, Star, ThumbsUp } from 'lucide-react'
import { CLASSES } from '../lib/review'

const ICONS = { star: Star, thumb: ThumbsUp, check: Check, book: BookOpen }

/** Round classification badge: "!!", "?", a star, a book… */
export default function ClassIcon({ cls, size = 18, className = '', title }) {
  const meta = CLASSES[cls]
  if (!meta) return null
  const Icon = meta.icon ? ICONS[meta.icon] : null
  return (
    <span
      className={`class-icon ${className}`}
      style={{ '--cls': meta.color, width: size, height: size, fontSize: size * 0.5 }}
      title={title ?? meta.label}
      aria-label={meta.label}
      role="img"
    >
      {Icon ? <Icon size={size * 0.6} strokeWidth={3} fill={meta.icon === 'star' ? 'currentColor' : 'none'} /> : meta.glyph}
    </span>
  )
}
