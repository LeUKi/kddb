import { memo } from 'react'
import { ItemIcon } from '../../src/ItemIcon'
import { BLOCK_PX, cardPx, CELL, GAP, PAD, SLOT_PX } from './camera'
import type { DigResult, Peek, PublicCard } from './types'
import { KIND_NAMES, money } from './types'

const ROWS = 'ABCDEFG'

export interface CardProps {
  card: PublicCard
  /** 镜头居中的那张：边框亮 */
  focused: boolean
  /** 能挖：挖卡那一级、居中、没挖完 */
  diggable: boolean
  /** 画格子细节（近处）；false 时只画缩略图 */
  detail: boolean
  myUid: number | null
  peeks: Peek[]
  pending: Record<string, true>
  fresh: Record<string, { mine: boolean; at: number; result?: DigResult }>
  /** 新长出来的：从珍珠那边长出来 */
  grown: boolean
  onDig: (cardId: number, index: number) => void
  onPick: (cardId: number) => void
}

/**
 * 一张卡：放在它的区块正中（区块中心在 x·400, y·400，376 见方）。点区块就是换到这张；
 * 能挖的那张只有格子能点。
 */
export const CardView = memo(function CardView({ card, focused, diggable, detail, myUid, peeks, pending, fresh, grown, onDig, onPick }: CardProps) {
  const px = cardPx(card.size)
  const blockStyle = {
    left: card.x * SLOT_PX - BLOCK_PX / 2,
    top: card.y * SLOT_PX - BLOCK_PX / 2,
    width: BLOCK_PX,
    height: BLOCK_PX,
  }
  const style = {
    width: px,
    height: px,
    padding: PAD,
    gridTemplateColumns: `repeat(${card.size}, ${CELL}px)`,
    gap: GAP,
  }
  const blockClass = `map-block${focused ? ' is-focused' : ''}${grown ? ' is-grown' : ''}${diggable ? '' : ' is-pickable'}`
  const className = `map-card${focused ? ' is-focused' : ''}${card.finished ? ' is-finished' : ''}${detail ? '' : ' is-thumb'}`
  const pick = diggable ? undefined : () => onPick(card.id)
  if (!detail)
    return <div className={blockClass} style={blockStyle} onClick={pick} role="button" aria-label={`第 ${card.id} 张卡${card.finished ? '，已挖完' : ''}`}>
      <div className={className} style={style}>
        {card.cells.map((cell, index) => <span key={index} className={`thumb-cell${cell ? ` kind-${cell.kind}` : ''}`} />)}
      </div>
    </div>
  const peekAt = new Map(peeks.filter(peek => peek.cardId === card.id).map(peek => [peek.index, peek]))
  return <div className={blockClass} style={blockStyle} onClick={pick} data-card={card.id}>
    <div className={className} style={style}>
    {card.cells.map((cell, index) => {
      const cellKey = `${card.id}:${index}`
      const name = `${ROWS[Math.floor(index / card.size)]}${(index % card.size) + 1}`
      const peek = peekAt.get(index)
      const flash = fresh[cellKey]
      const recent = flash && Date.now() - flash.at < 2400 ? flash : null
      if (cell) {
        const mine = cell.uid === myUid
        return <div key={index} className={`map-cell revealed kind-${cell.kind}${mine ? ' is-mine' : ''}${recent ? (recent.mine ? ' just-mine' : ' just-other') : ''}`} aria-label={`${name}：${KIND_NAMES[cell.kind]}，${cell.name} 挖的`}>
          <ItemIcon kind={cell.kind} size={26} />
          <span className="cell-who">{mine ? '我' : cell.name}</span>
          {recent?.mine && recent.result ? <span className={`cell-float${recent.result.amount < 0 ? ' is-bad' : ''}`}>{floatText(recent.result)}</span> : null}
        </div>
      }
      const busy = !!pending[cellKey]
      return <button
        key={index}
        type="button"
        className={`map-cell covered${peek ? ' has-peek' : ''}${busy ? ' is-digging' : ''}`}
        disabled={!diggable || busy}
        onClick={event => {
          event.stopPropagation()
          onDig(card.id, index)
        }}
        aria-label={`${name}${peek ? `，望远镜看到是${KIND_NAMES[peek.kind]}` : ''}，${diggable ? '点按挖开' : '放大以后才能挖'}`}
      >
        {peek ? <ItemIcon kind={peek.kind} size={22} className="peek-icon" /> : null}
        {busy ? <ItemIcon kind="pickaxe" size={24} className="digging-pick" /> : null}
      </button>
    })}
    </div>
  </div>
})

function floatText(result: DigResult) {
  if (result.amount > 0) return `+${money(result.amount)}`
  if (result.amount < 0) return money(result.amount)
  if (result.kind === 'totem') return '+3 次'
  if (result.kind === 'pearl') return '新卡！'
  if (result.kind === 'shield') return result.blocked ? '挡住了' : '盾牌'
  if (result.kind === 'tnt') return '挡住了'
  if (result.kind === 'spyglass') return '看到一格'
  return ''
}
