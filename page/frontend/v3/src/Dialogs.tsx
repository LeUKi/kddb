import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { motion } from 'motion/react'
import type { ReactNode } from 'react'
import { useEffect, useRef } from 'react'
import type { IconKind } from '../../src/game'
import { ItemIcon } from '../../src/ItemIcon'
import type { Held } from './items'
import { aboutSlot, AIM_TARGET, hasMouse, isHeld, SHAPE_NAMES, SHAPES, shapeOf, skipGuide, SLOT_ICONS, SLOT_NAMES } from './items'
import { applyItem, blockedAtom, dialogAtom, digIntervalAtom, heldAtom, itemsGameAtom, meAtom } from './state'
import type { Shape } from './types'
import { money } from './types'

/**
 * 道具的弹窗（docs/V3_ITEMS.md §3、§5）：末影箱（存一半、毁一半，先看清楚再确认）、附魔台
 * （两种形状挑一种）、宝库开出了什么，和工具条上点一格（用户选的 B：说明和按钮在一起）。
 * 点遮罩、按 Esc、点取消都是关掉，不用道具。
 */
export function ItemDialogs() {
  const [dialog, setDialog] = useAtom(dialogAtom)
  const me = useAtomValue(meAtom)
  const items = useAtomValue(itemsGameAtom)
  const interval = useAtomValue(digIntervalAtom)
  const blocked = useAtomValue(blockedAtom)
  const setHeld = useSetAtom(heldAtom)
  const first = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!dialog) return
    first.current?.focus({ preventScroll: true })
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        setDialog(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [dialog, setDialog])
  if (!dialog || !me) return null
  const close = () => setDialog(null)
  let body: ReactNode = null
  let title = ''
  let icon: IconKind = 'vault'
  let note: ReactNode = null
  if (dialog.type === 'item') {
    const slot = dialog.slot
    const about = aboutSlot(slot, me, items, interval, blocked)
    title = SLOT_NAMES[slot]
    icon = SLOT_ICONS[slot]
    note = about.count
    const held = isHeld(slot) ? slot : null
    body = <>
      {held && shapeOf(held) ? <div className="item-demo"><span className="shape-pick"><ShapeGlyph shape={shapeOf(held)!} big /><ItemIcon kind="pickaxe" size={32} /><span className="glint" /></span></div> : null}
      {held === 'torch' ? <TorchDemo /> : null}
      <p>{about.words}</p>
      {held ? <p className="item-how">{howToAim(held)}</p> : null}
      {/* 按钮（docs/ITEM_UX.md §3.2）：主按钮在最右；“不再提示”只在瞄准类进入前的引导里，靠左 */}
      <div className="dialog-actions">
        {held && dialog.mode === 'enter' ? <>
          <button type="button" className="is-quiet" onClick={() => {
            skipGuide(held)
            close()
            setHeld(held)
          }}>不再提示</button>
          <button type="button" ref={first} onClick={close}>取消</button>
          <button type="button" className="is-primary" onClick={() => {
            close()
            setHeld(held)
          }}>使用</button>
        </> : slot === 'map' || slot === 'potion' ? <>
          <button type="button" ref={first} onClick={close}>取消</button>
          <button type="button" className="is-primary" disabled={!!blocked} onClick={() => {
            close()
            void applyItem(slot)
          }}>使用</button>
        </> : <button type="button" ref={first} className="is-primary" onClick={close}>知道了</button>}
      </div>
    </>
  } else if (dialog.type === 'ender') {
    title = '末影箱'
    icon = 'ender'
    const half = Math.floor(me.points / 2)
    body = me.points <= 0 ? <>
      <p>手上还没有奖励，现在存不了，先留着。</p>
      <div className="dialog-actions"><button type="button" ref={first} onClick={close}>知道了</button></div>
    </> : <>
      <div className="chest-flow">
        <span className="chip">手上 {money(me.points)}</span>
        <span aria-hidden="true">→</span>
        <span className="chip is-green"><ItemIcon kind="ender" size={14} />存进 {money(half)}</span>
        <span className="chip is-gone">毁掉 {money(me.points - half)}</span>
      </div>
      <ul>
        <li>存进去的 TNT、末影水晶、苦力怕都炸不到，金苹果也不翻它，领取时一起加上。</li>
        <li>毁掉的留在红包里，后面的人还能挖到。</li>
        <li>手上从 0 重新攒。一个末影箱只能用一次。</li>
      </ul>
      <div className="dialog-actions">
        <button type="button" ref={first} onClick={close}>取消</button>
        <button type="button" className="is-primary" onClick={() => { close(); void applyItem('ender') }}>使用</button>
      </div>
    </>
  } else if (dialog.type === 'table') {
    title = '附魔台'
    icon = 'table'
    const choices = me.tableChoices ?? []
    body = <>
      <p>随机给两种，挑一种，得到这把附魔镐 2 次。用它不花镐子的机会，一次挖开形状里没挖开的格子。</p>
      <div className="shape-choices">
        {choices.map((shape: Shape) => <button key={shape} type="button" onClick={() => { close(); void applyItem('table', { choice: shape }) }}>
          <span className="shape-pick"><ShapeGlyph shape={shape} big /><ItemIcon kind="pickaxe" size={32} /><span className="glint" /></span>
          <b>{SHAPE_NAMES[shape]}</b>
          <small>一次挖 {SHAPES[shape].length} 格</small>
        </button>)}
      </div>
      <div className="dialog-actions"><button type="button" ref={first} onClick={close}>先不挑</button></div>
    </>
  } else if (dialog.type === 'vault') {
    title = '宝库开了'
    body = <>
      <p className="vault-result">{dialog.kind ? <ItemIcon kind={dialog.kind} size={32} /> : null}<span>{dialog.text}</span></p>
      <div className="dialog-actions"><button type="button" ref={first} className="is-primary" onClick={close}>知道了</button></div>
    </>
  }
  return <div className="item-dialog-backdrop" onClick={close}>
    <motion.section className="item-dialog" role="dialog" aria-modal="true" aria-label={title} onClick={event => event.stopPropagation()}
      initial={{ opacity: 0, scale: 0.94 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}>
      <h2><ItemIcon kind={icon} size={22} />{title}{dialog.type === 'ender' ? <small>只能用一次</small> : dialog.type === 'table' ? <small>二选一</small> : note ? <small>{note}</small> : null}</h2>
      {body}
    </motion.section>
  </div>
}

/** 附魔镐的形状：3×3 的小格子，亮的是会挖的。 */
export function ShapeGlyph({ shape, big = false }: { shape: Shape; big?: boolean }) {
  const on = new Set(SHAPES[shape].map(([row, col]) => `${row},${col}`))
  return <span className={`shape-glyph${big ? ' is-big' : ''}`} aria-hidden="true">
    {[-1, 0, 1].flatMap(row => [-1, 0, 1].map(col => <i key={`${row},${col}`} className={on.has(`${row},${col}`) ? 'on' : ''} />))}
  </span>
}

/** 使用以后怎么选位置：触屏点两下（预览、确认），鼠标指着点一下（docs/ITEM_UX.md §4）。 */
function howToAim(held: Held) {
  const where = AIM_TARGET[held]
  return hasMouse()
    ? `使用以后，指到哪里预览到哪里，点一下确认。顶上会一直有说明和取消。`
    : `使用以后，在地图上点${where}预览位置，同一处再点一次确认。顶上会一直有说明和取消。`
}

/** 火把：3×3 的小格子，亮着四格，火把插在中间那个角上。 */
function TorchDemo() {
  return <div className="item-demo"><span className="torch-demo" aria-hidden="true">
    {Array.from({ length: 9 }, (_, index) => <i key={index} className={[1, 2, 4, 5].includes(index) ? 'on' : ''} />)}
    <ItemIcon kind="torch" size={26} className="torch-demo-torch" />
  </span></div>
}
