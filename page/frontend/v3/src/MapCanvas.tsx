import { useLayoutEffect, useMemo, useRef } from 'react'
import type { Viewport } from './camera'
import { BLOCK_PX, bounds, CARD_PX, overviewScale, SLOT_PX } from './camera'
import { drawCard, whenImages } from './thumb'
import type { PublicCard } from './types'

// 整张地图的画布（docs/V3_MAP.md §6）：远处的卡全画在这一块上，网页里只留近处能挖的、
// 当前卡、发光的（藏着眼的、没挖完的宝藏）和刚长出来的卡。以前每张卡是网页里的一组
// 元素，几百张卡时有人挖一格（或者有个东西在动），浏览器每一帧都要把它们重新分一遍层，
// 手机上掉到二三十帧；画布只是一个元素。画布在世界坐标里，跟着地图一起移动和缩放；
// 网页里的卡盖在它上面，从格子换回缩略图时看不出接缝。

/** 四周多留几格，地图往外长一点不用整张重开画布 */
const MARGIN_SLOTS = 2
/** 画布最大边长（像素）：再大手机上占的显存太多 */
const MAX_SIDE = 4096

/**
 * 画布的清晰度（画布像素 / 世界像素）：全图那一级刚好够清楚（乘上屏幕像素比，再多一点），
 * 按 √2 一档取整，地图稍微长大一点不用整张重画。
 */
export function resolutionOf(view: Viewport, cards: Pick<PublicCard, 'x' | 'y'>[], ratio: number) {
  const wanted = Math.min(0.5, Math.max(0.03, overviewScale(view, cards) * ratio * 1.5))
  return 2 ** (Math.round(Math.log2(wanted) * 2) / 2)
}

/** 画布占的世界范围：所有卡的格位，四周多留 MARGIN_SLOTS 格；只在卡长出范围时变。 */
export function areaOf(cards: Pick<PublicCard, 'x' | 'y'>[], before: Area | null): Area {
  const box = bounds(cards)
  if (before && box.minX >= before.minX && box.maxX <= before.maxX && box.minY >= before.minY && box.maxY <= before.maxY) return before
  return { minX: box.minX - MARGIN_SLOTS, maxX: box.maxX + MARGIN_SLOTS, minY: box.minY - MARGIN_SLOTS, maxY: box.maxY + MARGIN_SLOTS }
}
export interface Area { minX: number; maxX: number; minY: number; maxY: number }

/** 世界坐标里的一点落在哪个格位的卡上（全图点击、悬停用）。 */
export function cardAt<T extends Pick<PublicCard, 'x' | 'y'>>(bySlot: Map<string, T>, world: { x: number; y: number }) {
  const x = Math.round(world.x / SLOT_PX)
  const y = Math.round(world.y / SLOT_PX)
  const card = bySlot.get(`${x},${y}`)
  if (!card) return null
  // 区块之间的空隙不算
  const half = BLOCK_PX / 2
  return Math.abs(world.x - x * SLOT_PX) <= half && Math.abs(world.y - y * SLOT_PX) <= half ? card : null
}

export function MapCanvas({ cards, view, skip, onPick, onHover }: {
  cards: PublicCard[]
  view: Viewport
  /** 不画的卡：刚长出来、入场动画还没放完的（它在网页里自己翻出来） */
  skip: number | null
  onPick: (event: React.MouseEvent<HTMLCanvasElement>) => void
  onHover: (event: React.PointerEvent<HTMLCanvasElement> | null) => void
}) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const area = useRef<Area | null>(null)
  const drawn = useRef(new Map<number, PublicCard | null>())
  const ratio = typeof window === 'undefined' ? 1 : Math.min(3, window.devicePixelRatio || 1)
  const resolution = view.width > 0 ? resolutionOf(view, cards, ratio) : 0.1
  const nextArea = areaOf(cards, area.current)
  const left = nextArea.minX * SLOT_PX - BLOCK_PX / 2
  const top = nextArea.minY * SLOT_PX - BLOCK_PX / 2
  const width = (nextArea.maxX - nextArea.minX) * SLOT_PX + BLOCK_PX
  const height = (nextArea.maxY - nextArea.minY) * SLOT_PX + BLOCK_PX
  const scale = Math.min(resolution, MAX_SIDE / width, MAX_SIDE / height)
  const pixels = { width: Math.ceil(width * scale), height: Math.ceil(height * scale) }

  useLayoutEffect(() => {
    const element = canvas.current
    const context = element?.getContext('2d')
    if (!element || !context) return
    // 范围或清晰度变了：画布重开（清空），整张重画；不然只画变了的卡
    const fresh = area.current !== nextArea || element.width !== pixels.width || element.height !== pixels.height
    if (fresh) {
      area.current = nextArea
      element.width = pixels.width
      element.height = pixels.height
      drawn.current.clear()
    }
    let missing = false
    const place = (card: PublicCard) => ({ x: (card.x * SLOT_PX - CARD_PX / 2 - left) * scale, y: (card.y * SLOT_PX - CARD_PX / 2 - top) * scale })
    for (const card of cards) {
      const hide = card.id === skip
      const before = drawn.current.get(card.id)
      if (hide ? before === null : before === card) continue
      const at = place(card)
      context.clearRect(at.x - 1, at.y - 1, CARD_PX * scale + 2, CARD_PX * scale + 2)
      if (hide) {
        drawn.current.set(card.id, null)
        continue
      }
      if (!drawCard(context, card, at.x, at.y, scale)) missing = true
      drawn.current.set(card.id, card)
    }
    // 贴图还没到的：到了再整张画一遍
    if (!missing) return
    return whenImages(() => {
      drawn.current.clear()
      for (const card of cards) {
        if (card.id === skip) continue
        const at = place(card)
        context.clearRect(at.x - 1, at.y - 1, CARD_PX * scale + 2, CARD_PX * scale + 2)
        drawCard(context, card, at.x, at.y, scale)
        drawn.current.set(card.id, card)
      }
    }) as unknown as () => void
  })

  // 全图那一级的区块底色（别的级不显示，透明度跟着级别过渡）：只在范围、清晰度变时重画
  const blocks = useRef<HTMLCanvasElement>(null)
  const slots = useMemo(() => cards.map(card => `${card.x},${card.y}`).join(';'), [cards])
  useLayoutEffect(() => {
    const element = blocks.current
    const context = element?.getContext('2d')
    if (!element || !context) return
    element.width = pixels.width
    element.height = pixels.height
    context.fillStyle = '#ffffff0a'
    context.strokeStyle = '#ffffff26'
    context.lineWidth = 1.5
    for (const card of cards) {
      const x = (card.x * SLOT_PX - BLOCK_PX / 2 - left) * scale
      const y = (card.y * SLOT_PX - BLOCK_PX / 2 - top) * scale
      context.beginPath()
      if (context.roundRect) context.roundRect(x + 0.75, y + 0.75, BLOCK_PX * scale - 1.5, BLOCK_PX * scale - 1.5, 16 * scale)
      else context.rect(x + 0.75, y + 0.75, BLOCK_PX * scale - 1.5, BLOCK_PX * scale - 1.5)
      context.fill()
      context.stroke()
    }
    // 只在格位、范围、清晰度变时
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slots, pixels.width, pixels.height, left, top, scale])

  const style = { left, top, width, height }
  return <>
    <canvas ref={blocks} className="map-blocks-canvas" style={style} aria-hidden="true" />
    <canvas ref={canvas} className="map-cards-canvas" style={style} aria-hidden="true"
      onClick={onPick} onPointerMove={onHover} onPointerLeave={() => onHover(null)} />
  </>
}
