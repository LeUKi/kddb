// 地图的镜头（docs/V3_MAP.md §6）：一张卡占一个格位，镜头是平移加缩放。
// 屏幕坐标 = 世界坐标 × scale + (x, y)。都是纯函数，网页和测试共用。
import type { PublicCard } from './types'

/**
 * 一格 44，格间 4，卡的内边距 11、边框 3（页面是 border-box，边框算在宽度里，
 * 不算进去格子会往右下溢出）：7×7 的卡 360 宽。每张卡放在一个 376 见方的区块正中，
 * 区块之间固定隔 24：格位 400。
 */
export const CELL = 44
export const GAP = 4
export const PAD = 11
export const CARD_BORDER = 3
export const SLOT_PX = 400
export const BLOCK_GAP = 24
export const BLOCK_PX = SLOT_PX - BLOCK_GAP

export const cardPx = (size: number) => size * CELL + (size - 1) * GAP + (PAD + CARD_BORDER) * 2

export interface Camera { x: number; y: number; scale: number }
export interface Viewport { width: number; height: number }

/** 三级缩放：0 总览，1 附近，2 挖卡。 */
export type Level = 0 | 1 | 2

/** 挖卡这一级，卡和画面边之间给邻卡箭头留的地方。 */
export const EDGE_ROOM = 30
/** 附近这一级的缩放。 */
export const MID_SCALE = 0.42

/**
 * 挖卡这一级：画面放得下就是原大，区块之间的距离不随画面大小变；窄的那边
 * 放不下一张 7×7 的卡和两边的箭头时才缩小。
 */
export function digScale(view: Viewport) {
  return Math.min(1, Math.max(0.5, (Math.min(view.width, view.height) - EDGE_ROOM * 2) / cardPx(7)))
}

/** 附近这一级：固定的缩放，画面大就多看到几块。 */
export function midScale(view: Viewport) {
  return Math.min(MID_SCALE, digScale(view) * 0.8)
}

/** 总览：所有卡都放下、四周留安全距离；卡少时不比附近那一级更大。 */
export function overviewScale(view: Viewport, cards: Pick<PublicCard, 'x' | 'y'>[]) {
  const box = bounds(cards)
  const margin = 48
  const fit = Math.min(
    (view.width - margin * 2) / ((box.maxX - box.minX + 1) * SLOT_PX),
    (view.height - margin * 2) / ((box.maxY - box.minY + 1) * SLOT_PX),
  )
  return Math.max(0.04, Math.min(midScale(view), fit))
}

export function scaleOf(level: Level, view: Viewport, cards: Pick<PublicCard, 'x' | 'y'>[]) {
  return level === 2 ? digScale(view) : level === 1 ? midScale(view) : overviewScale(view, cards)
}

/** 离这个缩放最近的那一级（捏合松手后吸过去）。 */
export function nearestLevel(scale: number, view: Viewport, cards: Pick<PublicCard, 'x' | 'y'>[]): Level {
  const levels: Level[] = [0, 1, 2]
  return levels.reduce((best, level) =>
    Math.abs(Math.log(scaleOf(level, view, cards) / scale)) < Math.abs(Math.log(scaleOf(best, view, cards) / scale)) ? level : best,
  )
}

export function bounds(cards: Pick<PublicCard, 'x' | 'y'>[]) {
  if (cards.length === 0) return { minX: 0, maxX: 0, minY: 0, maxY: 0 }
  return {
    minX: Math.min(...cards.map(card => card.x)),
    maxX: Math.max(...cards.map(card => card.x)),
    minY: Math.min(...cards.map(card => card.y)),
    maxY: Math.max(...cards.map(card => card.y)),
  }
}

/** 卡的中心在世界里的位置。 */
export const centerOf = (card: Pick<PublicCard, 'x' | 'y'>) => ({ x: card.x * SLOT_PX, y: card.y * SLOT_PX })

/** 让世界里的一点落在屏幕正中。 */
export function cameraAt(point: { x: number; y: number }, scale: number, view: Viewport): Camera {
  return { x: view.width / 2 - point.x * scale, y: view.height / 2 - point.y * scale, scale }
}

/** 总览：把所有卡的中心放在屏幕正中。 */
export function overviewCamera(view: Viewport, cards: Pick<PublicCard, 'x' | 'y'>[]): Camera {
  const box = bounds(cards)
  return cameraAt({ x: ((box.minX + box.maxX) / 2) * SLOT_PX, y: ((box.minY + box.maxY) / 2) * SLOT_PX }, overviewScale(view, cards), view)
}

/** 屏幕正中对着世界里的哪一点。 */
export function worldCenter(camera: Camera, view: Viewport) {
  return { x: (view.width / 2 - camera.x) / camera.scale, y: (view.height / 2 - camera.y) / camera.scale }
}

/** 屏幕上这一点下面（或离它最近）的卡：滚轮放大时朝指针那张。 */
export function cardNear<T extends Pick<PublicCard, 'x' | 'y'>>(cards: T[], camera: Camera, point: { x: number; y: number }): T | null {
  const at = { x: (point.x - camera.x) / camera.scale, y: (point.y - camera.y) / camera.scale }
  let best: T | null = null
  let distance = Infinity
  for (const card of cards) {
    const center = centerOf(card)
    const d = (center.x - at.x) ** 2 + (center.y - at.y) ** 2
    if (d < distance) {
      distance = d
      best = card
    }
  }
  return best
}

/** 离屏幕正中最近的卡（聚焦、松手吸附都用它）。 */
export function nearestCard<T extends Pick<PublicCard, 'x' | 'y'>>(cards: T[], camera: Camera, view: Viewport): T | null {
  return cardNear(cards, camera, { x: view.width / 2, y: view.height / 2 })
}

export type Direction = 'up' | 'down' | 'left' | 'right'
export const VECTORS: Record<Direction, [number, number]> = { right: [1, 0], down: [0, 1], left: [-1, 0], up: [0, -1] }

/**
 * 从这张卡往一个方向走，到哪张卡：在那个方向上（偏离不超过 45°），先看格位
 * 距离，再看偏了多少。没有就是 null（按钮变灰）。
 */
export function cardToward<T extends Pick<PublicCard, 'x' | 'y'>>(cards: T[], from: Pick<PublicCard, 'x' | 'y'>, direction: Direction): T | null {
  const [vx, vy] = VECTORS[direction]
  let best: T | null = null
  let score = Infinity
  for (const card of cards) {
    const dx = card.x - from.x
    const dy = card.y - from.y
    const along = dx * vx + dy * vy
    const across = Math.abs(dx * vy - dy * vx)
    if (along <= 0 || across > along) continue
    const s = along * 10 + across
    if (s < score) {
      score = s
      best = card
    }
  }
  return best
}

/** 这张卡在不在屏幕里（留一点边）。 */
export function onScreen(card: Pick<PublicCard, 'x' | 'y'>, camera: Camera, view: Viewport, margin = 0) {
  const center = centerOf(card)
  const half = (cardPx(7) / 2) * camera.scale
  const sx = center.x * camera.scale + camera.x
  const sy = center.y * camera.scale + camera.y
  return sx + half > -margin && sx - half < view.width + margin && sy + half > -margin && sy - half < view.height + margin
}

/** 屏幕外的卡在屏幕边上的哪个位置、箭头朝哪（NEW 标记用）。 */
export function edgePointer(card: Pick<PublicCard, 'x' | 'y'>, camera: Camera, view: Viewport, inset = 44) {
  const center = centerOf(card)
  const sx = center.x * camera.scale + camera.x - view.width / 2
  const sy = center.y * camera.scale + camera.y - view.height / 2
  const halfW = view.width / 2 - inset
  const halfH = view.height / 2 - inset
  const k = Math.min(halfW / Math.max(Math.abs(sx), 1e-6), halfH / Math.max(Math.abs(sy), 1e-6), 1)
  return { x: view.width / 2 + sx * k, y: view.height / 2 + sy * k, angle: (Math.atan2(sy, sx) * 180) / Math.PI }
}

/** 邻卡箭头：扁的长条，屏幕上的大小。 */
export const ARROW = { long: 88, thick: 22, inset: 4 }

export interface EdgeArrow<T> { direction: Direction; card: T; x: number; y: number }

/**
 * 挖卡那一级，居中这张卡四个方向上的邻卡各一个箭头，放在邻卡区块靠这边的边上；
 * 邻卡在画面外时贴着画面边（top 留给上面的提示条）。返回世界坐标，和地图一起动。
 */
export function edgeArrows<T extends Pick<PublicCard, 'x' | 'y'>>(cards: T[], from: Pick<PublicCard, 'x' | 'y'>, camera: Camera, view: Viewport, top = 0): EdgeArrow<T>[] {
  const out: EdgeArrow<T>[] = []
  for (const direction of ['up', 'right', 'down', 'left'] as const) {
    const card = cardToward(cards, from, direction)
    if (!card) continue
    const [vx, vy] = VECTORS[direction]
    const center = centerOf(card)
    const inward = BLOCK_PX / 2 - (ARROW.thick / 2 + ARROW.inset) / camera.scale
    const sx = (center.x - vx * inward) * camera.scale + camera.x
    const sy = (center.y - vy * inward) * camera.scale + camera.y
    const halfW = (vx !== 0 ? ARROW.thick : ARROW.long) / 2 + ARROW.inset
    const halfH = (vy !== 0 ? ARROW.thick : ARROW.long) / 2 + ARROW.inset
    const x = Math.min(Math.max(sx, halfW), view.width - halfW)
    const y = Math.min(Math.max(sy, halfH + top), view.height - halfH)
    out.push({ direction, card, x: (x - camera.x) / camera.scale, y: (y - camera.y) / camera.scale })
  }
  return out
}

/** 滚轮缩放：一下（中间停不到 200ms 的一串事件）的状态。 */
export interface WheelZoom { last: number; stepAt: number; sum: number; stepped: boolean }
export const WHEEL_IDLE_MS = 200
export const WHEEL_STEP_MS = 260
export const WHEEL_MORE_PX = 80

/**
 * 滚轮换缩放级别。浏览器分不清鼠标滚轮和触控板双指滑动，所以不按设备分：
 * 不按 ctrl 的滚轮都是缩放（触控板捏合是按着 ctrl 的滚轮，另算），平移靠拖动和箭头。
 * 一下的第一个事件就换一级；同一下里同方向再攒够 80px、离上次换级过了 260ms，再换一级。
 * 返回 1 放大、-1 缩小、0 不动。
 */
export function wheelZoom(state: WheelZoom | null, event: { deltaMode: number; deltaY: number }, now: number): { state: WheelZoom; step: 1 | -1 | 0 } {
  const unit = event.deltaMode === 1 ? 40 : event.deltaMode === 2 ? 800 : 1
  const px = event.deltaY * unit
  const fresh = !state || now - state.last > WHEEL_IDLE_MS
  const next: WheelZoom = fresh ? { last: now, stepAt: state?.stepAt ?? -Infinity, sum: 0, stepped: false } : { ...state, last: now }
  if (px === 0) return { state: next, step: 0 }
  if (Math.sign(px) !== Math.sign(next.sum)) next.sum = 0
  next.sum += px
  if (now - next.stepAt < WHEEL_STEP_MS || (next.stepped && Math.abs(next.sum) < WHEEL_MORE_PX)) return { state: next, step: 0 }
  return { state: { ...next, stepAt: now, sum: 0, stepped: true }, step: next.sum < 0 ? 1 : -1 }
}
