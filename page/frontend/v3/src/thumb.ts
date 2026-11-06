import { CARD_BORDER, CARD_PX, cellPx, GAP, PAD } from './camera'
import type { Kind, PublicCard } from './types'

// 缩略图（远处、全图时，docs/V3_MAP.md §6）：一张卡画进一块小画布，和格子画得一样——
// 没挖的是石头（宝藏卡是末地石），挖开的是同样的底色和图标。以前每格一个元素、每个
// 图标一张图，几百张卡就是上万个元素，有人挖一格浏览器每一帧都要把它们重新分一遍层，
// 手机上掉到二三十帧；画成一块画布，一张卡只有一个元素。

/** 画布的像素边长（卡的内容区 332 画成这么大；缩略图在屏幕上最大约 144，够用、也省内存） */
export const THUMB_PX = 112
/** 卡外框里面放格子的那块（border-box：减去边框和内边距） */
export const INNER_PX = CARD_PX - (PAD + CARD_BORDER) * 2

const BASE = 'assets/minecraft/1.21.4/'
const ICONS: Partial<Record<Kind | 'pickaxe', string>> = {
  emerald: 'textures/item/emerald.png',
  diamond: 'textures/item/diamond.png',
  // 缩略图里放金苹果的静态首帧（动图在这么小的地方看不出来，还会一直重画）
  apple: 'inventory/enchanted_golden_apple.png',
  pickaxe: 'textures/item/iron_pickaxe.png',
  pearl: 'textures/item/ender_pearl.png',
  eye: 'textures/item/ender_eye.png',
  crystal: 'textures/item/end_crystal.png',
  spyglass: 'textures/item/spyglass.png',
  tnt: 'inventory/tnt.png',
  shield: 'inventory/shield.png',
}
const STONE = 'textures/block/stone.png'
const END_STONE = 'textures/block/end_stone.png'

/** 挖开的格子底色（和 v3.css 的 .map-cell.kind-* 一样） */
export const CELL_COLORS: Partial<Record<Kind, string>> = {
  diamond: '#20363e', apple: '#3a302e', tnt: '#3b292b', totem: '#2e382e', pearl: '#2c2b3c',
  shield: '#34312f', spyglass: '#2c323a', crystal: '#33263d',
}
const OPENED = '#19232d'

const images = new Map<string, HTMLImageElement>()
const waiting = new Set<() => void>()

/** 贴图：第一次要时开始加载，加载好了通知画过缺图的画布重画一次。 */
function image(path: string) {
  let img = images.get(path)
  if (!img) {
    img = new Image()
    img.decoding = 'async'
    img.src = new URL(BASE + path, document.baseURI).href
    img.onload = () => {
      const listeners = [...waiting]
      waiting.clear()
      for (const listener of listeners) listener()
    }
    images.set(path, img)
  }
  return img.complete && img.naturalWidth > 0 ? img : null
}

/** 缺图时登记一下，图到了再画一次。 */
export function whenImages(listener: () => void) {
  waiting.add(listener)
  return () => waiting.delete(listener)
}

/** 每一格在画布上的位置（和网格一样：格子边长 cellPx，格间距 GAP）。 */
export function cellRect(size: number, index: number, scale = THUMB_PX / INNER_PX) {
  const side = cellPx(size)
  const row = Math.floor(index / size)
  const col = index % size
  return { x: col * (side + GAP) * scale, y: row * (side + GAP) * scale, side: side * scale }
}

/** 把一张卡的格子画进小画布（单张卡的缩略图）；有贴图还没到时返回 false（等它到了再画）。 */
export function drawThumb(context: CanvasRenderingContext2D, card: PublicCard) {
  context.clearRect(0, 0, THUMB_PX, THUMB_PX)
  return drawCells(context, card, 0, 0, THUMB_PX / INNER_PX)
}

/**
 * 整张卡（外框、底色、格子）画在 (left, top) 起、按 scale 缩放的地方；整张地图的画布用。
 * 挖完的卡盖一层暗色（DOM 上是灰度加变暗的 filter）。
 */
export function drawCard(context: CanvasRenderingContext2D, card: PublicCard, left: number, top: number, scale: number) {
  const end = card.kind === 'end'
  const size = CARD_PX * scale
  const border = CARD_BORDER * scale
  context.fillStyle = end ? '#d9c27a' : '#67533e'
  roundRect(context, left, top, size, size, 6 * scale)
  context.fillStyle = end ? '#2a2637' : '#211f20'
  context.fillRect(left + border, top + border, size - border * 2, size - border * 2)
  const inset = (PAD + CARD_BORDER) * scale
  const complete = drawCells(context, card, left + inset, top + inset, scale)
  if (card.finished) {
    context.fillStyle = '#0a0d10a6'
    roundRect(context, left, top, size, size, 6 * scale)
  }
  return complete
}

function roundRect(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  context.beginPath()
  if (context.roundRect) context.roundRect(x, y, width, height, radius)
  else context.rect(x, y, width, height)
  context.fill()
}

/** 只画格子：(left, top) 是格子区的左上角，scale 是画布像素比 CSS 像素。 */
function drawCells(context: CanvasRenderingContext2D, card: PublicCard, left: number, top: number, scale: number) {
  let complete = true
  const need = (path: string) => {
    const img = image(path)
    if (!img) complete = false
    return img
  }
  context.imageSmoothingEnabled = false
  const ground = need(card.kind === 'end' ? END_STONE : STONE)
  card.cells.forEach((cell, index) => {
    const rect = cellRect(card.size, index, scale)
    const x = left + rect.x
    const y = top + rect.y
    const { side } = rect
    if (!cell) {
      if (ground) context.drawImage(ground, x, y, side, side)
      else {
        context.fillStyle = card.kind === 'end' ? '#cfc79a' : '#6d6d6d'
        context.fillRect(x, y, side, side)
      }
      // 和格子上那层淡淡的暖色、冷色渐变差不多
      context.fillStyle = card.kind === 'end' ? '#2a1f4014' : '#0e172514'
      context.fillRect(x, y, side, side)
      return
    }
    context.fillStyle = CELL_COLORS[cell.kind] ?? OPENED
    context.fillRect(x, y, side, side)
    const icon = side * 0.62
    // 太小时只画底色（不到 3 个像素的图标看不出是什么）
    if (icon < 3) return
    const iconLeft = x + (side - icon) / 2
    const iconTop = y + (side - icon) / 2
    if (cell.kind === 'totem') {
      // 双铁镐：两把叠着
      const pick = need(ICONS.pickaxe!)
      if (pick) {
        const small = icon * 0.77
        context.drawImage(pick, iconLeft + icon - small, iconTop, small, small)
        context.drawImage(pick, iconLeft, iconTop + icon - small, small, small)
      }
      return
    }
    const path = ICONS[cell.kind]
    const img = path ? need(path) : null
    if (img) context.drawImage(img, iconLeft, iconTop, icon, icon)
  })
  return complete
}
