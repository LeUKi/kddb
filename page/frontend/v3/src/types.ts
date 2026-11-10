// 游戏站给网页的数据（game/shared/rules.mjs 的 publicGame、privatePlayer）。
export type Kind = 'emerald' | 'diamond' | 'apple' | 'totem' | 'tnt' | 'pearl' | 'shield' | 'spyglass' | 'eye' | 'crystal'
  // 有道具栏的局（docs/V3_ITEMS.md §1）
  | 'coal' | 'stick' | 'map' | 'potion' | 'key' | 'vault' | 'deco' | 'lava' | 'debris' | 'cobweb' | 'spawner' | 'minecart' | 'ender'
/** 底栏“还剩”列的顺序（卡上没有的不列） */
export const KINDS: Kind[] = ['emerald', 'diamond', 'apple', 'debris', 'totem', 'tnt', 'crystal', 'spawner', 'cobweb', 'pearl', 'shield', 'spyglass', 'map', 'potion', 'key', 'minecart', 'ender', 'coal', 'stick', 'eye']
export const KIND_NAMES: Record<Kind, string> = {
  emerald: '绿宝石', diamond: '钻石', apple: '附魔金苹果', totem: '双铁镐',
  tnt: 'TNT', pearl: '末影珍珠', shield: '盾牌', spyglass: '望远镜', eye: '末影之眼', crystal: '末影水晶',
  coal: '煤炭', stick: '木棍', map: '藏宝图', potion: '急迫药水', key: '试炼钥匙', vault: '宝库', deco: '装饰',
  lava: '岩浆', debris: '远古残骸', cobweb: '蜘蛛网', spawner: '刷怪笼', minecart: '箱子矿车', ender: '末影箱',
}
/** 区块（docs/V3_ITEMS.md §2）：末地宝藏、试炼密室、废弃矿井、下界、深暗之域；普通卡没有 */
export type Biome = 'end' | 'trial' | 'mine' | 'nether' | 'deep'
export const BIOME_NAMES: Record<Biome, string> = { end: '末地宝藏', trial: '试炼密室', mine: '废弃矿井', nether: '下界', deep: '深暗之域' }
/** 火把：插在 at 那一格的左上角（四格相交处）；level 0 绿（4 格里没有危险）、1 黄（1–2 个）、2 红（3–4 个） */
export interface Torch { at: number; level: 0 | 1 | 2; name: string }
/** 附魔镐的形状 */
export type Shape = 'h' | 'v' | 'x'

/** burn：被岩浆吞掉的格子（uid 0），翻开给大家看一下，之后就是岩浆 */
export interface OpenCell { kind: Kind; uid: number; name: string; at: number; burn?: 1 }
export interface PublicCard {
  id: number; x: number; y: number; size: 3 | 5 | 6 | 7
  /** 区块；普通卡没有 */
  kind?: Biome
  /** 不能挖的格子（装饰、宝库、开局的岩浆），大家都看得见 */
  fixed?: Record<string, 'deco' | 'vault' | 'lava'>
  /** 宝库还能开几次 */
  vaults?: Record<string, number>
  /** 亮着的火把 */
  torches?: Torch[]
  /** 深暗之域的噪音；closed：监守者醒了，这张卡关了 */
  noise?: number
  closed?: boolean
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
  /** 2：末地宝藏每张随机配（2026-11-07 起开的局）；旧局没有 */
  endMix?: 2
  /** 1：道具栏、新格子和区块（docs/V3_ITEMS.md）；旧局没有 */
  items?: 1
  /** 多少秒不挖苦力怕会来；0 不来 */
  creeper?: number
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
  /** 有道具栏的局：几面盾牌、几个望远镜；旧局没有（盾牌只看 shield） */
  shields?: number; spyglasses?: number
  status: 'playing' | 'claimed'; lastResult: DigResult | null
  /** 还要等多少毫秒才能再挖（游戏站算好的，不受时钟差影响） */
  coolingMs?: number
  /** 有道具栏的局（docs/V3_ITEMS.md §4）：主动道具 */
  items?: { torch: number; map: number; potion: number; ender: number; table: number; key: number; pick: Record<Shape, number> }
  coal?: number; stick?: number; poison?: number
  /** 末影箱里存着的分（领取时一起算） */
  chest?: number
  /** 急迫药水还剩多少毫秒；蜘蛛网让下一次多等多少毫秒 */
  hasteMs?: number; slowMs?: number
  /** 手里有附魔台时，下一个附魔台给的两种 */
  tableChoices?: Shape[] | null
  /** 还有多少毫秒苦力怕来（不适用时 null） */
  creeperMs?: number | null
  /** 开过的宝库："卡号:格" */
  vaultsOpened?: string[]
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

/**
 * 实时推送（game/worker/room.mjs）：网页连推送时带 v=2，收第 2 版的 cell（只有变了的那一格）；
 * 第 1 版的 dig（整张卡）只有老的游戏站发，留着认。
 */
export interface LiveCell {
  type: 'cell'; seq: number; cardId: number; index: number; cell: OpenCell
  newCard: PublicCard | null; text: string; left: number; over: boolean; stats: Stats
  /** 有道具栏的局：这张卡的火把（变了颜色、灭了）、被岩浆吞掉的格子、噪音、监守者醒了 */
  torches?: Torch[]; burned?: { index: number; kind: Kind }[]; noise?: number; closed?: boolean
  vaults?: Record<string, number>
}
/** 火把插上、宝库开了：整张卡换一下（不带序号） */
export interface LiveCard { type: 'card'; card: PublicCard; left?: number; over?: boolean }
export interface LiveDig { type: 'dig'; seq: number; card: PublicCard; newCard: PublicCard | null; feed: FeedItem; left: number; over: boolean; stats: Stats }
export type LiveStep = LiveCell | LiveDig
export type Live = LiveStep | LiveCard | { type: 'claim'; name: string; points: number; stats: Stats }

/** 10000 → "100.00"。 */
export function money(points: number) {
  const abs = Math.abs(points)
  return `${points < 0 ? '-' : ''}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`
}
