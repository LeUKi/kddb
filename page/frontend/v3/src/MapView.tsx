import { useAtomValue, useSetAtom } from 'jotai'
import type { MotionStyle } from 'motion/react'
import { animate, motion, useMotionValue, useReducedMotion } from 'motion/react'
import { useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { Entrance } from './CardView'
import { CardView } from './CardView'
import { useGesture } from '@use-gesture/react'
import type { Camera, Direction, Level, Viewport, WheelZoom } from './camera'
import { BLOCK_PX, cameraAt, cardNear, cardToward, cellCenter, centerOf, edgeFacing, edgePointer, entryPoint, fullyOnScreen, nearestCard, nearestLevel, onScreen, overviewCamera, scaleOf, SLOT_PX, wheelZoom } from './camera'
import type { Flight, Point } from './PearlFlight'
import { cardAt, MapCanvas } from './MapCanvas'
import { landMs, PearlFlight } from './PearlFlight'
import { isTreasure } from './eye'
import { useCooling } from './Hud'
import { blockedAtom, dig, focusRequestAtom, freshAtom, gameAtom, hongbaoAtom, meAtom, newCardAtom, pendingAtom, settledAtom, uidAtom } from './state'
import type { DigResult, Peek, PublicCard } from './types'

const DRAG_SLOP = 6
const NO_PEEKS: Peek[] = []
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
export function MapView({ onFocus }: { onFocus: (card: PublicCard | null) => void }) {
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
  /** 每次飞都换一个号；拖动、捏合、新的一次飞会让还没落地的那次作废 */
  const flight = useRef(0)
  const landed = useRef(false)
  const cards = useMemo(() => game?.cards ?? [], [game])

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
    const observer = new ResizeObserver(([entry]) => setView({ width: entry.contentRect.width, height: entry.contentRect.height }))
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
    onFocus(focused)
    // 落定以前镜头还在原点，算出来的不是他看的那张，别记
    if (focused && hongbao && landed.current)
      try {
        localStorage.setItem(lastSeenKey(hongbao.id), String(focused.id))
      } catch {
        // 记不住就算了
      }
  }, [focused, hongbao, onFocus])

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
    const flies = !!card && !!source && !reduced && onScreen(source, settled, view, 120)
    // 画面附近的才在网页里翻出来；远处的直接画到整张地图的画布上（上千张卡、一秒长一张时，
    // 每张都进出一次网页，拖动时会顿一下）。NEW 提醒照旧
    const near = !!card && onScreen(card, camera(), view, 400)
    const edge = card && source ? edgeFacing(card, source) : null
    // 末地宝藏是末影之眼开出来的：眼浮起来转一圈，金色的尾巴，飞得更远
    const variant: Flight = card && isTreasure(card) ? 'eye' : 'pearl'
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
  // 末地宝藏开出来时，眼落地以前先不亮 JP
  const [jpHold, setJpHold] = useState<number | null>(null)
  useEffect(() => {
    if (!newCard) return
    const card = cards.find(item => item.id === newCard.cardId)
    const land = entranceKept.current?.value?.land ?? 0
    const treasure = !!card && isTreasure(card)
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

  const pick = useCallback((cardId: number) => {
    const card = cards.find(item => item.id === cardId)
    if (card) goToCard(card, 2)
  }, [cards, goToCard])

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
    : me?.status === 'claimed' ? '已经领取，凭证还没交上：点上面的「再交一次」'
      : blocked
  const detailScale = cullAt.scale >= 0.4
  /** 近处（画面里，或当前卡四周一圈）：放大到能看清的级别时画格子 */
  const nearOf = (card: PublicCard) => onScreen(card, cullAt, view, 200)
    || (!!cullFocus && Math.max(Math.abs(card.x - cullFocus.x), Math.abs(card.y - cullFocus.y)) <= 1)
  /**
   * 放在网页里的卡：画格子的、正要飞过去的、当前卡、刚长出来的。别的都只画在整张地图的
   * 画布上（远处发光的卡，光也画在画布上）。
   */
  const dom = new Set(cards.filter(card => (detailScale && nearOf(card)) || card.id === warm || card.id === focused?.id
    || card.id === entrance?.cardId).map(card => card.id))
  const hoverCard = hover === null ? null : cards.find(card => card.id === hover) ?? null
  // 望远镜看到的格子按卡分开；只有自己的望远镜会变
  const peeksOf = useMemo(() => {
    const groups = new Map<number, Peek[]>()
    for (const peek of me?.peeks ?? []) groups.set(peek.cardId, [...(groups.get(peek.cardId) ?? []), peek])
    return groups
  }, [me?.peeks])
  const markerCard = marker === null ? null : cards.find(card => card.id === marker) ?? null
  const pointer = markerCard && !fullyOnScreen(markerCard, settled, view) ? edgePointer(markerCard, settled, view) : null
  // JP：末地宝藏还有没挖的格子、又没整张在画面里时，画面边上一直亮着金色的 JP 指着它
  const jpCard = useMemo(() => [...cards].reverse().find(card => isTreasure(card) && !card.finished) ?? null, [cards])
  const jpPointer = jpCard && jpCard.id !== jpHold && !fullyOnScreen(jpCard, settled, view) ? edgePointer(jpCard, settled, view) : null

  return <div className={`map-view level-${level}${cooling.seconds ? ' is-cooling' : ''}${hoverCard ? ' is-pointing' : ''}`}>
    <div className="map-canvas" ref={box} onClickCapture={onClickCapture}>
    <motion.div className="map-world" style={{ x, y, scale, transformOrigin: '0 0', '--px': 1 / settled.scale } as MotionStyle}>
      <MapCanvas cards={cards} view={view} skip={entrance?.cardId ?? null} inDom={dom} onPick={pickOnCanvas} onHover={hoverOnCanvas} />
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
          diggable={level === 2 && current && !card.finished && !blocked && me?.status === 'playing'}
          detail={(detailScale && near) || ready}
          names={level === 2 && current}
          current={current}
          myUid={uid}
          peeks={peeksOf.get(card.id) ?? NO_PEEKS}
          pending={pendingOf(card.id)}
          fresh={freshOf(card.id)}
          entrance={entrance?.cardId === card.id ? entrance : null}
          onDig={dig}
          onPick={pick}
        />
      })}
      {entrance?.flight ? <PearlFlight key={newCard?.at} from={entrance.flight.from} to={entrance.flight.to} variant={entrance.flight.variant} /> : null}
    </motion.div>
    <div className="map-fog" aria-hidden="true" />
    {pointer && markerCard ? <button type="button" className="new-marker" style={{ left: pointer.x, top: pointer.y }}
      onClick={() => { goToCard(markerCard, level === 0 ? 1 : level); setMarker(null) }} aria-label="新长出的卡，点一下移过去">
      <span className="new-arrow" style={{ transform: `rotate(${pointer.angle}deg)` }}>➜</span>
      <span>NEW</span>
    </button> : null}
    {jpPointer && jpCard ? <button type="button" className="jp-marker" style={{ left: jpPointer.x, top: jpPointer.y }}
      onClick={() => goToCard(jpCard, 2)} aria-label="末地宝藏开着，点一下过去">
      <span>JP</span>
      <span className="new-arrow" style={{ transform: `rotate(${jpPointer.angle}deg)` }}>➜</span>
    </button> : null}
    {/* 缩放：地图右下角竖着一列，半透明 */}
    <div className="zoom zoom-float" role="group" aria-label="缩放">
      <button type="button" onClick={() => changeLevel(1)} disabled={level === 2} aria-label="放大">＋</button>
      <span>{level === 2 ? '挖卡' : level === 1 ? '附近' : '全图'}</span>
      <button type="button" onClick={() => changeLevel(-1)} disabled={level === 0} aria-label="缩小">－</button>
    </div>
    {banner ? <p className="map-banner" role="status">{banner}</p>
      : level !== 2 ? <p className="map-hint">点一张卡放大过去，放大以后才能挖</p> : null}
    </div>
  </div>
}
