import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { motion } from 'motion/react'
import type { ReactNode } from 'react'
import { useEffect, useRef } from 'react'
import type { IconKind } from '../../src/game'
import { ItemIcon } from '../../src/ItemIcon'
import type { Held, Slot } from './items'
import { CRAFT_NEED, countOf, isHeld, markTaught, SHAPE_NAMES, SHAPES, SHIELD_CAP, shapeOf, SLOT_ICONS, SLOT_NAMES } from './items'
import { applyItem, blockedAtom, dialogAtom, digIntervalAtom, heldAtom, itemsGameAtom, meAtom } from './state'
import type { Me, Shape } from './types'
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
      if (event.key === 'Escape') setDialog(null)
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
      <div className="dialog-actions">
        {held && dialog.teach ? <>
          <button type="button" ref={first} onClick={close}>取消</button>
          <button type="button" className="is-primary" onClick={() => {
            markTaught(held)
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

/** 工具条上一格的说明：右上角的数量、一段话。 */
function aboutSlot(slot: Slot, me: Me, items: boolean, interval: number, blocked: string | null): { count: string; words: string } {
  const count = countOf(me, slot)
  switch (slot) {
    case 'pickaxe': return { count: `还剩 ${me.chances} 次`, words: blocked ?? `点一格没挖开的格子就是挖，用 1 次机会${interval > 1 ? `；每次至少隔 ${interval} 秒` : ''}。` }
    case 'pick-h': case 'pick-v': case 'pick-x': return { count: `还能用 ${count} 次`, words: `一次挖开${SHAPE_NAMES[shapeOf(slot)!]}里没挖开的格子，挖过的跳过；不花镐子的机会。` }
    case 'spyglass': return { count: `还有 ${count} 个`, words: '看一格里是什么，只有你看得见，不花机会。' }
    case 'torch': return { count: `还有 ${count} 个`, words: '插在两格之间的缝上，照亮旁边 4 格：绿色是没有危险，黄色 1～2 个，红色 3～4 个（TNT、末影水晶、刷怪笼）。大家都看得见。' }
    case 'key': return { count: `还有 ${count} 把`, words: '点试炼密室里的宝库开它，开出一样东西；每个宝库每人只能开一次。' }
    case 'map': return { count: `还有 ${count} 张`, words: '随机标出地图上一格奖励（绿宝石常见，钻石少见），只有你看得见，镜头会飞过去。' }
    case 'potion': return { count: `还有 ${count} 瓶`, words: '用了以后 10 秒里，每次挖只要隔 1 秒。' }
    case 'shield': return { count: `${count}/${items ? SHIELD_CAP : 1} 面`, words: `踩到 TNT 或末影水晶时自动挡下一次，用掉一面。${items ? `最多带 ${SHIELD_CAP} 面，再挖到换成一份小奖。` : '再挖到就换成一份小奖。'}` }
    case 'coal': case 'stick': return { count: `${count}/${CRAFT_NEED}`, words: `煤炭、木棍都攒满 ${CRAFT_NEED} 个，自动做成一个火把；满了再挖到不算。` }
    case 'poison': return { count: `还有 ${count} 次`, words: '接下来每挖一次，扣手上 5%，盾牌挡不住。' }
    default: return { count: '', words: '' }
  }
}

/** 点了“使用”以后怎么用：触屏点两下（预览、确认），鼠标指着点一下。道具的按钮都叫“使用”（2026-11-11 用户：“拿起来”难懂）。 */
function howToAim(held: Held) {
  const touch = !window.matchMedia?.('(hover: hover) and (pointer: fine)').matches
  const where = held === 'torch' ? '缝' : held === 'key' ? '宝库' : '格子'
  return touch
    ? `点“使用”以后，在地图上点${where}预览位置，同一处再点一次确认；再点工具条上的它就取消。`
    : `点“使用”以后，指到哪里预览到哪里，点一下确认；右键、Esc 或再点它取消。`
}

/** 火把：3×3 的小格子，亮着四格，火把插在中间那个角上。 */
function TorchDemo() {
  return <div className="item-demo"><span className="torch-demo" aria-hidden="true">
    {Array.from({ length: 9 }, (_, index) => <i key={index} className={[1, 2, 4, 5].includes(index) ? 'on' : ''} />)}
    <ItemIcon kind="torch" size={26} className="torch-demo-torch" />
  </span></div>
}
