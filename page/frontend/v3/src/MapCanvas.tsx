import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import type { Viewport } from './camera'
import { BLOCK_PX, bounds, CARD_PX, overviewScale, SLOT_PX } from './camera'
import { isTreasure } from './eye'
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
 * 有人挖了一格：画布最多每 250 毫秒重画一次（几十个人一起挖时一秒十几格）。画布每改一次，
 * 显卡都要把整块画布再交一遍；远处那么小的格子晚一点点亮也看不出来
 */
const PAINT_EVERY_MS = 250

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

/** 发光的卡：藏着眼的（紫）、没挖完的末地宝藏（金）。 */
export const glowOf = (card: PublicCard) => (isTreasure(card) ? !card.finished && 'end' : (card.left.eye ?? 0) > 0 && 'eye') || null

export function MapCanvas({ cards, view, skip, inDom, onPick, onHover }: {
  cards: PublicCard[]
  view: Viewport
  /** 不画的卡：刚长出来、入场动画还没放完的（它在网页里自己翻出来） */
  skip: number | null
  /** 放在网页里的卡（它们的光自己画，这里不画） */
  inDom: Set<number>
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

  const latest = useRef({ cards, skip, nextArea, pixels, left, top, scale })
  latest.current = { cards, skip, nextArea, pixels, left, top, scale }
  const lastPaint = useRef(0)
  const timer = useRef<number | undefined>(undefined)
  const stopImages = useRef<(() => void) | null>(null)

  const paint = useCallback(() => {
    window.clearTimeout(timer.current)
    timer.current = undefined
    lastPaint.current = performance.now()
    const element = canvas.current
    const context = element?.getContext('2d')
    if (!element || !context) return
    const { cards, skip, nextArea, pixels, left, top, scale } = latest.current
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
    stopImages.current?.()
    stopImages.current = missing ? whenImages(() => {
      stopImages.current = null
      drawn.current.clear()
      paint()
    }) as unknown as () => void : null
  }, [])

  // 范围、清晰度变了马上画（画布已经换了位置和大小）；别的最多每 PAINT_EVERY_MS 画一次
  useLayoutEffect(() => {
    const element = canvas.current
    const reopen = !element || area.current !== nextArea || element.width !== pixels.width || element.height !== pixels.height
    const since = performance.now() - lastPaint.current
    if (reopen || since >= PAINT_EVERY_MS) paint()
    else timer.current ??= window.setTimeout(paint, PAINT_EVERY_MS - since)
  })
  useEffect(() => () => {
    window.clearTimeout(timer.current)
    stopImages.current?.()
  }, [])

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

  // 远处发光的卡（藏着眼的、没挖完的宝藏）：光、底色和细边画在这块画布上，不动。以前它们
  // 一直放在网页里，缩到全图时浏览器要把十几张卡连光一起按原来的清晰度重新栅格化一遍，
  // 显卡忙半秒，红包站跟着卡。近处的、当前卡在网页里，光照旧（::before）
  const glowCanvas = useRef<HTMLCanvasElement>(null)
  const glowKey = cards.flatMap(card => {
    const glow = glowOf(card)
    return glow && !inDom.has(card.id) ? [`${card.id}${glow}`] : []
  }).join(',')
  const unit = view.width > 0 ? 1 / overviewScale(view, cards) : 10
  useLayoutEffect(() => {
    const element = glowCanvas.current
    const context = element?.getContext('2d')
    if (!element || !context) return
    element.width = pixels.width
    element.height = pixels.height
    if (!glowKey) return
    // 画在世界里的大小按全图那一级屏幕上的像素算（unit：屏幕 1px 合多少世界像素），和网页里的一样
    for (const card of cards) {
      const glow = glowOf(card)
      if (!glow || inDom.has(card.id)) continue
      const end = glow === 'end'
      const x = (card.x * SLOT_PX - BLOCK_PX / 2 - left) * scale
      const y = (card.y * SLOT_PX - BLOCK_PX / 2 - top) * scale
      const side = BLOCK_PX * scale
      const radius = 16 * scale
      const block = new Path2D()
      if ('roundRect' in block) block.roundRect(x, y, side, side, radius)
      else (block as Path2D).rect(x, y, side, side)
      // 外面那圈光只在区块外面（和 box-shadow 一样）：光用一块挪到画外的实心块投过来
      context.save()
      const outside = new Path2D()
      outside.rect(0, 0, element.width, element.height)
      outside.addPath(block)
      context.clip(outside, 'evenodd')
      const away = element.width + side * 2
      context.shadowColor = end ? '#ffbf3d8c' : '#9a6bff73'
      context.shadowBlur = (end ? 56 : 40) * unit * scale
      context.shadowOffsetX = away
      context.fillStyle = '#000'
      context.translate(-away, 0)
      context.fill(block)
      context.restore()
      context.fillStyle = end ? '#ffd36b17' : '#9a6bff12'
      context.fill(block)
      context.lineWidth = (end ? 2 : 1.5) * unit * scale
      context.strokeStyle = end ? '#f1c57fb3' : '#b48cff8c'
      context.save()
      context.clip(block)
      context.stroke(block)
      context.restore()
    }
    // 只在发光的卡、范围、清晰度变时
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [glowKey, pixels.width, pixels.height, left, top, scale, unit])

  const style = { left, top, width, height }
  return <>
    <canvas ref={blocks} className="map-blocks-canvas" style={style} aria-hidden="true" />
    <canvas ref={glowCanvas} className="map-glow-canvas" style={style} aria-hidden="true" />
    <canvas ref={canvas} className="map-cards-canvas" style={style} aria-hidden="true"
      onClick={onPick} onPointerMove={onHover} onPointerLeave={() => onHover(null)} />
  </>
}
