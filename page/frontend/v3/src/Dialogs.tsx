import { useAtom, useAtomValue } from 'jotai'
import { motion } from 'motion/react'
import type { ReactNode } from 'react'
import { useEffect, useRef } from 'react'
import { ItemIcon } from '../../src/ItemIcon'
import { SHAPE_NAMES, SHAPES } from './items'
import { dialogAtom, meAtom, applyItem } from './state'
import type { Shape } from './types'
import { money } from './types'

/**
 * 道具的弹窗（docs/V3_ITEMS.md §3、§5）：末影箱（存一半、毁一半，先看清楚再确认）、附魔台
 * （两种形状挑一种）、宝库开出了什么。点遮罩、按 Esc、点取消都是关掉，不用道具。
 */
export function ItemDialogs() {
  const [dialog, setDialog] = useAtom(dialogAtom)
  const me = useAtomValue(meAtom)
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
  let icon: 'ender' | 'table' | 'vault' = 'vault'
  if (dialog.type === 'ender') {
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
        <button type="button" className="is-primary" onClick={() => { close(); void applyItem('ender') }}>存一半、毁一半</button>
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
  } else {
    title = '宝库开了'
    body = <>
      <p className="vault-result">{dialog.kind ? <ItemIcon kind={dialog.kind} size={32} /> : null}<span>{dialog.text}</span></p>
      <div className="dialog-actions"><button type="button" ref={first} className="is-primary" onClick={close}>知道了</button></div>
    </>
  }
  return <div className="item-dialog-backdrop" onClick={close}>
    <motion.section className="item-dialog" role="dialog" aria-modal="true" aria-label={title} onClick={event => event.stopPropagation()}
      initial={{ opacity: 0, scale: 0.94 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}>
      <h2><ItemIcon kind={icon} size={22} />{title}{dialog.type === 'ender' ? <small>只能用一次</small> : dialog.type === 'table' ? <small>二选一</small> : null}</h2>
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
