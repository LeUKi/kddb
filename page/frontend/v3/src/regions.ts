// 卡周围的说明（docs/V3_ITEMS.md §9）：区块叫什么、点问号看的说明、卡下面的余量和深暗之域的噪音。
// 纯函数，网页和测试共用。
import type { IconKind } from '../../src/game'
import type { Kind, PublicCard, Rules } from './types'
import { BIOME_NAMES, currentStep, decimalsOf, stepMinor } from './types'

/** 卡上面那一行的名字：区块名，普通卡是第几张。 */
export const regionName = (card: Pick<PublicCard, 'id' | 'kind'>) => (card.kind ? BIOME_NAMES[card.kind] : `第 ${card.id} 张卡`)

/** 说明弹窗的图标。 */
export function regionIcon(card: Pick<PublicCard, 'kind'>): IconKind {
  switch (card.kind) {
    case 'trial': return 'vault'
    case 'mine': return 'minecart'
    case 'nether': return 'debris'
    case 'deep': return 'sculk'
    case 'end': return 'eye'
    default: return 'pickaxe'
  }
}

/** 点区块名字旁边的问号看的说明（一两段，大白话）。 */
export function regionAbout(card: Pick<PublicCard, 'kind'>, rules: Pick<Rules, 'items' | 'tntPercent'>): string[] {
  const cobweb = (rules.items ?? 0) >= 2 ? 10 : 5
  switch (card.kind) {
    case 'trial': return [
      '四角和正中的凝灰岩是装饰，不能挖。中间偏左、偏右各有一个宝库：用试炼钥匙点它可以打开一次，开出小奖、钻石、附魔台或盾牌。每个宝库每人只能开一次，一共能开 4 次。',
      '这张卡里有 2 把试炼钥匙，普通的卡里也偶尔有。',
    ]
    case 'mine': return [
      `中间一行的铁轨是装饰，不能挖。这里有蜘蛛网（下一次挖要多等 ${cobweb} 秒）、刷怪笼（中毒，之后 3 次每挖一次扣待领取的 5%）和箱子矿车（小奖、火把或藏宝图），煤炭和木棍也多。`,
    ]
    case 'nether': return [
      '岩浆开局就看得见，不能挖。这张卡上每挖开 3 格，岩浆往旁边流一格，吞掉的格子就没了，里面的奖励留在奖池里。',
      '远古残骸烧不掉，一个值 10 份小奖。',
    ]
    case 'deep': return [
      '钻石最多（8 颗）。每挖开一格，噪音加一，大家共用一个数。',
      '噪音进了危险区，每挖一格都可能惊醒监守者：挖出这一下的人，待领取的奖励扣掉一半（盾牌挡不住，末影箱里的不算），这张卡关掉，剩下的格子谁也挖不了。',
    ]
    case 'end': return [
      '末影之眼开出来的宝藏，3×3。钻石多，也藏着末影水晶：踩中扣掉待领取的两倍 TNT 的比例。这里不会再长新卡。',
    ]
    default: return [
      `普通的卡：绿宝石、钻石、附魔金苹果，也有 TNT（扣待领取的 ${rules.tntPercent}%）。挖到末影珍珠，旁边会长出一张新卡。`,
    ]
  }
}

/**
 * 余量（docs/V3_ITEMS.md §9，2026-11-11 用户选的“按第 9 节全做”）：不报“还剩几个”（只剩一个反而劝退），
 * 报这张卡还藏着多少钱、有哪几样宝贝（几个用原版乱码盖住），挖得差不多了就指去最富的那张。
 * 钱只按大家本来就看得到的余量算，没多给信息。
 */

/** 每样东西大约值几份小奖：钻石按规则的倍数；附魔金苹果让手上的翻倍（有上限），按 3 份；箱子矿车一半是 2～4 份小奖。 */
export function worthEach(rules: Pick<Rules, 'bigMultiplier'>): Partial<Record<Kind, number>> {
  return { emerald: 1, diamond: rules.bigMultiplier || 5, debris: 10, apple: 3, minecart: 1.5 }
}

/** 一张卡还藏着多少钱（和奖池一样的单位，整数）：不超过奖池剩下的。 */
export function worthOf(card: Pick<PublicCard, 'left'>, rules: Pick<Rules, 'smallReward' | 'bigMultiplier'>, poolLeft: number) {
  const each = worthEach(rules)
  let small = 0
  for (const [kind, worth] of Object.entries(each) as [Kind, number][]) small += (card.left[kind] ?? 0) * worth
  return Math.max(0, Math.min(Math.round(small * rules.smallReward), poolLeft))
}

/** “还藏着约 X”：1 以上取一位小数，不到 1 取两位（10000 → "100.0"，85 → "0.85"）。 */
export function aboutMoney(points: number) {
  // 按这个红包的最小单位换成分再估（三方积分红包是多少个最小单位，docs/V3_ITEMS.md §11）；整数的积分只写整数
  const minor = points * stepMinor(currentStep())
  if (decimalsOf(currentStep()) === 0) return String(Math.round(minor / 100))
  return minor >= 100 ? (Math.round(minor / 10) / 10).toFixed(1) : (minor / 100).toFixed(2)
}

/** 卡下面列出来的宝贝（最多 4 样，按这个先后）：值钱的、能长出新卡的。 */
export const TREASURES: Kind[] = ['debris', 'diamond', 'apple', 'eye', 'pearl', 'minecart', 'emerald']

/** 还没挖完、没关的卡。 */
const open = (card: Pick<PublicCard, 'finished' | 'closed'>) => !card.finished && !card.closed

/** 这张卡算挖得差不多了：挖完、关了，或者藏着的不到 2 份小奖。 */
export const poorCard = (card: Pick<PublicCard, 'finished' | 'closed'>, worth: number, rules: Pick<Rules, 'smallReward'>) =>
  !open(card) || worth < rules.smallReward * 2

/** 卡下面那一行：还藏着多少钱、有哪几样宝贝。 */
export function leftoversOf(card: Pick<PublicCard, 'left' | 'finished' | 'closed'>, rules: Pick<Rules, 'smallReward' | 'bigMultiplier'>, poolLeft: number) {
  const worth = worthOf(card, rules, poolLeft)
  const kinds = TREASURES.filter(kind => (card.left[kind] ?? 0) > 0).slice(0, 4)
  return { worth, kinds, poor: poorCard(card, worth, rules) }
}

/** 最富的那张（不算 except，不算挖得差不多的）；没有就是 null。 */
export function richestOf(cards: PublicCard[], rules: Pick<Rules, 'smallReward' | 'bigMultiplier'>, poolLeft: number, except?: number) {
  let best: { card: PublicCard; worth: number } | null = null
  for (const card of cards) {
    if (card.id === except || !open(card)) continue
    const worth = worthOf(card, rules, poolLeft)
    if (poorCard(card, worth, rules)) continue
    if (!best || worth > best.worth) best = { card, worth }
  }
  return best
}

/**
 * 地图上越富越亮（静止的金光，三档）：和最富的那张比，三分之二以上 3 档，三分之一以上 2 档，
 * 别的 1 档；挖得差不多的不亮。只给有亮光的卡（键是卡号）。
 */
export function richnessOf(cards: PublicCard[], rules: Pick<Rules, 'smallReward' | 'bigMultiplier'>, poolLeft: number) {
  const worths = new Map<number, number>()
  for (const card of cards) {
    const worth = worthOf(card, rules, poolLeft)
    if (!poorCard(card, worth, rules)) worths.set(card.id, worth)
  }
  const most = Math.max(0, ...worths.values())
  const levels = new Map<number, 1 | 2 | 3>()
  for (const [id, worth] of worths) levels.set(id, worth * 3 > most * 2 ? 3 : worth * 3 > most ? 2 : 1)
  return levels
}

/**
 * 深暗之域的噪音条：危险区是这张卡格子数的 45%–75%（监守者在这中间某一下醒来，开局由种子定，
 * 不公开）。safe：还没进危险区，再挖几格进；cells：能挖的格子数。
 */
export function noiseOf(card: Pick<PublicCard, 'cells' | 'fixed' | 'noise' | 'closed'>) {
  const cells = card.cells.length - Object.keys(card.fixed ?? {}).length
  const low = Math.ceil(cells * 0.45)
  const high = Math.floor(cells * 0.75)
  const noise = card.noise ?? 0
  return { noise, low, high, cells, danger: noise >= low, closed: !!card.closed, toDanger: Math.max(0, low - noise) }
}
