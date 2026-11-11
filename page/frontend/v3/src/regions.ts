// 卡周围的说明（docs/V3_ITEMS.md §9）：区块叫什么、点问号看的说明、卡下面的余量和深暗之域的噪音。
// 纯函数，网页和测试共用。
import type { IconKind } from '../../src/game'
import type { Kind, PublicCard, Rules } from './types'
import { BIOME_NAMES } from './types'

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

/** 余量里列出来的“宝贝”：钱和长卡的东西。TNT、蜘蛛网、刷怪笼、绿宝石、煤炭木棍不列（劝退、太长）。 */
export const TREASURES: Kind[] = ['diamond', 'apple', 'debris', 'pearl', 'eye']
/** 合成一项“道具 N”的：能拿进工具条或帮上忙的。 */
export const GOODS: Kind[] = ['shield', 'spyglass', 'totem', 'map', 'potion', 'key', 'minecart', 'ender']

/** 卡下面的余量：还没挖到的宝贝（各几个）、道具一共几个（和最多四个图标）。 */
export function leftoversOf(card: Pick<PublicCard, 'left'>) {
  const treasures = TREASURES.flatMap(kind => ((card.left[kind] ?? 0) > 0 ? [{ kind, count: card.left[kind] ?? 0 }] : []))
  const goods = GOODS.filter(kind => (card.left[kind] ?? 0) > 0)
  const goodsCount = goods.reduce((sum, kind) => sum + (card.left[kind] ?? 0), 0)
  return { treasures, goods: goods.slice(0, 4), goodsCount }
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
