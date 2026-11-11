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

/**
 * 四周多留的格位：地图跨度的一成五，至少 2 格。卡长出这个范围，三块画布都要重开、整张重画
 * （上千张卡时手机上明显顿一下），所以留宽一点，地图大了也很少碰到
 */
const MARGIN_SLOTS = 2
const MARGIN_SHARE = 0.15
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

/** 画布占的世界范围：所有卡的格位，四周多留一圈（见 MARGIN_SHARE）；只在卡长出范围时变。 */
export function areaOf(box: Area, before: Area | null): Area {
  if (before && box.minX >= before.minX && box.maxX <= before.maxX && box.minY >= before.minY && box.maxY <= before.maxY) return before
  const margin = Math.max(MARGIN_SLOTS, Math.ceil(Math.max(box.maxX - box.minX, box.maxY - box.minY) * MARGIN_SHARE))
  return { minX: box.minX - margin, maxX: box.maxX + margin, minY: box.minY - margin, maxY: box.maxY + margin }
}
export interface Area { minX: number; maxX: number; minY: number; maxY: number }

/** 按 2^¼ 一档取整：全图那一级的大小跟着地图一点点变，光的粗细不用每长一张卡就整张重画。 */
export const stepped = (value: number) => 2 ** (Math.round(Math.log2(value) * 4) / 4)

type Rect = { x: number; y: number; w: number; h: number }
const meets = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

/** 光变了的卡：以前画了、现在不画（或者换了颜色）的，和新要画的。 */
export function glowChanges(drawn: Map<number, string>, wanted: Map<number, string>) {
  const changed: number[] = []
  for (const [id, glow] of drawn) if (wanted.get(id) !== glow) changed.push(id)
  for (const id of wanted.keys()) if (!drawn.has(id)) changed.push(id)
  return changed
}

/** 画布换大小（会清空）；大小没变就只清空（给 width 赋值会重开画布的存储，手机上不便宜）。 */
function reopen(element: HTMLCanvasElement, context: CanvasRenderingContext2D, pixels: { width: number; height: number }) {
  if (element.width !== pixels.width || element.height !== pixels.height) {
    element.width = pixels.width
    element.height = pixels.height
  } else {
    context.clearRect(0, 0, element.width, element.height)
  }
}

/**
 * 一张光的贴图：区块（side 见方，四周留 pad）外面一圈光、里面淡淡的底色、一条细边。
 * px：屏幕 1px 在画布上合多少像素（全图那一级），光和边的粗细按它算，和网页里的一样。
 */
function glowSprite(glow: Glow, side: number, pad: number, px: number) {
  if (typeof document === 'undefined') return null
  const sprite = document.createElement('canvas')
  sprite.width = sprite.height = Math.ceil(side + pad * 2)
  const context = sprite.getContext('2d')
  if (!context) return null
  const end = glow === 'end'
  const rich = RICH[glow as RichGlow]
  const block = new Path2D()
  if ('roundRect' in block) block.roundRect(pad, pad, side, side, side * 16 / BLOCK_PX)
  else (block as Path2D).rect(pad, pad, side, side)
  // 外面那圈光只在区块外面（和 box-shadow 一样）：光用一块挪到画外的实心块投过来
  context.save()
  const outside = new Path2D()
  outside.rect(0, 0, sprite.width, sprite.height)
  outside.addPath(block)
  context.clip(outside, 'evenodd')
  const away = sprite.width + side * 2
  context.shadowColor = rich?.glow ?? (end ? '#ffbf3d8c' : '#9a6bff73')
  context.shadowBlur = (rich?.blur ?? (end ? 56 : 40)) * px
  context.shadowOffsetX = away
  context.fillStyle = '#000'
  context.translate(-away, 0)
  context.fill(block)
  context.restore()
  // 越富越亮的只有外面那圈光（和网页里的 .rich-N 一样），不加底色和边
  if (rich) return sprite
  context.fillStyle = end ? '#ffd36b17' : '#9a6bff12'
  context.fill(block)
  context.lineWidth = (end ? 2 : 1.5) * px
  context.strokeStyle = end ? '#f1c57fb3' : '#b48cff8c'
  context.save()
  context.clip(block)
  context.stroke(block)
  context.restore()
  return sprite
}

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

type RichGlow = 'rich1' | 'rich2' | 'rich3'
type Glow = 'eye' | 'end' | RichGlow
/** 越富越亮的三档金光（regions.ts richnessOf；和 v3.css 的 .rich-N 一样）：静止的，只在档位变时重画 */
const RICH: Record<RichGlow, { glow: string; blur: number }> = {
  rich1: { glow: '#ffd24a33', blur: 28 },
  rich2: { glow: '#ffd24a5c', blur: 36 },
  rich3: { glow: '#ffd24a94', blur: 44 },
}

/** 发光的卡：没挖完的末地宝藏（金）、藏着眼的（紫），别的按还藏着多少钱分三档金光（rich：0 不亮）。 */
export const glowOf = (card: PublicCard, rich = 0): Glow | null =>
  isTreasure(card) ? (card.finished ? null : 'end') : (card.left.eye ?? 0) > 0 ? 'eye' : rich > 0 ? `rich${rich as 1 | 2 | 3}` : null

export function MapCanvas({ cards, rich, view, skip, inDom, onPick, onHover }: {
  cards: PublicCard[]
  /** 越富越亮的档位（卡号 → 1～3，regions.ts richnessOf） */
  rich: Map<number, number>
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
  // 卡只会多、不会挪：范围只在张数变时算（上千张卡时每来一条推送都扫一遍也不便宜）
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const box = useMemo(() => bounds(cards), [cards.length])
  const corners = useMemo(() => [{ x: box.minX, y: box.minY }, { x: box.maxX, y: box.maxY }], [box])
  const resolution = view.width > 0 ? resolutionOf(view, corners, ratio) : 0.1
  const nextArea = areaOf(box, area.current)
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

  // 全图那一级的区块底色（别的级不显示，透明度跟着级别过渡）：新长的卡只补画它那一块，
  // 范围、清晰度变了才整张重画（以前每长一张卡都把上千块整张重画一遍）
  const blocks = useRef<HTMLCanvasElement>(null)
  const blocksDrawn = useRef({ geometry: '', count: 0 })
  useLayoutEffect(() => {
    const element = blocks.current
    const context = element?.getContext('2d')
    if (!element || !context) return
    const geometry = `${pixels.width}x${pixels.height}@${left},${top},${scale}`
    let from = blocksDrawn.current.count
    if (blocksDrawn.current.geometry !== geometry) {
      reopen(element, context, pixels)
      from = 0
    }
    context.fillStyle = '#ffffff0a'
    context.strokeStyle = '#ffffff26'
    context.lineWidth = 1.5
    for (const card of cards.slice(from)) {
      const x = (card.x * SLOT_PX - BLOCK_PX / 2 - left) * scale
      const y = (card.y * SLOT_PX - BLOCK_PX / 2 - top) * scale
      context.beginPath()
      if (context.roundRect) context.roundRect(x + 0.75, y + 0.75, BLOCK_PX * scale - 1.5, BLOCK_PX * scale - 1.5, 16 * scale)
      else context.rect(x + 0.75, y + 0.75, BLOCK_PX * scale - 1.5, BLOCK_PX * scale - 1.5)
      context.fill()
      context.stroke()
    }
    blocksDrawn.current = { geometry, count: cards.length }
    // 只在张数、范围、清晰度变时（卡按长出来的先后排，新的在后面）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cards.length, pixels.width, pixels.height, left, top, scale])

  // 远处发光的卡（藏着眼的、没挖完的宝藏）：光、底色和细边画在这块画布上，不动。以前它们
  // 一直放在网页里，缩到全图时浏览器要把十几张卡连光一起按原来的清晰度重新栅格化一遍，
  // 显卡忙半秒，红包站跟着卡。近处的、当前卡在网页里，光照旧（::before）
  const glowCanvas = useRef<HTMLCanvasElement>(null)
  const wanted = new Map<number, Glow>()
  for (const card of cards) {
    const glow = glowOf(card, rich.get(card.id))
    if (glow && !inDom.has(card.id)) wanted.set(card.id, glow)
  }
  const glowKey = [...wanted].map(([id, glow]) => `${id}${glow}`).join(',')
  // 画在世界里的大小按全图那一级屏幕上的像素算（unit：屏幕 1px 合多少世界像素），和网页里的一样；
  // 按档取整，地图长一点不用整张重画
  const unit = view.width > 0 ? stepped(1 / overviewScale(view, corners)) : 10
  const glowDrawn = useRef({ geometry: '', glows: new Map<number, string>() })
  const sprites = useRef<{ key: string; made: Map<Glow, HTMLCanvasElement | null> }>({ key: '', made: new Map() })
  useLayoutEffect(() => {
    const element = glowCanvas.current
    const context = element?.getContext('2d')
    if (!element || !context) return
    const byId = new Map(cards.map(card => [card.id, card]))
    const rectOf = (card: Pick<PublicCard, 'x' | 'y'>) => {
      const x = (card.x * SLOT_PX - BLOCK_PX / 2 - left) * scale
      const y = (card.y * SLOT_PX - BLOCK_PX / 2 - top) * scale
      return { x, y, side: BLOCK_PX * scale }
    }
    // 光往外散的距离（最大的模糊半径的一倍半，再往外几乎看不见）：一张卡的光变了，只清掉、重画这么大一块
    const reach = 84 * unit * scale
    const around = (card: Pick<PublicCard, 'x' | 'y'>): Rect => {
      const { x, y, side } = rectOf(card)
      return { x: x - reach, y: y - reach, w: side + reach * 2, h: side + reach * 2 }
    }
    // 每种光（紫、金）先在一块小画布上画好一张（模糊只算这一次），之后每张卡都是贴这张图。
    // 模糊很贵：Safari 上一次几毫秒到几十毫秒，拖动时近处的卡进出网页、光跟着换，一张张现画会顿
    const side = BLOCK_PX * scale
    const pad = Math.ceil(reach)
    const spriteKey = `${scale},${unit}`
    if (sprites.current.key !== spriteKey) sprites.current = { key: spriteKey, made: new Map() }
    const spriteOf = (glow: Glow) => {
      const made = sprites.current.made
      if (!made.has(glow)) made.set(glow, glowSprite(glow, side, pad, unit * scale))
      return made.get(glow) ?? null
    }
    const drawGlow = (card: PublicCard, glow: Glow) => {
      const { x, y } = rectOf(card)
      const sprite = spriteOf(glow)
      if (sprite) context.drawImage(sprite, x - pad, y - pad)
    }
    const geometry = `${pixels.width}x${pixels.height}@${left},${top},${scale},${unit}`
    const before = glowDrawn.current
    if (before.geometry !== geometry) {
      // 范围、清晰度、粗细变了：整张重画
      reopen(element, context, pixels)
      for (const [id, glow] of wanted) drawGlow(byId.get(id)!, glow)
    } else {
      // 只重画光变了的卡四周那一块：清掉，再把光照到这块的卡（按原来的先后）画一遍
      const glowing = [...wanted].map(([id, glow]) => ({ card: byId.get(id)!, glow, rect: around(byId.get(id)!) }))
      for (const id of glowChanges(before.glows, wanted)) {
        const card = byId.get(id)
        if (!card) continue
        const dirty = around(card)
        context.save()
        context.beginPath()
        context.rect(dirty.x, dirty.y, dirty.w, dirty.h)
        context.clip()
        context.clearRect(dirty.x, dirty.y, dirty.w, dirty.h)
        for (const item of glowing) if (meets(item.rect, dirty)) drawGlow(item.card, item.glow)
        context.restore()
      }
    }
    glowDrawn.current = { geometry, glows: wanted }
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
