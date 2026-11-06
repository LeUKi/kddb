// 游戏站给网页的数据（game/shared/rules.mjs 的 publicGame、privatePlayer）。
export type Kind = 'emerald' | 'diamond' | 'apple' | 'totem' | 'tnt' | 'pearl' | 'shield' | 'spyglass' | 'eye' | 'crystal'
export const KINDS: Kind[] = ['emerald', 'diamond', 'apple', 'totem', 'tnt', 'pearl', 'shield', 'spyglass', 'eye', 'crystal']
export const KIND_NAMES: Record<Kind, string> = {
  emerald: '绿宝石', diamond: '钻石', apple: '附魔金苹果', totem: '双铁镐',
  tnt: 'TNT', pearl: '末影珍珠', shield: '盾牌', spyglass: '望远镜', eye: '末影之眼', crystal: '末影水晶',
}

export interface OpenCell { kind: Kind; uid: number; name: string; at: number }
export interface PublicCard {
  id: number; x: number; y: number; size: 3 | 5 | 6 | 7
  /** 末影之眼开出来的末地宝藏卡 */
  kind?: 'end'
  cells: (OpenCell | null)[]
  /** 旧局的卡没有 eye 这一项 */
  left: Partial<Record<Kind, number>>
  finished: boolean
}
export interface FeedItem {
  seq: number; uid: number; name: string; kind: Kind; cardId: number; index: number
  text: string; at: number; newCardId: number | null
}
export interface Stats { digs: number; players: number; claimed: number; claimedPoints: number }
export interface Rules {
  difficulty: 'easy' | 'normal' | 'tough' | 'hard' | 'hell'; smallReward: number; tntPercent: number
  initialChances: number; appleCap: number; totemBonus: number; bigMultiplier: number
  /** 每几张普通卡一颗末影之眼；0 不开；旧局没有 */
  eyeEvery?: number
  /** 按大约多少人算的绿宝石（新判定器）；旧局没有 */
  players?: number
  /** 每人两次挖掘至少隔几秒；旧局没有，是 1 */
  digInterval?: number
}
export interface PublicGame {
  seq: number; rules: Rules; pool: number; left: number
  deadlineAt: number | null; wrapUpAt: number | null; over: boolean
  stats: Stats; cards: PublicCard[]; feed: FeedItem[]
}
export interface Peek { cardId: number; index: number; kind: Kind }
export interface DigResult {
  kind: Kind; cardId: number; index: number; amount: number
  blocked: boolean; text: string; newCardId: number | null
}
export interface Me {
  chances: number; shield: boolean; peeks: Peek[]; points: number; digs: number
  status: 'playing' | 'claimed'; lastResult: DigResult | null
  /** 还要等多少毫秒才能再挖（游戏站算好的，不受时钟差影响） */
  coolingMs?: number
}
export interface State { game: PublicGame; me: Me; blocked: string | null }

/** 逐格记录：挖到什么（k）、这一格加减多少分（a）、挖完手里多少分（p）、盾牌挡住了（b）。 */
export interface Step { k: Kind; a: number; p: number; b?: 1 }
export interface TopEntry { uid: number; name: string; points: number }
/** 收益卡（game/shared/rules.mjs 的 summaryOf）。 */
export interface Summary {
  me: {
    name: string; status: 'playing' | 'claimed'; points: number; digs: number
    /** 开始记录以前就来过的人没有 */
    trail: Step[] | null
    best: number; tnt: number; blocked: number; lost: number
  }
  top: TopEntry[]
  stats: Stats; pool: number; left: number; over: boolean
}

/** 实时推送（game/worker/room.mjs 的 broadcast）。 */
export type Live =
  | { type: 'dig'; seq: number; card: PublicCard; newCard: PublicCard | null; feed: FeedItem; left: number; over: boolean; stats: Stats }
  | { type: 'claim'; name: string; points: number; stats: Stats }

/** 10000 → "100.00"。 */
export function money(points: number) {
  const abs = Math.abs(points)
  return `${points < 0 ? '-' : ''}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`
}
