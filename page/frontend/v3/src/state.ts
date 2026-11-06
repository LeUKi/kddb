// 网页的状态和控制：连上游戏站、挖、领、收实时推送（docs/V3_MAP.md §6）。
import { atom, createStore } from 'jotai'
import type { HbHongbao } from '../../../hb'
import { ApiError, GameApi } from './api'
import type { DigResult, Live, Me, PublicCard, PublicGame } from './types'
import { money } from './types'

export const store = createStore()

export type Phase = 'starting' | 'login' | 'error' | 'ready'
export const phaseAtom = atom<Phase>('starting')
export const problemAtom = atom('')
export const gameAtom = atom<PublicGame | null>(null)
export const meAtom = atom<Me | null>(null)
export const blockedAtom = atom<string | null>(null)
export const hongbaoAtom = atom<HbHongbao | null>(null)
export const uidAtom = atom<number | null>(null)
/** 自己正在挖的格子："卡号:格" */
export const pendingAtom = atom<Record<string, true>>({})
/** 刚开出来的格子（自己的展示，别人的轻闪一下） */
export const freshAtom = atom<Record<string, { mine: boolean; at: number; result?: DigResult }>>({})
/** 新长出来的卡，镜头外时在屏幕边上指过去 */
export const newCardAtom = atom<{ cardId: number; at: number } | null>(null)
/** 请地图把镜头移到一张卡（动态、NEW 标记、自己的珍珠） */
export const focusRequestAtom = atom<{ cardId: number; at: number; dig?: boolean } | null>(null)
export const toastAtom = atom<{ text: string; tone: 'info' | 'good' | 'bad'; id: number } | null>(null)
export type Claiming = 'idle' | 'working' | 'filled' | 'done'
export const claimingAtom = atom<Claiming>('idle')
/** 红包站已经给他结算了：领到多少 */
export const settledAtom = atom<{ amount: string; unit: string } | null>(null)

let api: GameApi | null = null
let stopLive: (() => void) | null = null
let autoClaimed = false

const key = (cardId: number, index: number) => `${cardId}:${index}`

export function toast(text: string, tone: 'info' | 'good' | 'bad' = 'info') {
  store.set(toastAtom, { text, tone, id: Date.now() + Math.random() })
}

function setProblem(error: unknown) {
  store.set(problemAtom, error instanceof Error ? error.message : '矿洞出了点问题，稍后再试')
  store.set(phaseAtom, 'error')
}

/** 红包站上的结算情况：领到了就记下来。 */
function acceptMe(me: Awaited<ReturnType<typeof hb.me>>) {
  if (me.signedIn && me.claim) store.set(settledAtom, { amount: me.claim.amount, unit: me.claim.unit })
}

export async function start() {
  store.set(phaseAtom, 'starting')
  try {
    const { hongbao } = await hb.ready()
    store.set(hongbaoAtom, hongbao)
    hb.on('hongbao', next => store.set(hongbaoAtom, next))
    hb.on('me', acceptMe)
    const me = await hb.me()
    acceptMe(me)
    if (!me.signedIn) {
      store.set(phaseAtom, 'login')
      return
    }
    api = new GameApi(hongbao.id)
    const state = await api.hello()
    store.set(uidAtom, api.uid)
    apply(state.game, state.me, state.blocked)
    store.set(phaseAtom, 'ready')
    stopLive?.()
    stopLive = api.live(onLive, () => void refresh())
    window.setInterval(checkWrapUp, 5000)
  } catch (error) {
    setProblem(error)
  }
}

export async function signIn() {
  const result = await hb.login().catch(() => null)
  if (result?.signedIn) await start()
}

function apply(game: PublicGame, me: Me, blocked: string | null) {
  store.set(gameAtom, game)
  store.set(meAtom, me)
  store.set(blockedAtom, blocked)
}

/** 整张重读：连上推送时、漏了推送时。 */
export async function refresh() {
  if (!api) return
  try {
    const state = await api.state()
    apply(state.game, state.me, state.blocked)
  } catch {
    // 下次推送或重连时再读
  }
}

function replaceCard(cards: PublicCard[], card: PublicCard) {
  const at = cards.findIndex(item => item.id === card.id)
  if (at < 0) return [...cards, card]
  const next = cards.slice()
  next[at] = card
  return next
}

/** 一条推送（或自己挖的那次的变化）：按序号接上，漏了就整张重读。 */
function onLive(message: Live) {
  const game = store.get(gameAtom)
  if (!game) return
  if (message.type === 'claim') {
    store.set(gameAtom, { ...game, stats: message.stats })
    return
  }
  if (message.seq <= game.seq) return
  if (message.seq > game.seq + 1) {
    void refresh()
    return
  }
  let cards = replaceCard(game.cards, message.card)
  if (message.newCard) cards = replaceCard(cards, message.newCard)
  store.set(gameAtom, {
    ...game, seq: message.seq, cards, left: message.left, over: message.over, stats: message.stats,
    feed: [message.feed, ...game.feed].slice(0, 30),
  })
  const mine = message.feed.uid === store.get(uidAtom)
  if (!mine) {
    const cell = key(message.feed.cardId, message.feed.index)
    store.set(freshAtom, value => ({ ...value, [cell]: { mine: false, at: Date.now() } }))
  }
  // 新卡（谁挖出来的都一样）：地图上长出来，不在画面里就在边上提醒，镜头不动
  if (message.newCard) store.set(newCardAtom, { cardId: message.newCard.id, at: Date.now() })
  if (message.over && store.get(meAtom)?.status === 'playing') void claim(true)
}

/** 挖一格。 */
export async function dig(cardId: number, index: number) {
  const cell = key(cardId, index)
  if (!api || store.get(pendingAtom)[cell]) return
  const blocked = store.get(blockedAtom)
  if (blocked) {
    toast(blocked)
    return
  }
  store.set(pendingAtom, value => ({ ...value, [cell]: true }))
  try {
    const answer = await api.dig(cardId, index)
    store.set(meAtom, answer.me)
    if (!answer.ok) {
      toast(answer.message)
      void refresh()
      return
    }
    onLive({ ...(answer as unknown as { update: Live }).update })
    store.set(freshAtom, value => ({ ...value, [cell]: { mine: true, at: Date.now(), result: answer.result } }))
    if (answer.claimNow) window.setTimeout(() => void claim(true), 1200)
  } catch (error) {
    toast(error instanceof ApiError ? error.message : '没挖成，稍后再试', 'bad')
  } finally {
    store.set(pendingAtom, value => {
      const next = { ...value }
      delete next[cell]
      return next
    })
  }
}

/**
 * 领取：游戏站签凭证，网页交给判定器（hb.submit）。交不上就填进指令框，
 * 他自己点提交。auto 是机会用完、预算分完、快截止时自动领的。
 */
export async function claim(auto = false) {
  if (!api || store.get(claimingAtom) === 'working' || store.get(settledAtom)) return
  if (auto) {
    if (autoClaimed) return
    autoClaimed = true
  }
  store.set(claimingAtom, 'working')
  try {
    const answer = await api.claim()
    store.set(meAtom, answer.me)
    if (!answer.ok) {
      toast(answer.message, 'bad')
      store.set(claimingAtom, 'idle')
      return
    }
    const result = await hb.submit(answer.voucher)
    if (result.judged && result.claimed) {
      store.set(settledAtom, { amount: result.amount, unit: result.unit })
      store.set(claimingAtom, 'done')
      return
    }
    if (result.judged) {
      toast(result.reply ?? '没领到', 'bad')
      store.set(claimingAtom, 'idle')
      return
    }
    // 没交上（没允许、正忙、冷却……）：填进指令框，让他自己点
    const filled = await hb.fill(answer.voucher).catch(() => ({ filled: false as const }))
    store.set(claimingAtom, filled.filled ? 'filled' : 'idle')
    toast(filled.filled ? `领取凭证（${money(answer.points)}）已填进指令框，点「提交」领取` : (result.message ?? '没交上，再点一次「领取」'), filled.filled ? 'info' : 'bad')
  } catch (error) {
    toast(error instanceof Error ? error.message : '没领成，再试一次', 'bad')
    store.set(claimingAtom, 'idle')
  }
}

/** 截止前 2 分钟停止挖掘：开着网页的人自动领。 */
function checkWrapUp() {
  const game = store.get(gameAtom)
  const me = store.get(meAtom)
  if (!game || !me || me.status !== 'playing' || game.wrapUpAt === null) return
  if (hb.now() >= game.wrapUpAt) {
    if (!store.get(blockedAtom)) store.set(blockedAtom, '快截止了，已经停止挖掘，请领取')
    void claim(true)
  }
}

export function stop() {
  stopLive?.()
  stopLive = null
}
