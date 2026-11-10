import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import type { MutableRefObject, RefObject } from 'react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ItemIcon } from '../../src/ItemIcon'
import type { IconKind } from '../../src/game'
import { applyAtAim } from './aim'
import type { Level } from './camera'
import { makeCursors } from './cursor'
import { ShapeGlyph } from './Dialogs'
import { useCooling } from './Hud'
import type { Held, Slot } from './items'
import { CRAFT_NEED, countOf, isHeld, SHIELD_CAP, shapeOf, SLOT_NAMES, SLOT_USE, slotsOf } from './items'
import { play } from './sound'
import { aimAtom, blockedAtom, dialogAtom, gameAtom, hasteUntilAtom, heldAtom, meAtom, putDown, settledAtom, slotMenuAtom, toast, applyItem } from './state'
import type { Me, PublicCard } from './types'

const ICONS: Record<Slot, IconKind> = {
  pickaxe: 'pickaxe', 'pick-h': 'pickaxe', 'pick-v': 'pickaxe', 'pick-x': 'pickaxe', spyglass: 'spyglass', torch: 'torch', key: 'key',
  map: 'map', potion: 'potion', ender: 'ender', table: 'table', shield: 'shield', coal: 'coal', stick: 'stick', poison: 'spawner',
}

/**
 * 工具条（docs/V3_ITEMS.md §5）：竖着的画面在地图下面，横着的在左边，位置一直留着。镐子固定在
 * 最前面，带着机会和冷却；后面是手里的道具，再隔一道线是被动的（盾牌、煤炭、木棍、中毒）。
 * 放不下时可以滑（两头渐隐，有箭头），电脑上滚轮、拖动也能滚。
 *
 * 点法：对格子用的道具点一下拿在手上，地图上预览、再点一次才用；藏宝图、药水在提示框里确认；
 * 末影箱、附魔台打开弹窗；被动的点开只看说明。再点同一格、Esc、电脑上点右键都是放下。
 */
export function Toolbar({ level, card, onNeedDig }: { level: Level; card: PublicCard | null; onNeedDig: () => void }) {
  const me = useAtomValue(meAtom)
  const game = useAtomValue(gameAtom)
  const blocked = useAtomValue(blockedAtom)
  const settled = useAtomValue(settledAtom)
  const [held, setHeld] = useAtom(heldAtom)
  const [menu, setMenu] = useAtom(slotMenuAtom)
  const aim = useAtomValue(aimAtom)
  const setDialog = useSetAtom(dialogAtom)
  const cooling = useCooling()
  const hasteUntil = useAtomValue(hasteUntilAtom)
  const reduced = useReducedMotion() ?? false
  const box = useRef<HTMLDivElement>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const slotRefs = useRef(new Map<Slot, HTMLElement>())
  const [ends, setEnds] = useState({ start: false, end: false })
  const crafted = useCraft(me, slotRefs, box, reduced)

  const items = !!game?.rules.items
  const { active, passive } = me ? slotsOf(me, items) : { active: [], passive: [] }
  // 正在合成：煤炭、木棍满着多留一会儿，飞去火把那一格
  const shownPassive: Slot[] = crafted ? [...passive.filter(slot => slot !== 'coal' && slot !== 'stick'), 'coal', 'stick'] : passive
  const order: Slot[] = ['pickaxe', ...active, ...shownPassive]
  const playing = !!me && me.status === 'playing' && !settled

  useEffect(makeCursors, [])

  // 道具用完了、没了：放下它，收起它的说明
  useEffect(() => {
    if (held && (!order.includes(held) || !playing)) putDown()
    else if (menu && !order.includes(menu)) setMenu(null)
  })

  // 点工具条和提示框外面：收起说明（拿着的道具不放下：拖地图、缩放、换卡都不算取消）
  useEffect(() => {
    if (!menu || held) return
    const onDown = (event: PointerEvent) => {
      if (!box.current?.contains(event.target as Node)) setMenu(null)
    }
    window.addEventListener('pointerdown', onDown, true)
    return () => window.removeEventListener('pointerdown', onDown, true)
  }, [menu, held, setMenu])

  const tap = (slot: Slot) => {
    const use = SLOT_USE[slot]
    if (slot === 'pickaxe') {
      if (held) {
        putDown()
        play('click')
        return
      }
      setMenu(menu === 'pickaxe' ? null : 'pickaxe')
      return
    }
    if (isHeld(slot)) {
      if (held === slot) {
        putDown()
        return
      }
      if (!playing || blocked) {
        toast(blocked ?? '已经领取了，不能再用')
        return
      }
      putDown()
      setHeld(slot)
      play('click')
      if (level !== 2) onNeedDig()
      return
    }
    if (held) putDown()
    if (use === 'dialog') {
      if (!playing || blocked) {
        toast(blocked ?? '已经领取了，不能再用')
        return
      }
      setMenu(null)
      setDialog({ type: slot === 'ender' ? 'ender' : 'table' })
      return
    }
    setMenu(menu === slot ? null : slot)
  }
  const tapRef = useRef(tap)
  tapRef.current = tap
  const orderRef = useRef(order)
  orderRef.current = order

  // 键盘：1–9 选第几格，Esc 放下
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.metaKey || event.ctrlKey || event.altKey) return
      if (event.key === 'Escape') {
        putDown()
        return
      }
      const n = Number(event.key)
      if (event.key.length === 1 && Number.isInteger(n) && n >= 1 && n <= Math.min(9, orderRef.current.length)) {
        event.preventDefault()
        tapRef.current(orderRef.current[n - 1])
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // 放不下时：两头渐隐、箭头（哪头还有就显示哪头）
  const measure = () => {
    const element = scroller.current
    if (!element) return
    const vertical = isVertical(element)
    const position = vertical ? element.scrollTop : element.scrollLeft
    const room = vertical ? element.scrollHeight - element.clientHeight : element.scrollWidth - element.clientWidth
    const next = { start: position > 4, end: position < room - 4 }
    setEnds(before => (before.start === next.start && before.end === next.end ? before : next))
  }
  useLayoutEffect(measure)
  useEffect(() => {
    const element = scroller.current
    if (!element) return
    // 里面的格子长出来、收起来时外面不一定变大小：两个都看着
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    if (element.firstElementChild) observer.observe(element.firstElementChild)
    const onWheel = (event: WheelEvent) => {
      // 竖着滚轮也能横着滚（横屏时工具条本来就是竖的）
      if (element.scrollWidth > element.clientWidth + 2 && Math.abs(event.deltaY) > Math.abs(event.deltaX)) {
        element.scrollLeft += event.deltaY
        event.preventDefault()
      }
    }
    element.addEventListener('wheel', onWheel, { passive: false })
    // 刚打开时格子还在长出来、字体还在加载：过一会儿再量一次
    const later = window.setTimeout(measure, 600)
    return () => {
      window.clearTimeout(later)
      observer.disconnect()
      element.removeEventListener('wheel', onWheel)
    }
  }, [])
  const scrollBy = (sign: 1 | -1) => {
    const element = scroller.current
    if (!element) return
    const vertical = isVertical(element)
    element.scrollBy({ [vertical ? 'top' : 'left']: sign * 112, behavior: reduced ? 'auto' : 'smooth' })
  }
  // 鼠标按住拖也能滚；拖过的那下不算点
  const drag = useRef<{ x: number; y: number; left: number; top: number; moved: boolean } | null>(null)
  const dragged = useRef(0)
  // 新拿起、新出现的那格滚进来
  useEffect(() => {
    const target = held ?? menu
    const element = target ? slotRefs.current.get(target) : null
    element?.scrollIntoView?.({ block: 'nearest', inline: 'nearest', behavior: reduced ? 'auto' : 'smooth' })
  }, [held, menu, reduced])

  if (!me || !game) return <div className="toolbar" ref={box} />
  const interval = game.rules.digInterval ?? 1
  const haste = Math.max(0, hasteUntil - Date.now())

  const slotView = (slot: Slot) => {
    const selected = slot === 'pickaxe' ? held === null : held === slot
    const open = menu === slot && !held
    const count = countOf(me, slot)
    const shape = isHeld(slot) ? shapeOf(slot) : null
    const craftFull = crafted && (slot === 'coal' || slot === 'stick')
    const fill = slot === 'coal' || slot === 'stick' ? Math.min(1, craftFull ? 1 : count / CRAFT_NEED) : null
    const label = slot === 'pickaxe' ? `镐子，剩余机会 ${me.chances} 次${cooling.seconds ? `，还要等 ${cooling.seconds} 秒` : ''}`
      : slot === 'shield' ? `盾牌 ${count}/${items ? SHIELD_CAP : 1} 面`
        : fill !== null ? `${SLOT_NAMES[slot]} ${count}/${CRAFT_NEED}` : `${SLOT_NAMES[slot]} ${count}`
    const number = slot === 'pickaxe' || shape ? String(count) : slot === 'shield' ? `${count}/${items ? SHIELD_CAP : 1}`
      : slot === 'poison' ? String(count) : fill !== null ? '' : count > 1 ? String(count) : ''
    return <motion.div key={slot} className={`tool-cell${slot === 'pickaxe' ? ' is-pinned' : ''}`} data-slot={slot}
      ref={(element: HTMLDivElement | null) => {
        if (element) slotRefs.current.set(slot, element)
        else slotRefs.current.delete(slot)
      }}
      layout={!reduced} initial={slot === 'pickaxe' || reduced ? false : { opacity: 0, scale: 0.5 }} animate={{ opacity: 1, scale: 1 }}
      exit={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.3 }} transition={{ type: 'spring', stiffness: 520, damping: 30 }}>
      <button type="button"
        className={`tool-slot is-${slot}${selected ? ' is-selected' : ''}${open ? ' is-open' : ''}${fill === 1 ? ' is-full' : ''}${slot === 'pickaxe' && haste > 0 ? ' is-haste' : ''}`}
        aria-label={label} aria-pressed={isHeld(slot) || slot === 'pickaxe' ? selected : undefined} aria-expanded={SLOT_USE[slot] === 'confirm' || SLOT_USE[slot] === 'passive' ? open : undefined}
        title={SLOT_NAMES[slot]}
        onClick={() => {
          if (performance.now() - dragged.current < 200) return
          tap(slot)
        }}
        onContextMenu={event => {
          event.preventDefault()
          putDown()
        }}>
        {/* 中毒的动静：次数变了才动几下（一直动的话红包站外面的毛玻璃每一帧都要重新模糊） */}
        {slot === 'poison' ? <><span key={`glow-${count}`} className="poison-glow" aria-hidden="true" /><span key={`spider-${count}`} className="poison-spider" aria-hidden="true" /></> : null}
        <ItemIcon kind={ICONS[slot]} size={30} />
        {shape ? <><span className="glint" aria-hidden="true" /><ShapeGlyph shape={shape} /></> : null}
        {slot === 'poison' ? <span key={`bubbles-${count}`} className="poison-bubbles" aria-hidden="true"><i /><i /><i /></span> : null}
        {slot === 'pickaxe' && cooling.seconds ? <span className="cooling-veil" style={{ transform: `scaleY(${cooling.left})` }} aria-hidden="true" /> : null}
        {slot === 'pickaxe' && cooling.seconds && interval > 1 ? <span className="cooling-text" aria-hidden="true">{cooling.seconds}</span> : null}
        {slot === 'pickaxe' && haste > 0 ? <span className="haste-badge" aria-hidden="true"><ItemIcon kind="potion" size={12} /></span> : null}
        {fill !== null ? <span className="tool-bar" aria-hidden="true"><i style={{ width: `${fill * 100}%`, background: `hsl(${Math.round(fill * 120)} 85% 50%)` }} /></span> : null}
        {number ? <McNumber key={number} text={number} tone={slot === 'poison' ? 'green' : 'white'} /> : null}
      </button>
    </motion.div>
  }

  const tip = tipOf({ held, menu, me, level, card, aimSet: !!aim, interval, items, blocked })
  return <div className={`toolbar${playing ? '' : ' is-done'}`} ref={box} role="toolbar" aria-label="工具条">
    {slotView('pickaxe')}
    <span className="toolbar-divider is-pin" aria-hidden="true" />
    <div className="toolbar-scroll-wrap">
      <div className={`toolbar-scroll${ends.start ? ' fade-start' : ''}${ends.end ? ' fade-end' : ''}`} ref={scroller} onScroll={measure}
        onPointerDown={event => {
          if (event.pointerType !== 'mouse') return
          const element = scroller.current!
          drag.current = { x: event.clientX, y: event.clientY, left: element.scrollLeft, top: element.scrollTop, moved: false }
        }}
        onPointerMove={event => {
          const start = drag.current
          if (!start || event.buttons !== 1) return
          const dx = event.clientX - start.x
          const dy = event.clientY - start.y
          if (!start.moved && Math.hypot(dx, dy) < 5) return
          start.moved = true
          const element = scroller.current!
          element.scrollLeft = start.left - dx
          element.scrollTop = start.top - dy
        }}
        onPointerUp={() => {
          if (drag.current?.moved) dragged.current = performance.now()
          drag.current = null
        }}
        onPointerLeave={() => {
          drag.current = null
        }}>
        <div className="toolbar-slots">
          <AnimatePresence initial={false} mode="popLayout" onExitComplete={measure}>
            {active.map(slotView)}
            {shownPassive.length > 0 ? <motion.span key="divider" layout={!reduced} className="toolbar-divider" aria-hidden="true"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} /> : null}
            {shownPassive.map(slotView)}
          </AnimatePresence>
        </div>
      </div>
      {ends.start ? <button type="button" className="toolbar-arrow is-start" onClick={() => scrollBy(-1)} aria-label="往前看">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6l-6 6l6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button> : null}
      {ends.end ? <button type="button" className="toolbar-arrow is-end" onClick={() => scrollBy(1)} aria-label="往后看">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6l-6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button> : null}
    </div>
    <AnimatePresence>
      {tip ? <motion.div key={tip.key} className="item-tip toolbar-tip" role={held ? 'status' : 'dialog'} aria-label={tip.title}
        initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}>
        <p><b className={tip.green ? 'is-green' : ''}>{tip.title}</b>{tip.words}</p>
        <div className="item-tip-actions">
          {/* 离工具条最近的是放下、取消、知道了：连点两下，第二下落不到别的上面 */}
          <button type="button" onClick={putDown}>{held ? '放下' : tip.confirm ? '取消' : '知道了'}</button>
          {held ? <button type="button" className="is-primary" disabled={!tip.ready} onClick={applyAtAim}>{tip.action}</button> : null}
          {tip.confirm ? <button type="button" className="is-primary" onClick={() => void applyItem(tip.confirm!)}>{tip.action}</button> : null}
        </div>
      </motion.div> : null}
    </AnimatePresence>
  </div>
}

/** 横屏时工具条是竖的（样式里只让它上下滚）。按样式判断，不按内容：格子长出来时会高出一两个像素。 */
function isVertical(element: HTMLElement) {
  return getComputedStyle(element).overflowX === 'hidden'
}

/** 提示框说什么：拿着的道具怎么用，或者点开的那格是什么。 */
function tipOf({ held, menu, me, level, card, aimSet, interval, items, blocked }: {
  held: Held | null; menu: Slot | null; me: Me; level: Level; card: PublicCard | null; aimSet: boolean; interval: number; items: boolean; blocked: string | null
}): { key: string; title: string; words: string; action?: string; ready?: boolean; confirm?: 'map' | 'potion'; green?: boolean } | null {
  const touch = !window.matchMedia?.('(hover: hover) and (pointer: fine)').matches
  if (held) {
    const title = SLOT_NAMES[held]
    const what = held === 'torch' ? '格子之间的缝（插在离得最近的角上）' : held === 'key' ? '一个宝库' : '一格'
    const words = level !== 2 ? '放大到一张卡上，再点格子。'
      : card?.finished ? '这张卡挖完了，换一张没挖完的卡。'
        : touch ? (aimSet ? `再点一次${shapeOf(held) ? '框的中间' : '同一处'}就用，点别处换位置；拖动还是挪地图。` : `点${what}，先放上去看看。`)
          : `指到哪里预览到哪里，点一下就用；右键或 Esc 放下。`
    const action = held === 'torch' ? '插上' : held === 'spyglass' ? '看' : held === 'key' ? '开' : '挖'
    return { key: `held-${held}`, title, words, action, ready: aimSet && level === 2 }
  }
  if (!menu) return null
  if (menu === 'pickaxe') return { key: 'pickaxe', title: '镐子', words: blocked ?? `点一格没挖开的格子就是挖，用 1 次机会，还剩 ${me.chances} 次${interval > 1 ? `；每次至少隔 ${interval} 秒` : ''}。` }
  if (menu === 'map') return { key: 'map', title: '藏宝图', words: '随机标出地图上一格奖励（绿宝石常见，钻石少见），只有你看得见，镜头会飞过去。', action: '打开', confirm: 'map' }
  if (menu === 'potion') return { key: 'potion', title: '急迫药水', words: '喝下以后 10 秒里，每次挖只要隔 1 秒。', action: '喝下', confirm: 'potion' }
  if (menu === 'shield') return { key: 'shield', title: `盾牌 ${countOf(me, 'shield')}/${items ? SHIELD_CAP : 1}`, words: `踩到 TNT 或末影水晶时自动挡下一次，用掉一面。${items ? `最多带 ${SHIELD_CAP} 面，再挖到换成一份小奖。` : '再挖到就换成一份小奖。'}` }
  if (menu === 'coal' || menu === 'stick') return { key: menu, title: `${SLOT_NAMES[menu]} ${countOf(me, menu)}/${CRAFT_NEED}`, words: `煤炭、木棍都攒满 ${CRAFT_NEED} 个，自动做成一个火把；满了再挖到不算。` }
  if (menu === 'poison') return { key: 'poison', title: `中毒，还有 ${countOf(me, 'poison')} 次`, words: '接下来每挖一次，扣手上 5%，盾牌挡不住。', green: true }
  return null
}

/** Minecraft 物品栏那种像素数字（带阴影），右下角。 */
const GLYPHS: Record<string, number[]> = {
  0: [5, 14, 17, 19, 21, 25, 17, 14], 1: [5, 4, 12, 4, 4, 4, 4, 31], 2: [5, 14, 17, 1, 6, 8, 17, 31], 3: [5, 14, 17, 1, 6, 1, 17, 14],
  4: [5, 3, 5, 9, 17, 31, 1, 1], 5: [5, 31, 16, 30, 1, 1, 17, 14], 6: [5, 6, 8, 16, 30, 17, 17, 14], 7: [5, 31, 17, 1, 2, 4, 4, 4],
  8: [5, 14, 17, 17, 14, 17, 17, 14], 9: [5, 14, 17, 17, 15, 1, 2, 12], '/': [5, 1, 2, 2, 4, 8, 8, 16],
}
function McNumber({ text, tone }: { text: string; tone: 'white' | 'green' }) {
  const rects: string[] = []
  const shadows: string[] = []
  let x = 0
  for (const char of text) {
    const glyph = GLYPHS[char]
    if (!glyph) continue
    const [width, ...rows] = glyph
    rows.forEach((bits, y) => {
      for (let column = 0; column < width; column++) if (bits & (1 << (width - 1 - column))) {
        rects.push(`M${x + column} ${y}h1v1h-1z`)
        shadows.push(`M${x + column + 1} ${y + 1}h1v1h-1z`)
      }
    })
    x += width + 1
  }
  const width = Math.max(1, x)
  return <svg className={`tool-count is-${tone}`} viewBox={`0 0 ${width} 8`} width={width * 2} height={16} shapeRendering="crispEdges" aria-hidden="true">
    <path className="shadow" d={shadows.join('')} />
    <path d={rects.join('')} />
  </svg>
}

/**
 * 合成火把：游戏站在同一下里把煤炭、木棍清零、火把加一。看到这样的变化时，煤炭、木棍满着多留
 * 一会儿，两样飞到一起、闪一下，变成火把飞进火把那一格（减少动画时直接换）。
 */
function useCraft(me: Me | null, slots: MutableRefObject<Map<Slot, HTMLElement>>, box: RefObject<HTMLDivElement | null>, reduced: boolean) {
  const before = useRef<{ coal: number; stick: number; torch: number } | null>(null)
  const [crafting, setCrafting] = useState(0)
  // 在画出来以前发现：煤炭、木棍那两格不会先收起来又长回来
  useLayoutEffect(() => {
    if (!me) return
    const now = { coal: me.coal ?? 0, stick: me.stick ?? 0, torch: me.items?.torch ?? 0 }
    const last = before.current
    before.current = now
    if (!last || reduced) return
    if (now.torch > last.torch && now.coal === 0 && now.stick === 0 && (last.coal > 0 || last.stick > 0)) setCrafting(Date.now())
  }, [me, reduced])
  useEffect(() => {
    if (!crafting) return
    const stage = box.current?.closest('.map-stage') as HTMLElement | null
    const coal = slots.current.get('coal')
    const stick = slots.current.get('stick')
    if (!stage || !coal || !stick) {
      setCrafting(0)
      return
    }
    const timers: number[] = []
    const frame = stage.getBoundingClientRect()
    const rect = (element: HTMLElement) => {
      const r = element.getBoundingClientRect()
      return { x: r.left - frame.left + r.width / 2, y: r.top - frame.top + r.height / 2 }
    }
    const fly = (src: string, from: { x: number; y: number }, to: { x: number; y: number }, ms: number) => {
      const image = document.createElement('img')
      image.className = 'craft-fly'
      image.src = new URL(`assets/minecraft/1.21.4/${src}`, document.baseURI).href
      image.alt = ''
      image.style.left = `${from.x - 14}px`
      image.style.top = `${from.y - 14}px`
      stage.appendChild(image)
      const animation = image.animate([
        { transform: 'translate(0, 0) scale(1)' },
        { transform: `translate(${(to.x - from.x) / 2}px, ${(to.y - from.y) / 2 - 36}px) scale(1.25)` },
        { transform: `translate(${to.x - from.x}px, ${to.y - from.y}px) scale(0.7)` },
      ], { duration: ms, easing: 'cubic-bezier(.4,0,.2,1)' })
      animation.onfinish = () => image.remove()
      return animation
    }
    const a = rect(coal)
    const b = rect(stick)
    const meet = { x: (a.x + b.x) / 2, y: Math.min(a.y, b.y) - 56 }
    timers.push(window.setTimeout(() => {
      fly('textures/item/coal.png', a, meet, 420)
      fly('textures/item/stick.png', b, meet, 420)
      play('pop')
    }, 300))
    timers.push(window.setTimeout(() => {
      const burst = document.createElement('span')
      burst.className = 'craft-burst'
      burst.style.left = `${meet.x}px`
      burst.style.top = `${meet.y}px`
      stage.appendChild(burst)
      timers.push(window.setTimeout(() => burst.remove(), 500))
      setCrafting(0)
      const torch = slots.current.get('torch')
      const to = torch ? rect(torch) : meet
      fly('textures/block/torch.png', meet, to, 520)
    }, 740))
    return () => timers.forEach(timer => window.clearTimeout(timer))
  }, [crafting, box, slots])
  return crafting !== 0
}
