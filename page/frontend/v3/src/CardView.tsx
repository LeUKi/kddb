import { memo, useLayoutEffect, useRef } from 'react'
import { ItemIcon } from '../../src/ItemIcon'
import type { CSSProperties } from 'react'
import type { Direction } from './camera'
import { BLOCK_PX, CARD_PX, cellPx, entranceWave, GAP, PAD, SLOT_PX } from './camera'
import { drawThumb, THUMB_PX, whenImages } from './thumb'
import type { DigResult, Peek, PublicCard } from './types'
import { KIND_NAMES, money } from './types'

const ROWS = 'ABCDEFG'

export interface Entrance { land: number; edge: Direction }

export interface CardProps {
  card: PublicCard
  /** 镜头居中的那张：边框亮 */
  focused: boolean
  /** 能挖：挖卡那一级、居中、没挖完 */
  diggable: boolean
  /** 画格子细节（近处）；false 时只画缩略图 */
  detail: boolean
  /** 显示谁挖的：只有当前卡、挖卡那一级（名字带着图标一起淡入淡出） */
  names: boolean
  myUid: number | null
  /** 下面三样只给这张卡自己的（没有就是同一个空的），别的卡有变化时这张不用重画 */
  peeks: Peek[]
  pending: Record<string, true>
  fresh: Record<string, { mine: boolean; at: number; result?: DigResult }>
  /** 是当前卡：画名字（names 为 false 时藏着，好淡出） */
  current: boolean
  /** 新长出来的：落地（land 毫秒）后从朝着旧卡的那条边一波一波翻出来 */
  entrance: Entrance | null
  onDig: (cardId: number, index: number) => void
  onPick: (cardId: number) => void
}

/**
 * 一张卡：外框都一样大，放在它的区块正中（区块中心在 x·408, y·408，392 见方）。点区块就是换到这张；
 * 能挖的那张只有格子能点。
 */
export const CardView = memo(function CardView({ card, focused, diggable, detail, names, current, myUid, peeks, pending, fresh, entrance, onDig, onPick }: CardProps) {
  const side = cellPx(card.size)
  const blockStyle = {
    left: card.x * SLOT_PX - BLOCK_PX / 2,
    top: card.y * SLOT_PX - BLOCK_PX / 2,
    width: BLOCK_PX,
    height: BLOCK_PX,
    ...(entrance ? { '--land': `${entrance.land}ms` } : null),
  } as CSSProperties
  const wave = (index: number) => entrance ? { '--wave': `${entranceWave(card.size, index, entrance.edge)}ms` } as CSSProperties : undefined
  const style = {
    width: CARD_PX,
    height: CARD_PX,
    padding: PAD,
    gridTemplateColumns: `repeat(${card.size}, ${side}px)`,
    gridTemplateRows: `repeat(${card.size}, ${side}px)`,
    gap: GAP,
  }
  const icon = Math.round(side * 0.6)
  const end = card.kind === 'end'
  const hasEye = !end && (card.left.eye ?? 0) > 0
  const blockClass = `map-block${focused ? ' is-focused' : ''}${entrance ? ' is-grown' : ''}${end ? ' is-end' : ''}${hasEye ? ' has-eye' : ''}${card.finished ? ' is-done' : ''}`
  const className = `map-card${focused ? ' is-focused' : ''}${card.finished ? ' is-finished' : ''}${detail ? '' : ' is-thumb'}${end ? ' is-end' : ''}${names ? ' show-names' : ''}`
  const pick = diggable ? undefined : () => onPick(card.id)
  if (!detail)
    return <div className={blockClass} style={blockStyle} onClick={pick} role="button" aria-label={`${end ? '末地宝藏' : `第 ${card.id} 张卡`}${hasEye ? '，有末影之眼' : ''}${card.finished ? '，已挖完' : ''}`}>
      <div className={className} style={{ width: CARD_PX, height: CARD_PX, padding: PAD }}>
        <ThumbCanvas card={card} />
      </div>
    </div>
  const peekAt = new Map(peeks.map(peek => [peek.index, peek]))
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
        return <div key={index} style={wave(index)} className={`map-cell revealed kind-${cell.kind}${mine ? ' is-mine' : ''}${recent ? (recent.mine ? ' just-mine' : ' just-other') : ''}`} aria-label={`${name}：${KIND_NAMES[cell.kind]}，${cell.name} 挖的`}>
          <ItemIcon kind={cell.kind} size={icon} />
          {current ? <span className="cell-who" aria-hidden={!names}>{mine ? '我' : cell.name}</span> : null}
          {recent?.mine && recent.result ? <span className={`cell-float${recent.result.amount < 0 ? ' is-bad' : ''}`}>{floatText(recent.result)}</span> : null}
        </div>
      }
      const busy = !!pending[cellKey]
      return <button
        key={index}
        style={wave(index)}
        type="button"
        className={`map-cell covered${peek ? ' has-peek' : ''}${busy ? ' is-digging' : ''}`}
        disabled={!diggable || busy}
        onClick={event => {
          event.stopPropagation()
          onDig(card.id, index)
        }}
        aria-label={`${name}${peek ? `，望远镜看到是${KIND_NAMES[peek.kind]}` : ''}，${diggable ? '点按挖开' : '放大以后才能挖'}`}
      >
        {peek ? <ItemIcon kind={peek.kind} size={Math.round(icon * 0.85)} className="peek-icon" /> : null}
        {busy ? <ItemIcon kind="pickaxe" size={Math.round(icon * 0.92)} className="digging-pick" /> : null}
      </button>
    })}
    </div>
  </div>
})

/** 缩略图：整张卡画在一块画布里（thumb.ts），卡变了才重画；贴图还没到就等它到了再画。 */
function ThumbCanvas({ card }: { card: PublicCard }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  useLayoutEffect(() => {
    // 只读写这一小块：要普通内存里的画布，不让浏览器给每张卡开一块显存、各占一层
    const context = canvas.current?.getContext('2d', { willReadFrequently: true })
    if (!context) return
    let stop: (() => void) | null = null
    const draw = () => {
      stop = null
      if (!drawThumb(context, card)) stop = whenImages(draw)
    }
    draw()
    return () => {
      stop?.()
    }
  }, [card])
  return <canvas ref={canvas} className="thumb-canvas" width={THUMB_PX} height={THUMB_PX} aria-hidden="true" />
}

function floatText(result: DigResult) {
  if (result.amount > 0) return `+${money(result.amount)}`
  if (result.amount < 0) return money(result.amount)
  if (result.kind === 'totem') return '+3 次'
  if (result.kind === 'pearl') return '新卡！'
  if (result.kind === 'shield') return result.blocked ? '挡住了' : '盾牌'
  if (result.kind === 'tnt' || result.kind === 'crystal') return '挡住了'
  if (result.kind === 'spyglass') return '看到一格'
  return ''
}
