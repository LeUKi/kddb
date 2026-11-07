// 推送、整局、单张卡怎么放进网页手上的整局（docs/V3_MAP.md §7）：纯函数，state.ts 和测试共用。
//
// 开格子只增不减，所以格子不管先后、不管序号接不接得上，先放上去（看得见），放过的不再放；
// 序号、动态、奖池、统计按序号一条条接，接不上的留在 ahead 里，等推送晚到的那条或者
// 找游戏站按序号补（GET /since）。手上的整局从不往回退：比手上旧的整局不要。
import type { FeedItem, Live, LiveStep, PublicCard, PublicGame } from './types'

export interface Merge {
  game: PublicGame
  /** 这次新放上去的格子（别人挖的闪一下） */
  opened: { cardId: number; index: number; uid: number }[]
  /** 这次长出来的卡（一批里有几张时是最后一张）、挖出它的那一格和谁挖的 */
  grown: { cardId: number; from: { cardId: number; index: number }; uid: number } | null
}

/**
 * 推送里的一段文字是哪几条：游戏站攒 100 毫秒发一次，第 2 版是一个数组（按序号）；
 * 单独一条的（以前的、回放里的）也认。看不懂的不要。
 */
export function liveMessages(text: string): Live[] {
  try {
    const data: unknown = JSON.parse(text)
    const list = Array.isArray(data) ? data : [data]
    return list.filter((item): item is Live => typeof item === 'object' && item !== null && typeof (item as { type?: unknown }).type === 'string')
  } catch {
    return []
  }
}

/** 一张卡开了几格。 */
export function openedCount(card: PublicCard) {
  let count = 0
  for (const cell of card.cells) if (cell) count += 1
  return count
}

/** 两份同一张卡开的是不是同样那些格子。 */
function sameOpened(a: PublicCard, b: PublicCard) {
  return a.cells.length === b.cells.length && a.cells.every((cell, index) => !cell === !b.cells[index])
}

/** 动态里的一条：第 2 版推送里没有，由那一格拼出来。 */
export function feedOf(step: LiveStep): FeedItem {
  if (step.type === 'dig') return step.feed
  return {
    seq: step.seq, uid: step.cell.uid, name: step.cell.name, kind: step.cell.kind, cardId: step.cardId,
    index: step.index, text: step.text, at: step.cell.at, newCardId: step.newCard?.id ?? null,
  }
}

const FEED_LIMIT = 30

/** 接上一条：序号、奖池、统计、动态。 */
function advance(game: PublicGame, step: LiveStep): PublicGame {
  return {
    ...game, seq: step.seq, left: step.left, over: step.over, stats: step.stats,
    feed: [feedOf(step), ...game.feed].slice(0, FEED_LIMIT),
  }
}

/** 推送放进整局；ahead（接不上的那些）原地改。 */
export function mergeLive(game: PublicGame, ahead: Map<number, LiveStep>, messages: Live[]): Merge {
  let cards: PublicCard[] | null = null
  let positions: Map<number, number> | null = null
  const position = () => (positions ??= new Map(game.cards.map((card, at) => [card.id, at])))
  const find = (id: number) => {
    const at = position().get(id)
    return at === undefined ? undefined : (cards ?? game.cards)[at]
  }
  const put = (card: PublicCard) => {
    cards ??= game.cards.slice()
    const at = position().get(card.id)
    if (at === undefined) {
      position().set(card.id, cards.length)
      cards.push(card)
    } else cards[at] = card
  }
  const opened: Merge['opened'] = []
  let grown: Merge['grown'] = null

  /** 格子和新卡先放上去（放过的不再放）。 */
  const show = (step: LiveStep) => {
    const cardId = step.type === 'dig' ? step.feed.cardId : step.cardId
    const index = step.type === 'dig' ? step.feed.index : step.index
    const uid = step.type === 'dig' ? step.feed.uid : step.cell.uid
    const card = find(cardId)
    if (step.type === 'dig') {
      // 第 1 版带整张卡：比手上的新才换
      if (!card || openedCount(step.card) > openedCount(card)) {
        put(step.card)
        if (!card?.cells[index] && step.card.cells[index]) opened.push({ cardId, index, uid })
      }
    } else if (card && !card.cells[index]) {
      const cells = card.cells.slice()
      cells[index] = step.cell
      const left = { ...card.left }
      const count = left[step.cell.kind]
      if (count !== undefined) left[step.cell.kind] = Math.max(0, count - 1)
      put({ ...card, cells, left, finished: cells.every(Boolean) })
      opened.push({ cardId, index, uid })
    }
    if (step.newCard && !find(step.newCard.id)) {
      put(step.newCard)
      grown = { cardId: step.newCard.id, from: { cardId, index }, uid }
    }
  }

  let next = game
  for (const message of messages) {
    if (message.type === 'claim') {
      next = { ...next, stats: message.stats }
      continue
    }
    show(message)
    if (message.seq <= next.seq) continue
    if (message.seq > next.seq + 1) {
      ahead.set(message.seq, message)
      continue
    }
    next = advance(next, message)
    for (let step = ahead.get(next.seq + 1); step; step = ahead.get(next.seq + 1)) {
      ahead.delete(step.seq)
      next = advance(next, step)
    }
  }
  for (const seq of ahead.keys()) if (seq <= next.seq) ahead.delete(seq)
  return { game: { ...next, cards: cards ?? next.cards }, opened, grown }
}

/**
 * 整局（认人、补不上时）：比手上的旧就不要（null）；开的格子没变的卡沿用手上那一份
 * （同一个对象：卡不重画，整张地图的画布也不重画）；最后把 ahead 里比它新的再放上去。
 */
export function mergeState(current: PublicGame | null, next: PublicGame, ahead: Map<number, LiveStep>): Merge | null {
  if (current && next.seq < current.seq) return null
  const before = new Map(current?.cards.map(card => [card.id, card]))
  const cards = next.cards.map(card => {
    const kept = before.get(card.id)
    return kept && kept.finished === card.finished && sameOpened(kept, card) ? kept : card
  })
  const rest = [...ahead.values()].filter(step => step.seq > next.seq).sort((a, b) => a.seq - b.seq)
  ahead.clear()
  return mergeLive({ ...next, cards }, ahead, rest)
}

/** 一张卡现在的样子（没挖成时游戏站给的）：比手上的开得多才换。 */
export function mergeCard(game: PublicGame, card: PublicCard): Merge {
  const before = game.cards.find(item => item.id === card.id)
  if (before && openedCount(before) >= openedCount(card)) return { game, opened: [], grown: null }
  const cards = before ? game.cards.map(item => (item.id === card.id ? card : item)) : [...game.cards, card]
  const opened = card.cells.flatMap((cell, index) => (cell && !before?.cells[index] ? [{ cardId: card.id, index, uid: cell.uid }] : []))
  return { game: { ...game, cards }, opened, grown: null }
}
