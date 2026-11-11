// 道具（docs/V3_ITEMS.md §3）：工具条上每一格是什么、怎么用，和对格子用的道具点到哪几格。
// 纯数据和纯函数，网页和测试共用。
import type { IconKind } from '../../src/game'
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

/** 每一格画什么图标（附魔镐是镐子加形状小图） */
export const SLOT_ICONS: Record<Slot, IconKind> = {
  pickaxe: 'pickaxe', 'pick-h': 'pickaxe', 'pick-v': 'pickaxe', 'pick-x': 'pickaxe', spyglass: 'spyglass', torch: 'torch', key: 'key',
  map: 'map', potion: 'potion', ender: 'ender', table: 'table', shield: 'shield', coal: 'coal', stick: 'stick', poison: 'spawner',
}

/**
 * 道具分五类（docs/ITEM_UX.md §2），类决定点了以后走哪个流程：瞄准（引导 → 选位置）、即用（确认弹窗）、
 * 抉择（专属弹窗）、被动（说明弹窗）、基础（镐子）。
 */
export type ItemClass = 'aim' | 'instant' | 'choice' | 'passive' | 'base'
export function classOf(slot: Slot): ItemClass {
  const use = SLOT_USE[slot]
  return use === 'base' ? 'base' : use === 'confirm' ? 'instant' : use === 'dialog' ? 'choice' : use === 'passive' ? 'passive' : 'aim'
}

/**
 * 道具登记表（docs/ITEM_UX.md §6）：弹窗右上角的数量、一两句它做什么；瞄准类还有点什么、步骤条上的一句。
 * 新道具在这里加一行，工具条、弹窗、步骤条都照着它画。
 */
export function aboutSlot(slot: Slot, me: Me, items: boolean, interval: number, blocked: string | null): { count: string; words: string } {
  const count = countOf(me, slot)
  switch (slot) {
    case 'pickaxe': return { count: `还剩 ${me.chances} 次`, words: blocked ?? `点一格没挖开的格子就是挖，用 1 次机会${interval > 1 ? `；每次至少隔 ${interval} 秒` : ''}。` }
    case 'pick-h': case 'pick-v': case 'pick-x': return { count: `还能用 ${count} 次`, words: `一次挖开${SHAPE_NAMES[shapeOf(slot)!]}里没挖开的格子，挖过的跳过；不花镐子的机会。` }
    case 'spyglass': return { count: `还有 ${count} 个`, words: '看一格里是什么，只有你看得见，不花机会。' }
    case 'torch': return { count: `还有 ${count} 个`, words: '插在两格之间的缝上，照亮旁边 4 格：绿色是没有危险，黄色 1～2 个，红色 3～4 个（TNT、末影水晶、刷怪笼）。大家都看得见。' }
    case 'key': return { count: `还有 ${count} 把`, words: '点试炼密室里的宝库开它，开出一样东西；每个宝库每人只能开一次。' }
    case 'map': return { count: `还有 ${count} 张`, words: '随机标出地图上一格奖励（绿宝石常见，钻石少见），只有你看得见，镜头会飞过去。' }
    case 'potion': return { count: `还有 ${count} 瓶`, words: '用了以后 10 秒里，每次挖只要隔 1 秒。' }
    case 'ender': return { count: `还有 ${count} 个`, words: '手上的奖励一半存进去（炸不到），一半毁掉。' }
    case 'table': return { count: `还有 ${count} 个`, words: '随机给两种附魔镐，挑一种。' }
    case 'shield': return { count: `${count}/${items ? SHIELD_CAP : 1} 面`, words: `踩到 TNT 或末影水晶时自动挡下一次，用掉一面。${items ? `最多带 ${SHIELD_CAP} 面，再挖到换成一份小奖。` : '再挖到就换成一份小奖。'}` }
    case 'coal': case 'stick': return { count: `${count}/${CRAFT_NEED}`, words: `煤炭、木棍都攒满 ${CRAFT_NEED} 个，自动做成一个火把；满了再挖到不算。` }
    case 'poison': return { count: `还有 ${count} 次`, words: '接下来每挖一次，扣手上 5%，盾牌挡不住。' }
  }
}

/** 瞄准类：在地图上点什么（步骤条上没预览时的那一句）。 */
export const AIM_WHAT: Record<Held, string> = {
  'pick-h': '点一格，框住的格子一起挖开', 'pick-v': '点一格，框住的格子一起挖开', 'pick-x': '点一格，框住的格子一起挖开',
  spyglass: '点一格，看看里面是什么', torch: '点两格之间的缝，照亮旁边 4 格', key: '点试炼密室里的宝库',
}
/** 瞄准类：点的是什么（引导弹窗里“怎么用”那句） */
export const AIM_TARGET: Record<Held, string> = { 'pick-h': '格子', 'pick-v': '格子', 'pick-x': '格子', spyglass: '格子', torch: '缝', key: '宝库' }

/** 有鼠标（指着就能预览）还是触屏（点一下预览） */
export const hasMouse = () => typeof window !== 'undefined' && !!window.matchMedia?.('(hover: hover) and (pointer: fine)').matches

/**
 * 瞄准类的引导弹窗（docs/ITEM_UX.md §4）：每次使用都先弹，选了“不再提示”就直接进入选位置；
 * 步骤条上的问号随时能再打开。三种附魔镐算一种。记在这台设备上（存不了就照旧弹，不影响玩）。
 */
const SKIP_KEY = 'kddb:v3:skip-guide'
const guideGroup = (slot: Held) => (shapeOf(slot) ? 'pick' : slot)
function skipList(): string[] {
  try {
    const list: unknown = JSON.parse(localStorage.getItem(SKIP_KEY) ?? '[]')
    return Array.isArray(list) ? list.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}
export const skipsGuide = (slot: Held) => skipList().includes(guideGroup(slot))
export function skipGuide(slot: Held) {
  try {
    const list = skipList()
    if (!list.includes(guideGroup(slot))) localStorage.setItem(SKIP_KEY, JSON.stringify([...list, guideGroup(slot)]))
  } catch {
    // 存不了：下次照旧弹引导
  }
}

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
