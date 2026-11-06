import { useAtomValue, useSetAtom } from 'jotai'
import { animate, motion, useMotionValue, useReducedMotion } from 'motion/react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { CardView } from './CardView'
import type { Camera, Direction, Level, Viewport } from './camera'
import { cameraAt, cardToward, centerOf, edgePointer, nearestCard, nearestLevel, onScreen, overviewCamera, scaleOf } from './camera'
import { blockedAtom, dig, focusRequestAtom, freshAtom, gameAtom, hongbaoAtom, meAtom, newCardAtom, pendingAtom, settledAtom, uidAtom } from './state'
import type { PublicCard } from './types'

const DRAG_SLOP = 6
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
 * 按钮、+/-）、方向键和方向按钮、四周的迷雾、居中的卡边框亮。镜头只改一个
 * transform；挖卡那一级才能挖，前两级点一下是放大过去。
 */
export function MapView({ onFocus }: { onFocus: (card: PublicCard | null) => void }) {
  const game = useAtomValue(gameAtom)
  const me = useAtomValue(meAtom)
  const hongbao = useAtomValue(hongbaoAtom)
  const uid = useAtomValue(uidAtom)
  const pending = useAtomValue(pendingAtom)
  const fresh = useAtomValue(freshAtom)
  const blocked = useAtomValue(blockedAtom)
  const newCard = useAtomValue(newCardAtom)
  const setNewCard = useSetAtom(newCardAtom)
  const focusRequest = useAtomValue(focusRequestAtom)
  const settled_ = useAtomValue(settledAtom)
  const reduced = useReducedMotion() ?? false

  const box = useRef<HTMLDivElement>(null)
  const [view, setView] = useState<Viewport>({ width: 0, height: 0 })
  const x = useMotionValue(0)
  const y = useMotionValue(0)
  const scale = useMotionValue(1)
  const [level, setLevel] = useState<Level>(2)
  /** 镜头停下来（或拖动中每隔一会儿）时的位置：决定聚焦哪张、哪些卡画细节 */
  const [settled, setSettled] = useState<Camera>({ x: 0, y: 0, scale: 1 })
  const [grown, setGrown] = useState<Set<number>>(new Set())
  const landed = useRef(false)
  const cards = useMemo(() => game?.cards ?? [], [game])

  const camera = useCallback((): Camera => ({ x: x.get(), y: y.get(), scale: scale.get() }), [x, y, scale])

  const flyTo = useCallback((target: Camera, instant = false) => {
    // 一起飞就按目标算聚焦和细节：缩放不变时 scale 的动画不会有“结束”
    setSettled(target)
    if (instant || reduced) {
      x.set(target.x)
      y.set(target.y)
      scale.set(target.scale)
      return
    }
    const options = { type: 'spring' as const, stiffness: 220, damping: 30, mass: 0.9 }
    void animate(x, target.x, options)
    void animate(y, target.y, options)
    void animate(scale, target.scale, options)
  }, [reduced, x, y, scale])

  /** 把镜头移到一张卡，用这一级的缩放。 */
  const goToCard = useCallback((card: PublicCard, at: Level = level, instant = false) => {
    if (at === 0) {
      setLevel(0)
      flyTo(overviewCamera(view, cards), instant)
      return
    }
    setLevel(at)
    flyTo(cameraAt(centerOf(card), scaleOf(at, view, cards), view), instant)
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

  // 画面大小变了（拉开抽屉、转屏）：保持这一级，对准原来居中的卡。只差几十像素
  // 时不动，免得下面那条信息换一行，镜头就跳一下
  const aimedAt = useRef<Viewport>({ width: 0, height: 0 })
  useEffect(() => {
    if (!landed.current || view.width === 0) return
    const before = aimedAt.current
    if (Math.abs(before.width - view.width) < 48 && Math.abs(before.height - view.height) < 48) return
    aimedAt.current = view
    const card = nearestCard(cards, camera(), { ...before, width: before.width || view.width, height: before.height || view.height })
    if (card) goToCard(card, level, true)
    // 只在画面大小变化时
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.width, view.height])

  const focused = useMemo(() => nearestCard(cards, settled, view), [cards, settled, view])
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

  // 别处请求把镜头移过去（动态、NEW 标记、自己的珍珠）
  useEffect(() => {
    if (!focusRequest) return
    const card = cards.find(item => item.id === focusRequest.cardId)
    if (card) goToCard(card, focusRequest.dig ? 2 : level === 0 ? 1 : level)
    // 只在请求变化时
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusRequest])

  // 新长出来的卡：长出来的动画；在镜头外时，屏幕边上闪几下“NEW”
  const [marker, setMarker] = useState<number | null>(null)
  useEffect(() => {
    if (!newCard) return
    setGrown(value => new Set(value).add(newCard.cardId))
    const card = cards.find(item => item.id === newCard.cardId)
    if (card && !onScreen(card, camera(), view)) setMarker(card.id)
    const timer = window.setTimeout(() => {
      setMarker(null)
      setNewCard(null)
    }, 3600)
    return () => window.clearTimeout(timer)
    // 只在新卡出现时
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newCard])

  // —— 拖动、捏合 ——
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const gesture = useRef<{ startX: number; startY: number; camera: Camera; dragging: boolean; pinch?: { distance: number; mid: { x: number; y: number } } } | null>(null)
  const justDragged = useRef(0)
  const lastSettle = useRef(0)

  const local = (event: { clientX: number; clientY: number }) => {
    const rect = box.current!.getBoundingClientRect()
    return { x: event.clientX - rect.left, y: event.clientY - rect.top }
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

  const onPointerDown = (event: React.PointerEvent) => {
    const at = local(event)
    pointers.current.set(event.pointerId, at)
    x.stop()
    y.stop()
    scale.stop()
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()]
      gesture.current = { startX: at.x, startY: at.y, camera: camera(), dragging: true, pinch: { distance: Math.hypot(a.x - b.x, a.y - b.y), mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } } }
    } else {
      gesture.current = { startX: at.x, startY: at.y, camera: camera(), dragging: false }
    }
  }

  const onPointerMove = (event: React.PointerEvent) => {
    if (!pointers.current.has(event.pointerId) || !gesture.current) return
    const at = local(event)
    pointers.current.set(event.pointerId, at)
    const g = gesture.current
    if (g.pinch && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()]
      const distance = Math.hypot(a.x - b.x, a.y - b.y)
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
      const nextScale = Math.min(2, Math.max(0.04, g.camera.scale * (distance / g.pinch.distance)))
      const world = { x: (g.pinch.mid.x - g.camera.x) / g.camera.scale, y: (g.pinch.mid.y - g.camera.y) / g.camera.scale }
      scale.set(nextScale)
      x.set(mid.x - world.x * nextScale)
      y.set(mid.y - world.y * nextScale)
      return
    }
    const dx = at.x - g.startX
    const dy = at.y - g.startY
    if (!g.dragging && Math.hypot(dx, dy) < DRAG_SLOP) return
    if (!g.dragging) {
      g.dragging = true
      box.current?.setPointerCapture(event.pointerId)
    }
    x.set(g.camera.x + dx)
    y.set(g.camera.y + dy)
    const now = performance.now()
    if (now - lastSettle.current > 160) {
      lastSettle.current = now
      setSettled(camera())
    }
  }

  const onPointerUp = (event: React.PointerEvent) => {
    pointers.current.delete(event.pointerId)
    const g = gesture.current
    if (!g) return
    if (g.pinch) {
      if (pointers.current.size > 0) return
      gesture.current = null
      justDragged.current = performance.now()
      const nextLevel = nearestLevel(scale.get(), view, cards)
      const card = nearestCard(cards, camera(), view)
      if (card) goToCard(card, nextLevel)
      return
    }
    gesture.current = null
    if (g.dragging) {
      justDragged.current = performance.now()
      snap()
    }
  }

  // 拖动以后的那次 click 不算挖
  const onClickCapture = (event: React.MouseEvent) => {
    if (performance.now() - justDragged.current < 250) {
      event.stopPropagation()
      event.preventDefault()
    }
  }

  // —— 滚轮：鼠标滚轮一格一级；触控板双指滑动平移、捏合缩放 ——
  const wheelTimer = useRef<number | undefined>(undefined)
  const wheelStep = useRef(0)
  useEffect(() => {
    const element = box.current
    if (!element) return
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      const mouseWheel = !event.ctrlKey && (event.deltaMode !== 0 || (event.deltaX === 0 && Math.abs(event.deltaY) >= 40 && Number.isInteger(event.deltaY)))
      if (mouseWheel) {
        const now = performance.now()
        if (now - wheelStep.current < 260) return
        wheelStep.current = now
        changeLevel(event.deltaY < 0 ? 1 : -1)
        return
      }
      x.stop()
      y.stop()
      scale.stop()
      if (event.ctrlKey) {
        const rect = element.getBoundingClientRect()
        const at = { x: event.clientX - rect.left, y: event.clientY - rect.top }
        const current = camera()
        const nextScale = Math.min(2, Math.max(0.04, current.scale * Math.exp(-event.deltaY * 0.01)))
        const world = { x: (at.x - current.x) / current.scale, y: (at.y - current.y) / current.scale }
        scale.set(nextScale)
        x.set(at.x - world.x * nextScale)
        y.set(at.y - world.y * nextScale)
      } else {
        x.set(x.get() - event.deltaX)
        y.set(y.get() - event.deltaY)
      }
      window.clearTimeout(wheelTimer.current)
      wheelTimer.current = window.setTimeout(() => {
        const nextLevel = nearestLevel(scale.get(), view, cards)
        const card = nearestCard(cards, camera(), view)
        if (!card) return
        if (event.ctrlKey || nextLevel !== level) goToCard(card, nextLevel)
        else snap()
      }, 180)
    }
    element.addEventListener('wheel', onWheel, { passive: false })
    return () => element.removeEventListener('wheel', onWheel)
  })

  const changeLevel = (by: 1 | -1) => {
    const next = Math.min(2, Math.max(0, level + by)) as Level
    if (next === level) return
    const card = nearestCard(cards, camera(), view) ?? cards[0]
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

  // 地图上方一条：为什么现在不能挖（不用等点了才知道）
  const banner = settled_ ? null
    : me?.status === 'claimed' ? '已经领取，凭证还没交上：点上面的「再交一次」'
      : blocked
  const detailScale = settled.scale >= 0.42
  const markerCard = marker === null ? null : cards.find(card => card.id === marker) ?? null
  const pointer = markerCard ? edgePointer(markerCard, settled, view) : null

  return <div className={`map-view level-${level}`}>
    <div className="map-canvas" ref={box}
    onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
    onClickCapture={onClickCapture}>
    <motion.div className="map-world" style={{ x, y, scale, transformOrigin: '0 0' }}>
      {cards.map(card => {
        const near = onScreen(card, settled, view, 200)
        return <CardView
          key={card.id}
          card={card}
          focused={card.id === focused?.id}
          diggable={level === 2 && card.id === focused?.id && !card.finished && !blocked && me?.status === 'playing'}
          detail={detailScale && near}
          myUid={uid}
          peeks={me?.peeks ?? []}
          pending={pending}
          fresh={fresh}
          grown={grown.has(card.id)}
          onDig={dig}
          onPick={pick}
        />
      })}
    </motion.div>
    <div className="map-fog" aria-hidden="true" />
    {pointer && markerCard ? <button type="button" className="new-marker" style={{ left: pointer.x, top: pointer.y }}
      onClick={() => { goToCard(markerCard, level === 0 ? 1 : level); setMarker(null) }} aria-label="新长出的卡，点一下移过去">
      <span className="new-arrow" style={{ transform: `rotate(${pointer.angle}deg)` }}>➜</span>
      <span>NEW</span>
    </button> : null}
    {banner ? <p className="map-banner" role="status">{banner}</p>
      : level !== 2 ? <p className="map-hint">点一张卡放大过去，放大以后才能挖</p> : null}
    </div>
    <div className="map-toolbar">
      <div className="dpad" role="group" aria-label="换卡">
        <button type="button" onClick={() => move('left')} disabled={!focused || !cardToward(cards, focused, 'left')} aria-label="左边的卡">◀</button>
        <button type="button" onClick={() => move('up')} disabled={!focused || !cardToward(cards, focused, 'up')} aria-label="上面的卡">▲</button>
        <button type="button" onClick={() => move('down')} disabled={!focused || !cardToward(cards, focused, 'down')} aria-label="下面的卡">▼</button>
        <button type="button" onClick={() => move('right')} disabled={!focused || !cardToward(cards, focused, 'right')} aria-label="右边的卡">▶</button>
      </div>
      <div className="zoom" role="group" aria-label="缩放">
        <button type="button" onClick={() => changeLevel(-1)} disabled={level === 0} aria-label="缩小">－</button>
        <span>{level === 2 ? '挖卡' : level === 1 ? '附近' : '全图'}</span>
        <button type="button" onClick={() => changeLevel(1)} disabled={level === 2} aria-label="放大">＋</button>
      </div>
    </div>
  </div>
}
