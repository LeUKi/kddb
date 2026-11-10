// 道具（docs/V3_ITEMS.md §3）：工具条上每一格是什么、怎么用，和对格子用的道具点到哪几格。
// 纯数据和纯函数，网页和测试共用。
import type { Me, PublicCard, Shape } from './types'

/** 工具条上的一格。镐子固定在最前面；被动的排在一道线后面。 */
export type Slot =
  | 'pickaxe' | 'pick-h' | 'pick-v' | 'pick-x' | 'spyglass' | 'torch' | 'key' | 'map' | 'potion' | 'ender' | 'table'
  | 'shield' | 'coal' | 'stick' | 'poison'

/**
 * 怎么用：cell 点一格、box 放一个形状、corner 插在四格相交处、vault 点宝库（这四种拿在手上，
 * 先预览再用）；confirm 在提示框里确认；dialog 打开弹窗；passive 自动生效，点开只看说明。
 */
export type Use = 'base' | 'cell' | 'box' | 'corner' | 'vault' | 'confirm' | 'dialog' | 'passive'

/** 拿在手上的道具（对格子用的那几种） */
export type Held = 'pick-h' | 'pick-v' | 'pick-x' | 'spyglass' | 'torch' | 'key'

export const SLOT_USE: Record<Slot, Use> = {
  pickaxe: 'base', 'pick-h': 'box', 'pick-v': 'box', 'pick-x': 'box', spyglass: 'cell', torch: 'corner', key: 'vault',
  map: 'confirm', potion: 'confirm', ender: 'dialog', table: 'dialog', shield: 'passive', coal: 'passive', stick: 'passive', poison: 'passive',
}

export const SLOT_NAMES: Record<Slot, string> = {
  pickaxe: '镐子', 'pick-h': '附魔镐 · 横三格', 'pick-v': '附魔镐 · 竖三格', 'pick-x': '附魔镐 · 十字', spyglass: '望远镜', torch: '火把',
  key: '试炼钥匙', map: '藏宝图', potion: '急迫药水', ender: '末影箱', table: '附魔台', shield: '盾牌', coal: '煤炭', stick: '木棍', poison: '中毒',
}

export const isHeld = (slot: Slot): slot is Held => ['box', 'cell', 'corner', 'vault'].includes(SLOT_USE[slot])

/** 附魔镐的形状：相对中心的 [行, 列] */
export const SHAPES: Record<Shape, [number, number][]> = {
  h: [[0, -1], [0, 0], [0, 1]],
  v: [[-1, 0], [0, 0], [1, 0]],
  x: [[-1, 0], [0, -1], [0, 0], [0, 1], [1, 0]],
}
export const SHAPE_NAMES: Record<Shape, string> = { h: '横三格', v: '竖三格', x: '十字' }
export const shapeOf = (slot: Held): Shape | null => (slot === 'pick-h' ? 'h' : slot === 'pick-v' ? 'v' : slot === 'pick-x' ? 'x' : null)

/** 煤炭、木棍各攒几格做一个火把（游戏站的 NEED）。 */
export const CRAFT_NEED = 2
/** 有道具栏的局盾牌最多带几面。 */
export const SHIELD_CAP = 3

/** 形状放在 (row, col) 时，整个形状挪进卡里以后的中心。 */
export function clampCenter(size: number, row: number, col: number, shape: Shape) {
  const cells = SHAPES[shape]
  const low = (axis: 0 | 1) => -Math.min(...cells.map(cell => cell[axis]))
  const high = (axis: 0 | 1) => size - 1 - Math.max(...cells.map(cell => cell[axis]))
  return {
    row: Math.min(high(0), Math.max(low(0), row)),
    col: Math.min(high(1), Math.max(low(1), col)),
  }
}

/** 形状的中心在第 index 格时，盖住哪几格（从上到下、从左到右，出界的不算）。 */
export function shapeCells(size: number, index: number, shape: Shape) {
  const row = Math.floor(index / size)
  const col = index % size
  return SHAPES[shape]
    .map(([dr, dc]) => [row + dr, col + dc])
    .filter(([r, c]) => r >= 0 && c >= 0 && r < size && c < size)
    .map(([r, c]) => r * size + c)
    .sort((a, b) => a - b)
}

/**
 * 火把插在哪个角：点在第 index 格的哪个四分之一（qx、qy 是 0 左/上，1 右/下），就是离得最近的
 * 那个角；卡边上的角挪到里面。返回那个角右下的格子（行、列都 ≥ 1）。
 */
export function cornerOf(size: number, index: number, qx: 0 | 1, qy: 0 | 1) {
  const row = Math.min(size - 1, Math.max(1, Math.floor(index / size) + qy))
  const col = Math.min(size - 1, Math.max(1, (index % size) + qx))
  return row * size + col
}

/** 火把（插在 at 格的左上角）照亮的 4 格。 */
export function cornerCells(size: number, at: number) {
  return [at - size - 1, at - size, at - 1, at]
}

/** 这张卡上还有能开的宝库（卡挖完了宝库照样能开）。 */
export function vaultsLeft(card: PublicCard) {
  return !card.closed && Object.values(card.vaults ?? {}).some(left => left > 0)
}

/** 这一格能不能挖（没开、不是装饰、宝库、岩浆；卡没关）。 */
export function diggable(card: PublicCard, index: number) {
  return !card.closed && card.cells[index] === null && !card.fixed?.[index]
}

/** 工具条上有哪些格：镐子以外主动的、被动的（被动排在一道线后面）。没有道具栏的旧局只有盾牌。 */
export function slotsOf(me: Me, items: boolean): { active: Slot[]; passive: Slot[] } {
  const active: Slot[] = []
  const passive: Slot[] = []
  const shields = me.shields ?? (me.shield ? 1 : 0)
  if (items) {
    const owned = me.items
    if (owned) {
      if (owned.pick.h > 0) active.push('pick-h')
      if (owned.pick.v > 0) active.push('pick-v')
      if (owned.pick.x > 0) active.push('pick-x')
    }
    if ((me.spyglasses ?? 0) > 0) active.push('spyglass')
    if (owned) {
      if (owned.torch > 0) active.push('torch')
      if (owned.key > 0) active.push('key')
      if (owned.map > 0) active.push('map')
      if (owned.potion > 0) active.push('potion')
      if (owned.ender > 0) active.push('ender')
      if (owned.table > 0) active.push('table')
    }
  }
  if (shields > 0) passive.push('shield')
  if ((me.coal ?? 0) > 0) passive.push('coal')
  if ((me.stick ?? 0) > 0) passive.push('stick')
  if ((me.poison ?? 0) > 0) passive.push('poison')
  return { active, passive }
}

/** 一格的数量（右下角的数）；煤炭、木棍是进度条，不写数。 */
export function countOf(me: Me, slot: Slot): number {
  const owned = me.items
  switch (slot) {
    case 'pickaxe': return me.chances
    case 'pick-h': return owned?.pick.h ?? 0
    case 'pick-v': return owned?.pick.v ?? 0
    case 'pick-x': return owned?.pick.x ?? 0
    case 'spyglass': return me.spyglasses ?? 0
    case 'shield': return me.shields ?? (me.shield ? 1 : 0)
    case 'coal': return me.coal ?? 0
    case 'stick': return me.stick ?? 0
    case 'poison': return me.poison ?? 0
    default: return owned?.[slot] ?? 0
  }
}

/** 镐子和附魔镐都用完了、手里也没有附魔台（换得到附魔镐）：这一局挖不动了（游戏站的 canDig）。 */
export function outOfPicks(me: Me) {
  const pick = me.items?.pick
  return me.chances <= 0 && (!pick || pick.h + pick.v + pick.x <= 0) && (me.items?.table ?? 0) <= 0
}
