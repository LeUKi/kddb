// 地图的镜头（docs/V3_MAP.md §6）：一张卡占一个格位，镜头是平移加缩放。
// 屏幕坐标 = 世界坐标 × scale + (x, y)。都是纯函数，网页和测试共用。
import type { PublicCard } from './types'

/** 一格 44，格间 4，卡边 14：7×7 的卡 360 宽；格位 400（卡之间留 40）。 */
export const CELL = 44
export const GAP = 4
export const PAD = 14
export const SLOT_PX = 400

export const cardPx = (size: number) => size * CELL + (size - 1) * GAP + PAD * 2

export interface Camera { x: number; y: number; scale: number }
export interface Viewport { width: number; height: number }

/** 三级缩放：0 总览，1 中间，2 挖卡。 */
export type Level = 0 | 1 | 2

/** 挖卡这一级：一张 7×7 的卡占满窄的那边的九成，邻卡露出一点。 */
export function digScale(view: Viewport) {
  return Math.min(1.3, Math.max(0.55, (Math.min(view.width, view.height) * 0.92) / cardPx(7)))
}

/** 中间这一级：窄的那边放得下两格多一点，周围四五张。 */
export function midScale(view: Viewport) {
  return Math.min(digScale(view) * 0.8, Math.min(view.width, view.height) / (SLOT_PX * 2.4))
}

/** 总览：所有卡都放下、四周留安全距离；卡少时不比中间那一级更大。 */
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

/** 离屏幕正中最近的卡（聚焦、松手吸附都用它）。 */
export function nearestCard<T extends Pick<PublicCard, 'x' | 'y'>>(cards: T[], camera: Camera, view: Viewport): T | null {
  const at = worldCenter(camera, view)
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

export type Direction = 'up' | 'down' | 'left' | 'right'
const VECTORS: Record<Direction, [number, number]> = { right: [1, 0], down: [0, 1], left: [-1, 0], up: [0, -1] }

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
