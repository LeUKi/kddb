export const kinds = ['emerald', 'diamond', 'apple', 'totem', 'tnt', 'pearl', 'shield', 'spyglass'] as const
export type Kind = typeof kinds[number]
export type IconKind = Kind | 'pickaxe' | 'ore' | 'chest'

export const loot: Record<Kind, { name: string; short: string; color: string; count: number; description: string }> = {
  emerald: { name: '绿宝石', short: '小奖励', color: '#8ad6a2', count: 10, description: '获得一份小奖励' },
  diamond: { name: '钻石', short: '大奖励', color: '#8cd9e5', count: 3, description: '获得小奖励的 5 倍' },
  apple: { name: '附魔金苹果', short: '奖励翻倍', color: '#edc96d', count: 1, description: '当前待结算翻倍；余额为零时给小奖励' },
  totem: { name: '双铁镐', short: '机会 +3', color: '#b7d477', count: 2, description: '额外增加 3 次挖掘机会，无累计限制' },
  tnt: { name: 'TNT', short: '比例扣除', color: '#ee9d88', count: 4, description: '扣除当前待结算奖励的一定比例' },
  pearl: { name: '末影珍珠', short: '全体换卡', color: '#b0a3dd', count: 2, description: '所有人一起进入下一张卡片' },
  shield: { name: '盾牌', short: '抵挡 TNT', color: '#d5b89a', count: 2, description: '自动抵挡一次 TNT；已有盾牌则给小奖励' },
  spyglass: { name: '望远镜', short: '私密情报', color: '#d5bc84', count: 1, description: '只有你能提前看见一个未开格子的内容' },
}

export interface Rules {
  initialChances: number
  waitSeconds: number
  smallReward: number
  bigMultiplier: number
  totemBonus: number
  tntPercent: number
}

export interface Cell { index: number; kind: Kind | null; by: string | null; at: number | null; actorKey?: string }
export interface FeedItem { id: number; actor: string; kind: Kind; text: string; at: number; cardId: number; index: number }
export interface PublicGame {
  version: 1
  cardId: number
  cells: Cell[]
  counts: Record<Kind, number>
  rules: Rules
  lastMove: { actorKey: string; name: string; at: number; cardId: number; index: number } | null
  stats: { digs: number; players: number }
  feed: FeedItem[]
}
export interface LastResult { kind: Kind; cardId: number; index: number; amount: number; blocked: boolean; text: string }
export interface PrivateGame {
  version: 1
  actorKey: string
  chances: number
  shield: boolean
  peeks: { cardId: number; index: number; kind: Kind }[]
  digs: number
  status: 'playing' | 'settled'
  lastResult: LastResult | null
}

export const defaultRules: Rules = { initialChances: 7, waitSeconds: 10, smallReward: 10, bigMultiplier: 5, totemBonus: 3, tntPercent: 25 }
export const formatMoney = (cents: number) => (cents / 100).toFixed(2)
export const coordinate = (index: number) => `${String.fromCharCode(65 + Math.floor(index / 5))}${index % 5 + 1}`
export function isOwnCell(cell: Cell, cardId: number, own: PrivateGame | null): boolean {
  if (!own || cell.kind === null) return false
  if (cell.actorKey !== undefined) return cell.actorKey === own.actorKey
  // Older judges only persist a display name per cell. The private lastResult
  // still proves this one dig; matching names alone cannot prove ownership.
  const result = own.lastResult
  return Boolean(result && result.cardId === cardId && result.index === cell.index && result.kind === cell.kind)
}
export const isKind = (value: unknown): value is Kind => typeof value === 'string' && kinds.includes(value as Kind)
const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

// The SDK payload is external data. Reject incompatible pages instead of inventing a board.
export function readPublic(value: unknown): PublicGame | null {
  if (!object(value) || value.version !== 1 || !Number.isInteger(value.cardId) || !Array.isArray(value.cells) || value.cells.length !== 25) return null
  if (!value.cells.every((cell, index) => object(cell) && cell.index === index && (cell.kind === null || isKind(cell.kind)) && (cell.by === null || typeof cell.by === 'string') && (cell.at === null || typeof cell.at === 'number') && (cell.actorKey === undefined || typeof cell.actorKey === 'string') && (cell.kind !== null || cell.actorKey === undefined))) return null
  if (!object(value.counts) || !kinds.every(kind => typeof (value.counts as Record<string, unknown>)[kind] === 'number')) return null
  if (!object(value.rules) || !Object.keys(defaultRules).every(key => typeof (value.rules as Record<string, unknown>)[key] === 'number')) return null
  if (!object(value.stats) || typeof value.stats.digs !== 'number' || typeof value.stats.players !== 'number' || !Array.isArray(value.feed)) return null
  return value as unknown as PublicGame
}

export function readPrivate(value: unknown): PrivateGame | null {
  if (!object(value) || value.version !== 1 || typeof value.actorKey !== 'string' || !Number.isInteger(value.chances) || typeof value.shield !== 'boolean' || !Array.isArray(value.peeks) || typeof value.digs !== 'number') return null
  if (value.status !== 'playing' && value.status !== 'settled') return null
  return value as unknown as PrivateGame
}
