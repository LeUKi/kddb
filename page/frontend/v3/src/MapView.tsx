import { useAtomValue, useSetAtom } from 'jotai'
import type { MotionStyle } from 'motion/react'
import { animate, AnimatePresence, motion, useMotionValue, useReducedMotion } from 'motion/react'
import { useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { Entrance } from './CardView'
import { CardView } from './CardView'
import { CardLabels } from './CardLabels'
import { useGesture } from '@use-gesture/react'
import type { Camera, Direction, Level, Viewport, WheelZoom } from './camera'
import { BLOCK_PX, withToolbar, cameraAt, cardNear, cardToward, cellCenter, centerOf, edgeFacing, edgePointer, entryPoint, fullyOnScreen, nearestCard, nearestLevel, onScreen, overviewCamera, overviewScale, scaleOf, SLOT_PX, wheelZoom } from './camera'
import type { Flight, Point } from './PearlFlight'
import { cardAt, MapCanvas } from './MapCanvas'
import { regionName, richnessOf } from './regions'
import { landMs, PearlFlight } from './PearlFlight'
import { isSpecial, nearestSpecial } from './eye'
import { useCooling } from './Hud'
import {
  aimAtom, blockedAtom, dig, focusRequestAtom, freshAtom, gameAtom, jpTargetAtom, heldAtom, hongbaoAtom, itemsVersionAtom, meAtom, newCardAtom, peekedAtom, pendingAtom, putDown, settledAtom, store, uidAtom,
} from './state'
import { Toolbar } from './Toolbar'
import { aimInfo, anchorFor, torchHoverAtom, applyAt } from './aim'
import { shapeOf, vaultsLeft } from './items'
import { FollowTip, StepBar } from './Tips'
import { Creeper } from './Creeper'
import { Effects } from './Effects'
import { ChestNote } from './Hud'
import type { DigResult, Peek, PublicCard, Torch } from './types'

const DRAG_SLOP = 6
/** 放大到这么大才画格子（再小只画在整张地图的画布上） */
const DETAIL_SCALE = 0.4
const NO_RICH = new Map<number, number>()
const NO_PEEKS: Peek[] = []
const NO_OPENED: number[] = []
const NO_PENDING: Record<string, true> = {}
const NO_FRESH: Record<string, { mine: boolean; at: number; result?: DigResult }> = {}

/**
 * 按卡分开（键是“卡号:格”）：内容没变的卡给回上一次的同一个对象，CardView 的 memo
 * 才认得出没变，别人挖了一格只重画那一张。
 */
function useByCard<T>(all: Record<string, T>, empty: Record<string, T>) {
  const previous = useRef(new Map<number, Record<string, T>>())
  return useMemo(() => {
    const groups = new Map<number, Record<string, T>>()
    for (const [cell, value] of Object.entries(all)) {
      const cardId = Number(cell.slice(0, cell.indexOf(':')))
      let group = groups.get(cardId)
      if (!group) groups.set(cardId, (group = {}))
      group[cell] = value
    }
    for (const [cardId, group] of groups) {
      const before = previous.current.get(cardId)
      const keys = Object.keys(group)
      if (before && keys.length === Object.keys(before).length && keys.every(cell => before[cell] === group[cell])) groups.set(cardId, before)
    }
    previous.current = groups
    return (cardId: number) => groups.get(cardId) ?? empty
  }, [all, empty])
}
const lastSeenKey = (hongbao: string) => `kddb:v3:last:${hongbao}`

function readLastSeen(hongbao: string) {
  try {
    return Number(localStorage.getItem(lastSeenKey(hongbao))) || null
  } catch {
    return null
  }
}

/**
 * 地图（docs/V3_MAP.md §6）：拖动平移、松手吸附到最近的卡、三级缩放（捏合、滚轮、
 * 按钮、+/-）、方向键、四周的迷雾、居中的卡边框亮。镜头只改一个 transform；
 * 挖卡那一级才能挖，点别的区块就换过去；全图那一级不能拖。
 */
export function MapView() {
  const game = useAtomValue(gameAtom)
  const me = useAtomValue(meAtom)
  const hongbao = useAtomValue(hongbaoAtom)
  const uid = useAtomValue(uidAtom)
  const pending = useAtomValue(pendingAtom)
  const fresh = useAtomValue(freshAtom)
  const freshOf = useByCard(fresh, NO_FRESH)
  const pendingOf = useByCard(pending, NO_PENDING)
  const blocked = useAtomValue(blockedAtom)
  const newCard = useAtomValue(newCardAtom)
  const setNewCard = useSetAtom(newCardAtom)
  const focusRequest = useAtomValue(focusRequestAtom)
  const settled_ = useAtomValue(settledAtom)
  const reduced = useReducedMotion() ?? false
  const cooling = useCooling()
  const held = useAtomValue(heldAtom)
  const version = useAtomValue(itemsVersionAtom)
  const peeked = useAtomValue(peekedAtom)
  const aim = useAtomValue(aimAtom)
  const setAim = useSetAtom(aimAtom)
  const setTorchHover = useSetAtom(torchHoverAtom)
  /** 上一次按下的是鼠标还是手指：鼠标点一下就用（指着时已经预览过），手指要点两下 */
  const lastPointer = useRef<string>('mouse')

  const box = useRef<HTMLDivElement>(null)
  const [view, setView] = useState<Viewport>({ width: 0, height: 0 })
  const x = useMotionValue(0)
  const y = useMotionValue(0)
  const scale = useMotionValue(1)
  const [level, setLevel] = useState<Level>(2)
  /**
   * 镜头落定的位置：哪些卡画格子、NEW 和 JP 指向哪里。拖动中、飞的途中都不变，落地才换：
   * 换卡、画格子这些 React 的活不和动画抢时间，手机上吸附、飞过去不掉帧
   */
  const [settled, setSettled] = useState<Camera>({ x: 0, y: 0, scale: 1 })
  /**
   * 当前卡（聚焦边框、底栏、能挖的那张）：拖到、点到、捏到哪张才换成哪张，飞到了才换；
   * 缩到全图不变（全图的中心离哪张近跟他看的是哪张没关系）
   */
  const [focusId, setFocusId] = useState<number | null>(null)
  /** 正要飞过去的那张：起飞前先把它的格子画好，免得飞到了才从缩略图换成格子 */
  const [warm, setWarm] = useState<number | null>(null)
  /**
   * 正要飞去的位置（放大到能看清格子的那几级时）：起飞时就把落点画面里的卡都画好格子，飞的途中、落地那一下
   * 不再一批一起从画布换成网页（2026-11-11 量过，从全图放大时落地那一帧 30 多张一起变清楚）。落地以后
   * “画哪些卡”（cullAt，晚一拍）跟上了再撤
   */
  const [warmAt, setWarmAt] = useState<Camera | null>(null)
  const root = useRef<HTMLDivElement>(null)
  /** 每次飞都换一个号；拖动、捏合、新的一次飞会让还没落地的那次作废 */
  const flight = useRef(0)
  const landed = useRef(false)
  const cards = useMemo(() => game?.cards ?? [], [game])
  // 越富越亮（docs/V3_ITEMS.md §9）：按还藏着多少钱，区块外面三档静止的金光
  const richness = useMemo(() => (game ? richnessOf(game.cards, game.rules, game.left) : NO_RICH), [game])

  const camera = useCallback((): Camera => ({ x: x.get(), y: y.get(), scale: scale.get() }), [x, y, scale])

  const flyTo = useCallback((target: Camera, instant = false, cardId: number | null = null) => {
    const id = ++flight.current
    const land = () => {
      if (flight.current !== id) return
      setSettled(target)
      if (cardId !== null) setFocusId(cardId)
      setWarm(null)
    }
    if (instant || reduced) {
      x.set(target.x)
      y.set(target.y)
      scale.set(target.scale)
      land()
      return
    }
    if (cardId !== null) setWarm(cardId)
    setWarmAt(target.scale >= DETAIL_SCALE ? target : null)
    // 等一帧再飞：目标那张的格子在这一帧里先画好，飞的途中不再生成东西
    requestAnimationFrame(() => {
      if (flight.current !== id) return
      // 停得差不多就算落地（弹簧最后那点尾巴不等），落地以后才换当前卡、画四周的格子
      const move = { type: 'spring' as const, stiffness: 220, damping: 30, mass: 0.9, restDelta: 0.5, restSpeed: 10 }
      const zoom = { ...move, restDelta: 0.002, restSpeed: 0.02 }
      void Promise.all([animate(x, target.x, move), animate(y, target.y, move), animate(scale, target.scale, zoom)]).then(land)
    })
  }, [reduced, x, y, scale])

  /** 把镜头移到一张卡，用这一级的缩放。 */
  const goToCard = useCallback((card: PublicCard, at: Level = level, instant = false) => {
    if (at === 0) {
      // 全图：当前卡不变
      setLevel(0)
      flyTo(overviewCamera(view, cards), instant)
      return
    }
    setLevel(at)
    flyTo(cameraAt(centerOf(card), scaleOf(at, view, cards), view), instant, card.id)
  }, [cards, flyTo, level, view])

  // 量画面大小
  useLayoutEffect(() => {
    const element = box.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => setView(withToolbar(entry.contentRect.width, entry.contentRect.height)))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  // 落点：上次看的那张；第一次来是最近有人挖的那张
  useEffect(() => {
    if (landed.current || !game || !hongbao || view.width === 0) return
    landed.current = true
    const remembered = readLastSeen(hongbao.id)
    const target = cards.find(card => card.id === remembered) ?? cards.find(card => card.id === game.feed[0]?.cardId) ?? cards[0]
    aimedAt.current = view
    if (target) goToCard(target, 2, true)
  }, [cards, game, goToCard, hongbao, view.width])

  // 画面大小变了（网页窗口打开的途中、拉开抽屉、转屏）：按这一级的缩放重新对准当前卡。
  // 小的变化也要对准：刚打开时窗口还在变大小，只按第一次量到的算，挖卡那一级会比该有的大
  const aimedAt = useRef<Viewport>({ width: 0, height: 0 })
  useEffect(() => {
    if (!landed.current || view.width === 0) return
    const before = aimedAt.current
    if (before.width === view.width && before.height === view.height) return
    aimedAt.current = view
    const card = focused ?? nearestCard(cards, camera(), { ...before, width: before.width || view.width, height: before.height || view.height })
    if (card) goToCard(card, level, true)
    // 只在画面大小变化时
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.width, view.height])

  const focused = useMemo(() => cards.find(card => card.id === focusId) ?? null, [cards, focusId])
  // 哪些卡画格子：按落定的位置和当前卡算，再晚一拍（让给动画）；当前卡四周一圈先画好，
  // 拖到邻卡上不用临时生成格子
  const cullAt = useDeferredValue(settled)
  const cullFocus = useDeferredValue(focused)
  useEffect(() => {
    if (warmAt && cullAt === warmAt) setWarmAt(null)
  }, [cullAt, warmAt])
  // 缩到全图：卡小到画布画得够清楚时（全图那一级的 1.5 倍以下）才把近处网页里的卡藏起来、露出画布上的那张。
  // 以前一按缩小、第一帧就换，近处二三十张清楚的卡一起变成画布上糊的那张（2026-11-11 量过）。
  // 直接改属性不重画 React（缩放的每一帧都会走到这里）
  const smallAt = overviewScale(view, cards) * 1.5
  useEffect(() => {
    const element = root.current
    if (!element) return
    const update = (value: number) => {
      const small = value <= smallAt
      if (small !== (element.dataset.small === '1')) {
        if (small) element.dataset.small = '1'
        else delete element.dataset.small
      }
    }
    update(scale.get())
    return scale.on('change', update)
  }, [scale, smallAt])
  useEffect(() => {
    // 落定以前镜头还在原点，算出来的不是他看的那张，别记
    if (focused && hongbao && landed.current)
      try {
        localStorage.setItem(lastSeenKey(hongbao.id), String(focused.id))
      } catch {
        // 记不住就算了
      }
  }, [focused, hongbao])

  // 全图那一级不能拖：长出新卡时重新放下所有卡
  useEffect(() => {
    if (landed.current && level === 0 && view.width > 0) flyTo(overviewCamera(view, cards))
    // 只在卡的数量变化时
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cards.length])

  // 别处请求把镜头移过去（动态、NEW 标记、自己的珍珠）
  useEffect(() => {
    if (!focusRequest) return
    const card = cards.find(item => item.id === focusRequest.cardId)
    if (card) goToCard(card, focusRequest.dig ? 2 : level === 0 ? 1 : level)
    // 只在请求变化时
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusRequest])

  // 新长出来的卡（谁挖出来的都一样，镜头不动）：珍珠那格在画面附近时“珍珠传送”飞过去，
  // 新卡落地后格子从朝着旧卡的那条边翻出来；减少动画时直接出现。每张新卡算一次，
  // 拖动地图不会让它变
  const entranceKept = useRef<{ at: number; value: (Entrance & { cardId: number; flight: { from: Point; to: Point; variant: Flight } | null }) | null } | null>(null)
  if (newCard && entranceKept.current?.at !== newCard.at) {
    const card = cards.find(item => item.id === newCard.cardId)
    const source = cards.find(item => item.id === newCard.from.cardId)
    // 全图一级每张卡都“在画面里”：别人一直在挖时每张新卡都飞一颗珍珠、进出一次网页，
    // 全图上又小得看不清（2026-11-11 量过：每秒上百次重画）。全图上新卡直接画到画布上
    const overview = level === 0
    const flies = !overview && !!card && !!source && !reduced && onScreen(source, settled, view, 120)
    // 画面附近的才在网页里翻出来；远处的直接画到整张地图的画布上（上千张卡、一秒长一张时，
    // 每张都进出一次网页，拖动时会顿一下）。NEW 提醒照旧
    const near = !overview && !!card && onScreen(card, camera(), view, 400)
    const edge = card && source ? edgeFacing(card, source) : null
    // 特殊区块是末影之眼开出来的：眼浮起来转一圈，金色的尾巴，飞得更远
    const variant: Flight = card && isSpecial(card) ? 'eye' : 'pearl'
    entranceKept.current = {
      at: newCard.at,
      value: card && source && edge && (near || flies) ? {
        cardId: card.id,
        edge,
        land: flies ? landMs(variant) : 0,
        flight: flies ? { from: cellCenter(source, newCard.from.index), to: entryPoint(card, edge), variant } : null,
      } : null,
    }
  }
  const entrance = newCard ? entranceKept.current?.value ?? null : null

  // 没有整张在画面里时，落地后画面边上闪几下“NEW + 箭头”指着它，点一下过去；
  // 移过去了就不再提醒
  const [marker, setMarker] = useState<number | null>(null)
  // 特殊区块开出来时，眼落地以前先不亮 JP
  const [jpHold, setJpHold] = useState<number | null>(null)
  useEffect(() => {
    if (!newCard) return
    const card = cards.find(item => item.id === newCard.cardId)
    const land = entranceKept.current?.value?.land ?? 0
    const treasure = !!card && isSpecial(card)
    if (treasure) setJpHold(card.id)
    // 宝藏卡不闪 NEW，它有一直亮着的 JP
    const shown = window.setTimeout(() => {
      if (treasure) setJpHold(null)
      else setMarker(card && !fullyOnScreen(card, camera(), view) ? card.id : null)
    }, land)
    const timer = window.setTimeout(() => {
      setMarker(null)
      setNewCard(null)
    }, 4000 + land)
    return () => {
      window.clearTimeout(shown)
      window.clearTimeout(timer)
      if (treasure) setJpHold(null)
    }
    // 只在新卡出现时
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newCard])

  // —— 拖动、捏合：交给 @use-gesture/react（多指、缩放中心、轻点和拖动的区分、指针捕获
  // 都是它处理的）；镜头只改 x、y、scale 三个 motion 值，拖动中不触发 React 渲染 ——
  const justDragged = useRef(0)

  /** 屏幕坐标 → 地图画布里的坐标。 */
  const toLocal = (clientX: number, clientY: number) => {
    const rect = box.current!.getBoundingClientRect()
    return { x: clientX - rect.left, y: clientY - rect.top }
  }

  const snap = useCallback(() => {
    const now = camera()
    if (level === 0) {
      setSettled(now)
      return
    }
    const card = nearestCard(cards, now, view)
    if (card) goToCard(card, nearestLevel(now.scale, view, cards) === 0 ? 1 : level)
  }, [camera, cards, goToCard, level, view])

  const stopCamera = () => {
    flight.current += 1
    setWarmAt(null)
    x.stop()
    y.stop()
    scale.stop()
  }

  useGesture({
    onDragStart: stopCamera,
    onDrag: ({ pinching, cancel, offset: [ox, oy], last }) => {
      if (pinching) return cancel()
      // 全图那一级不能拖：松手那下也不算点区块
      if (level !== 0) {
        x.set(ox)
        y.set(oy)
      }
      if (last) {
        justDragged.current = performance.now()
        snap()
      }
    },
    onPinchStart: stopCamera,
    onPinch: ({ origin: [ox, oy], offset: [next], first, last, memo }) => {
      // 手指中点下面的那一点（世界坐标）一直跟着手指中点：两指一起挪也是平移
      const at = toLocal(ox, oy)
      let anchor = memo as { x: number; y: number } | undefined
      if (first || !anchor) {
        const now = camera()
        anchor = { x: (at.x - now.x) / now.scale, y: (at.y - now.y) / now.scale }
      }
      scale.set(next)
      x.set(at.x - anchor.x * next)
      y.set(at.y - anchor.y * next)
      if (last) {
        justDragged.current = performance.now()
        const card = nearestCard(cards, camera(), view)
        if (card) goToCard(card, nearestLevel(next, view, cards))
      }
      return anchor
    },
  }, {
    target: box,
    eventOptions: { passive: false },
    // 不捕获指针：捕获了，松手那下的 click 会落在画布上，格子和缩放按钮就点不到了。
    // 不用它的 filterTaps：它在捕获阶段拦 click，iPhone 上把轻点也拦了；拖过以后的那次
    // click 由下面的 onClickCapture 拦；没过 threshold 的轻点不会触发 onDrag
    // 触屏上用触摸事件（pointer.touch）：它每次都按“现在屏幕上有哪几根手指”重新算；指针
    // 事件是按下记一个、抬起删一个，漏收一次抬起（比如手指下面的格子正好换成了缩略图）
    // 就留下一根“幽灵手指”，单指拖动变成了双指缩放。电脑上没有触摸，照常用指针事件
    drag: { from: () => [x.get(), y.get()], threshold: DRAG_SLOP, pointer: { capture: false, touch: true } },
    // 缩放锁在全图和挖卡两级之间，不回弹；滚轮（含触控板捏合）还是下面自己处理
    pinch: { from: () => [scale.get(), 0], scaleBounds: () => ({ min: scaleOf(0, view, cards), max: scaleOf(2, view, cards) }), rubberband: false, pinchOnWheel: false, pointer: { touch: true } },
  })

  // 拖动以后的那次 click 不算挖
  const onClickCapture = (event: React.MouseEvent) => {
    if (performance.now() - justDragged.current < 250) {
      event.stopPropagation()
      event.preventDefault()
    }
  }

  // —— 滚轮：不按 ctrl 的都是缩放，一下换一级、放大时朝指针那张（鼠标和触控板分不清，
  // 不猜）；按着 ctrl 的是触控板捏合，跟着手指连续缩放，停下吸到最近的一级 ——
  const wheelTimer = useRef<number | undefined>(undefined)
  const wheelState = useRef<WheelZoom | null>(null)
  useEffect(() => {
    const element = box.current
    if (!element) return
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      const rect = element.getBoundingClientRect()
      const at = { x: event.clientX - rect.left, y: event.clientY - rect.top }
      if (!event.ctrlKey) {
        const { state, step } = wheelZoom(wheelState.current, event, performance.now())
        wheelState.current = state
        if (step) changeLevel(step, at)
        return
      }
      x.stop()
      y.stop()
      scale.stop()
      const current = camera()
      const nextScale = Math.min(scaleOf(2, view, cards), Math.max(scaleOf(0, view, cards), current.scale * Math.exp(-event.deltaY * 0.01)))
      const world = { x: (at.x - current.x) / current.scale, y: (at.y - current.y) / current.scale }
      scale.set(nextScale)
      x.set(at.x - world.x * nextScale)
      y.set(at.y - world.y * nextScale)
      window.clearTimeout(wheelTimer.current)
      wheelTimer.current = window.setTimeout(() => {
        const card = nearestCard(cards, camera(), view)
        if (card) goToCard(card, nearestLevel(scale.get(), view, cards))
      }, 180)
    }
    element.addEventListener('wheel', onWheel, { passive: false })
    return () => element.removeEventListener('wheel', onWheel)
  })

  const changeLevel = (by: 1 | -1, at?: { x: number; y: number }) => {
    const next = Math.min(2, Math.max(0, level + by)) as Level
    if (next === level) return
    // 滚轮放大朝指针下面那张；按钮和键盘就是当前卡
    const card = (by > 0 && at ? cardNear(cards, camera(), at) : focused ?? nearestCard(cards, camera(), view)) ?? cards[0]
    if (card) goToCard(card, next)
  }

  const move = (direction: Direction) => {
    const from = focused ?? cards[0]
    if (!from) return
    const to = cardToward(cards, from, direction)
    if (to) goToCard(to, level === 0 ? 1 : level)
  }

  // 键盘：方向键移动，+/- 缩放
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.metaKey || event.ctrlKey || event.altKey) return
      const directions: Record<string, Direction> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' }
      if (directions[event.key]) {
        event.preventDefault()
        move(directions[event.key])
      } else if (event.key === '+' || event.key === '=') changeLevel(1)
      else if (event.key === '-' || event.key === '_') changeLevel(-1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // 点一张不能挖的卡：飞过去。每张卡都拿着它，所以它不能跟着 cards 变（以前一变，别人每挖一格页面里的卡全部重画一遍）
  const cardsNow = useRef(cards)
  cardsNow.current = cards
  const goNow = useRef(goToCard)
  goNow.current = goToCard
  const pick = useCallback((cardId: number) => {
    const card = cardsNow.current.find(item => item.id === cardId)
    if (card) goNow.current(card, 2)
  }, [])
  // 拿起道具时不在挖卡这一级：飞到当前卡（没有就最近的一张）
  const focusedNow = useRef(focused)
  focusedNow.current = focused
  const viewNow = useRef(view)
  viewNow.current = view
  const needDig = useCallback(() => {
    const card = focusedNow.current ?? nearestCard(cardsNow.current, camera(), viewNow.current)
    if (card) goNow.current(card, 2)
  }, [camera])

  // —— 画在整张地图画布上的卡（MapCanvas）：点击、悬停按坐标算是哪张 ——
  const bySlot = useMemo(() => new Map(cards.map(card => [`${card.x},${card.y}`, card])), [cards])
  const worldAt = (clientX: number, clientY: number) => {
    const at = toLocal(clientX, clientY)
    const now = camera()
    return { x: (at.x - now.x) / now.scale, y: (at.y - now.y) / now.scale }
  }
  const [hover, setHover] = useState<number | null>(null)
  const pickOnCanvas = (event: React.MouseEvent) => {
    const card = cardAt(bySlot, worldAt(event.clientX, event.clientY))
    if (card) pick(card.id)
  }
  const hoverOnCanvas = (event: React.PointerEvent | null) => {
    // 只有鼠标有悬停；挖卡那一级画布上的卡都在画面外
    const card = event && event.pointerType === 'mouse' && level !== 2 ? cardAt(bySlot, worldAt(event.clientX, event.clientY)) : null
    setHover(card?.id ?? null)
  }

  // 地图上方一条：为什么现在不能挖（不用等点了才知道）
  const banner = settled_ ? null
    : me?.status === 'claimed' ? '已经领取，但还没提交成功：点上面的「重新提交」'
      : blocked
  const detailScale = cullAt.scale >= DETAIL_SCALE
  /** 近处（画面里，或当前卡四周一圈）：放大到能看清的级别时画格子 */
  const nearOf = (card: PublicCard) => onScreen(card, cullAt, view, 200)
    || (!!cullFocus && Math.max(Math.abs(card.x - cullFocus.x), Math.abs(card.y - cullFocus.y)) <= 1)
  /**
   * 放在网页里的卡：画格子的、正要飞过去的、当前卡、刚长出来的。别的都只画在整张地图的
   * 画布上（远处发光的卡，光也画在画布上）。
   */
  const warmCards = useMemo(() => new Set(warmAt ? cards.filter(card => onScreen(card, warmAt, view)).map(card => card.id) : []), [cards, view, warmAt])
  const dom = new Set(cards.filter(card => (detailScale && nearOf(card)) || card.id === warm || card.id === focused?.id
    || card.id === entrance?.cardId || warmCards.has(card.id)).map(card => card.id))
  const hoverCard = hover === null ? null : cards.find(card => card.id === hover) ?? null
  // 望远镜看到的格子按卡分开；只有自己的望远镜会变
  const peeksOf = useMemo(() => {
    const groups = new Map<number, Peek[]>()
    for (const peek of me?.peeks ?? []) groups.set(peek.cardId, [...(groups.get(peek.cardId) ?? []), peek])
    return groups
  }, [me?.peeks])
  // 刚用望远镜看到的格子：那张卡上飘一下是什么（1.6 秒）
  const [peekShown, setPeekShown] = useState<{ cardId: number; index: number } | null>(null)
  useEffect(() => {
    if (!peeked) return
    const [cardId, index] = peeked.cell.split(':').map(Number)
    setPeekShown({ cardId, index })
    const timer = window.setTimeout(() => setPeekShown(null), 1600)
    return () => window.clearTimeout(timer)
  }, [peeked])
  const markerCard = marker === null ? null : cards.find(card => card.id === marker) ?? null
  const pointer = markerCard && !fullyOnScreen(markerCard, settled, view) ? edgePointer(markerCard, settled, view) : null
  // JP：还开着的特殊区块（末影之眼开的）没有整张在画面里时，画面边上一直亮着金色的 JP 指着离你最近的那个，
  // 写着区块名（docs/V3_ITEMS.md §17）。“你”是你在的那张卡，没有就是画面正中
  const hereX = focused?.x ?? Math.round((view.width / 2 - settled.x) / settled.scale / SLOT_PX)
  const hereY = focused?.y ?? Math.round((view.height / 2 - settled.y) / settled.scale / SLOT_PX)
  const jpCard = useMemo(() => nearestSpecial(cards, hereX, hereY), [cards, hereX, hereY])
  const setJpTarget = useSetAtom(jpTargetAtom)
  useEffect(() => setJpTarget(jpCard?.id ?? null), [jpCard?.id, setJpTarget])
  const jpPointer = jpCard && jpCard.id !== jpHold && !fullyOnScreen(jpCard, settled, view) ? edgePointer(jpCard, settled, view) : null
  // JP 一直挂在页面上，不指的时候只是藏起来：以前每次藏起再出来都重新建一个，光又从头扫一遍，
  // 别人一直在挖、新的宝藏卡一张张长出来时它就一直在动（2026-11-11 量过）
  const jpLast = useRef<{ x: number; y: number; angle: number } | null>(null)
  if (jpPointer) jpLast.current = jpPointer
  const jpAt = jpPointer ?? jpLast.current

  // 拿着道具时点右键是放下（电脑上）
  const onContextMenu = (event: React.MouseEvent) => {
    if (!held) return
    event.preventDefault()
    putDown()
  }

  // 拿着道具：触屏上第一下点是预览，再点同一处才用；鼠标指着就是预览，点一下就用（docs/V3_ITEMS.md §5）
  const onAim = useCallback((cardId: number, index: number, qx: 0 | 1, qy: 0 | 1, hover: boolean) => {
    const holding = store.get(heldAtom)
    const card = store.get(gameAtom)?.cards.find(item => item.id === cardId)
    if (!holding || !card) return
    const at = anchorFor(holding, card, index, qx, qy)
    if (at === null) return
    const current = store.get(aimAtom)
    const same = !!current && current.cardId === cardId && current.index === at
    if (hover) {
      if (!same) setAim({ cardId, index: at })
      return
    }
    if (lastPointer.current === 'mouse' || same) applyAt(cardId, at)
    else setAim({ cardId, index: at })
  }, [setAim])
  const onTorch = useCallback((torch: Torch | null) => setTorchHover(torch), [setTorchHover])
  // 换了卡、离开挖卡那一级：预览作废
  useEffect(() => {
    const current = store.get(aimAtom)
    if (current && (level !== 2 || current.cardId !== focusId)) setAim(null)
  }, [focusId, level, setAim])
  const openedOf = useMemo(() => {
    const groups = new Map<number, number[]>()
    for (const cell of me?.vaultsOpened ?? []) {
      const [cardId, index] = cell.split(':').map(Number)
      groups.set(cardId, [...(groups.get(cardId) ?? []), index])
    }
    return groups
  }, [me?.vaultsOpened])
  const previewOf = (card: PublicCard) => held && aim && aim.cardId === card.id ? { ...aimInfo(held, card, aim.index, me), at: aim.index } : null
  // 电脑上的指针：拿着什么就是什么，冷却时镐子变灰（cursor.ts 画好放在 CSS 变量里）
  const shape = held ? shapeOf(held) : null
  const cursorClass = held ? (shape ? 'cur-ench' : `cur-${held}`) : cooling.seconds ? 'cur-cool' : 'cur-pick'

  return <div ref={root} className={`map-view level-${level}${cooling.seconds ? ' is-cooling' : ''}${hoverCard ? ' is-pointing' : ''}${held ? ` is-aiming aim-${held}` : ''} ${cursorClass}`}>
    <div className="map-stage">
    <div className="map-canvas" ref={box} onClickCapture={onClickCapture} onContextMenu={onContextMenu}
      onPointerDownCapture={event => { lastPointer.current = event.pointerType }}>
    <motion.div className="map-world" style={{ x, y, scale, transformOrigin: '0 0', '--px': 1 / settled.scale } as MotionStyle}>
      <MapCanvas cards={cards} rich={richness} view={view} skip={entrance?.cardId ?? null} inDom={dom} onPick={pickOnCanvas} onHover={hoverOnCanvas} />
      {hoverCard && !dom.has(hoverCard.id) ? <div className="map-hover" aria-hidden="true"
        style={{ left: hoverCard.x * SLOT_PX - BLOCK_PX / 2, top: hoverCard.y * SLOT_PX - BLOCK_PX / 2, width: BLOCK_PX, height: BLOCK_PX }} /> : null}
      {cards.map(card => {
        if (!dom.has(card.id)) return null
        const near = nearOf(card)
        const ready = card.id === warm
        const current = card.id === focused?.id
        return <CardView
          key={card.id}
          card={card}
          focused={current}
          diggable={level === 2 && current && !blocked && me?.status === 'playing' && (!card.finished || (held === 'key' && vaultsLeft(card)))}
          // 当前卡落地那一下就画格子：落定的位置是马上换的，画哪些卡跟着的 cullAt 晚一拍，
          // 以前这一拍里它先变回缩略图再变回来，慢的手机上闪两三帧（2026-11-11 量过）
          detail={(detailScale && near) || ready || warmCards.has(card.id) || (current && settled.scale >= DETAIL_SCALE)}
          names={level === 2 && current}
          current={current}
          myUid={uid}
          peeks={peeksOf.get(card.id) ?? NO_PEEKS}
          pending={pendingOf(card.id)}
          fresh={freshOf(card.id)}
          entrance={entrance?.cardId === card.id ? entrance : null}
          held={level === 2 && current ? held : null}
          preview={level === 2 && current ? previewOf(card) : null}
          peeked={peekShown?.cardId === card.id ? peekShown.index : null}
          opened={openedOf.get(card.id) ?? NO_OPENED}
          version={version}
          rich={richness.get(card.id) ?? 0}
          onDig={dig}
          onAim={onAim}
          onTorch={onTorch}
          onPick={pick}
        />
      })}
      {/* 卡周围的说明：挖卡这一级、落定了才出来，换卡时淡出淡入 */}
      <AnimatePresence>{level === 2 && focused && warm === null ? <CardLabels key={focused.id} card={focused} /> : null}</AnimatePresence>
      {entrance?.flight ? <PearlFlight key={newCard?.at} from={entrance.flight.from} to={entrance.flight.to} variant={entrance.flight.variant} /> : null}
    </motion.div>
    <div className="map-fog" aria-hidden="true" />
    {pointer && markerCard ? <button type="button" className="new-marker" style={{ left: pointer.x, top: pointer.y }}
      onClick={() => { goToCard(markerCard, level === 0 ? 1 : level); setMarker(null) }} aria-label="新长出的卡，点一下移过去">
      <span className="new-arrow" style={{ transform: `rotate(${pointer.angle}deg)` }}>➜</span>
      <span>NEW</span>
    </button> : null}
    {jpAt && jpCard ? <button type="button" className={`jp-marker${jpPointer ? '' : ' is-hidden'}`} style={{ left: jpAt.x, top: jpAt.y }}
      onClick={() => goToCard(jpCard, 2)} aria-label={`${regionName(jpCard)}开着，点一下过去`} aria-hidden={!jpPointer} tabIndex={jpPointer ? 0 : -1}>
      <span className="jp-text"><span>JP</span><small className="jp-where">{regionName(jpCard)}</small></span>
      <span className="new-arrow" style={{ transform: `rotate(${jpAt.angle}deg)` }}>➜</span>
    </button> : null}
    {/* 缩放：地图右下角竖着一列，半透明 */}
    <div className="zoom zoom-float" role="group" aria-label="缩放">
      <button type="button" onClick={() => changeLevel(1)} disabled={level === 2} aria-label="放大">＋</button>
      <span>{level === 2 ? '单张' : level === 1 ? '附近' : '全图'}</span>
      <button type="button" onClick={() => changeLevel(-1)} disabled={level === 0} aria-label="缩小">－</button>
    </div>
    {banner ? <p className="map-banner" role="status">{banner}</p>
      : level !== 2 ? <p className="map-hint">点一张卡放大过去，放大以后才能挖</p> : null}
    <FollowTip box={box} />
    <StepBar />
    <ChestNote />
    <Creeper />
    <Effects />
    </div>
    <Toolbar level={level} onNeedDig={needDig} />
    </div>
  </div>
}
