// 网页的状态和控制：连上游戏站、挖、领、收实时推送（docs/V3_MAP.md §6）。
import { atom, createStore } from 'jotai'
import type { HbHongbao } from '../../../hb'
import { ApiError, GameApi } from './api'
import { landMs } from './PearlFlight'
import { play, soundOfResult } from './sound'
import type { DigResult, Live, Me, PublicCard, PublicGame } from './types'
import { money } from './types'

export const store = createStore()

export type Phase = 'starting' | 'login' | 'error' | 'ready'
export const phaseAtom = atom<Phase>('starting')
export const problemAtom = atom('')
export const gameAtom = atom<PublicGame | null>(null)
export const meAtom = atom<Me | null>(null)
export const blockedAtom = atom<string | null>(null)
/** 什么时候（本机时间，毫秒）能再挖：游戏站给的 coolingMs 加上收到的时刻 */
export const readyAtAtom = atom(0)
export const hongbaoAtom = atom<HbHongbao | null>(null)
export const uidAtom = atom<number | null>(null)
/** 自己正在挖的格子："卡号:格" */
export const pendingAtom = atom<Record<string, true>>({})
/** 刚开出来的格子（自己的展示，别人的轻闪一下） */
export const freshAtom = atom<Record<string, { mine: boolean; at: number; result?: DigResult }>>({})
/** 新长出来的卡，镜头外时在屏幕边上指过去 */
/** 刚长出来的卡，和挖出它的那颗珍珠在哪一格（入场动画从那里飞过去）。 */
export const newCardAtom = atom<{ cardId: number; at: number; from: { cardId: number; index: number } } | null>(null)
/** 请地图把镜头移到一张卡（动态、NEW 标记、自己的珍珠） */
export const focusRequestAtom = atom<{ cardId: number; at: number; dig?: boolean } | null>(null)
export const toastAtom = atom<{ text: string; tone: 'info' | 'good' | 'bad'; id: number } | null>(null)
export type Claiming = 'idle' | 'working' | 'filled' | 'done'
export const claimingAtom = atom<Claiming>('idle')
/** 红包站已经给他结算了：领到多少 */
export const settledAtom = atom<{ amount: string; unit: string } | null>(null)
/** 收益卡开着：他点开的（button），或者这一局对他结束了自动弹的（end） */
export const summaryOpenAtom = atom<'button' | 'end' | null>(null)

let api: GameApi | null = null
let stopLive: (() => void) | null = null
let autoClaimed = false
/** 结束时的弹窗每次打开网页只弹一次 */
let endShown = false

/** 收益卡的数据（打开时才要）。 */
export function loadSummary() {
  if (!api) return Promise.reject(new Error('还没连上矿洞'))
  return api.summary()
}

/** 这一局对他结束了（领到了、奖池分完或机会用完而手里没有分）：弹一次收益卡。 */
function showEnd() {
  if (endShown) return
  endShown = true
  store.set(summaryOpenAtom, 'end')
}

/** 刚开出来的格子，只留最近 3 秒的（闪一下、飘字都在这之内），不让它越攒越大。 */
const FRESH_MS = 3000
function addFresh(entries: Record<string, { mine: boolean; at: number; result?: DigResult }>) {
  store.set(freshAtom, value => {
    const now = Date.now()
    const next: typeof value = {}
    for (const [cell, entry] of Object.entries(value)) if (now - entry.at < FRESH_MS) next[cell] = entry
    return Object.assign(next, entries)
  })
}

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
  setMe(me)
  store.set(blockedAtom, blocked)
}

function setMe(me: Me) {
  store.set(meAtom, me)
  if (me.coolingMs !== undefined) store.set(readyAtAtom, Date.now() + me.coolingMs)
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

/**
 * 实时推送：攒到下一帧一起放进去（几十个人一起挖时一秒几十条，一条一渲染手机跟不上）。
 * 网页在后台时动画帧不跑，另有一个定时器兜底。
 */
let liveQueue: Live[] = []
let liveFrame = 0
let liveTimer: ReturnType<typeof setTimeout> | undefined
function onLive(message: Live) {
  liveQueue.push(message)
  if (liveFrame) return
  liveFrame = requestAnimationFrame(flushLive)
  liveTimer = setTimeout(flushLive, 150)
}

function flushLive() {
  cancelAnimationFrame(liveFrame)
  clearTimeout(liveTimer)
  liveFrame = 0
  const queue = liveQueue
  liveQueue = []
  if (queue.length > 0) applyLive(queue)
}

/** 按序号一条条接上（漏了就整张重读），最后只设一次状态。 */
function applyLive(messages: Live[]) {
  let game = store.get(gameAtom)
  if (!game) return
  const uid = store.get(uidAtom)
  const now = Date.now()
  let cards: PublicCard[] | null = null
  const put = (card: PublicCard) => {
    cards ??= game!.cards.slice()
    const at = cards.findIndex(item => item.id === card.id)
    if (at < 0) cards.push(card)
    else cards[at] = card
  }
  const fresh: Record<string, { mine: boolean; at: number }> = {}
  let grown: { cardId: number; at: number; from: { cardId: number; index: number } } | null = null
  let missed = false
  for (const message of messages) {
    if (message.type === 'claim') {
      game = { ...game, stats: message.stats }
      continue
    }
    if (message.seq <= game.seq) continue
    if (message.seq > game.seq + 1) {
      missed = true
      break
    }
    put(message.card)
    if (message.newCard) put(message.newCard)
    game = {
      ...game, seq: message.seq, cards: cards ?? game.cards, left: message.left, over: message.over, stats: message.stats,
      feed: [message.feed, ...game.feed].slice(0, 30),
    }
    const mine = message.feed.uid === uid
    if (!mine) fresh[key(message.feed.cardId, message.feed.index)] = { mine: false, at: now }
    // 新卡（谁挖出来的都一样）：地图上长出来，不在画面里就在边上提醒，镜头不动
    if (message.newCard) {
      grown = { cardId: message.newCard.id, at: now, from: { cardId: message.feed.cardId, index: message.feed.index } }
      // 别人挖到末影之眼：末地宝藏开了，大家都听得见（轻一些）
      if (!mine && message.newCard.kind === 'end') play('portal', { volume: 0.6, delay: landMs('eye') })
    }
  }
  store.set(gameAtom, game)
  if (Object.keys(fresh).length > 0) addFresh(fresh)
  if (grown) store.set(newCardAtom, grown)
  if (game.over) gameOver()
  if (missed) void refresh()
}

/** 奖池分完：手里有分的自动领；没有分的只说游戏结束了，不领（领了也是 0）。 */
function gameOver() {
  const me = store.get(meAtom)
  if (!me || me.status !== 'playing') return
  if (me.points > 0) {
    store.set(blockedAtom, '奖池已经分完，游戏结束了，请领取')
    void claim(true)
    return
  }
  store.set(blockedAtom, '奖池已经分完，游戏结束了')
  if (me.digs > 0) showEnd()
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
  // 挖掘间隔拉长了（3 秒以上）：没到时间就不发，告诉他还要等几秒
  const wait = store.get(readyAtAtom) - Date.now()
  if ((store.get(gameAtom)?.rules.digInterval ?? 1) > 1 && wait > 0) {
    toast(`还要等 ${Math.ceil(wait / 1000)} 秒才能再挖`)
    return
  }
  store.set(pendingAtom, value => ({ ...value, [cell]: true }))
  play('dig')
  try {
    const answer = await api.dig(cardId, index)
    setMe(answer.me)
    if (!answer.ok) {
      toast(answer.message)
      void refresh()
      return
    }
    // 先接上攒着的推送，再放自己这次的（序号接得上）
    flushLive()
    applyLive([(answer as unknown as { update: Live }).update])
    addFresh({ [cell]: { mine: true, at: Date.now(), result: answer.result } })
    const sound = soundOfResult(answer.result)
    if (sound) play(sound)
    if (answer.result.kind === 'pearl' && answer.result.newCardId !== null) {
      play('throw', { delay: 250 })
      play('teleport', { delay: landMs('pearl') })
    }
    if (answer.result.kind === 'eye' && answer.result.newCardId !== null) {
      play('eye', { delay: 250 })
      play('portal', { delay: landMs('eye') })
    }
    if (answer.claimNow) window.setTimeout(() => void claim(true), 1200)
    // 机会用完、手里没有分：这一局对他结束了
    else if (answer.me.chances <= 0 && answer.me.points <= 0) window.setTimeout(showEnd, 1200)
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
  const me = store.get(meAtom)
  // 手里没有分不领：交上去只会在红包里记一笔“领取 0.00”
  if (me && me.status === 'playing' && me.points <= 0) {
    if (!auto) toast('手里还没有奖励，不用领取')
    return
  }
  if (auto) {
    if (autoClaimed) return
    autoClaimed = true
  }
  store.set(claimingAtom, 'working')
  try {
    const answer = await api.claim()
    setMe(answer.me)
    if (!answer.ok) {
      toast(answer.message, 'bad')
      store.set(claimingAtom, 'idle')
      return
    }
    const result = await hb.submit(answer.voucher)
    if (result.judged && result.claimed) {
      store.set(settledAtom, { amount: result.amount, unit: result.unit })
      store.set(claimingAtom, 'done')
      play('claim')
      showEnd()
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
    if (!store.get(blockedAtom)) store.set(blockedAtom, me.points > 0 ? '快截止了，已经停止挖掘，请领取' : '快截止了，已经停止挖掘')
    if (me.points > 0) void claim(true)
  }
}

export function stop() {
  stopLive?.()
  stopLive = null
}
