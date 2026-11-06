import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useState } from 'react'
import { ItemIcon } from '../../src/ItemIcon'
import type { Kind, Rules } from './types'
import { money } from './types'

// 首次练习（docs/V3_MAP.md §6）：两张 3×3 的小卡，演示挖到奖励、末影珍珠长出新卡、
// 换到新卡、TNT 扣分和见好就收。全在这里，不连游戏站，不用真机会。

type Step = 'first' | 'pearl' | 'move' | 'tnt' | 'done'
const SCRIPT: Record<'first' | 'pearl' | 'tnt', Kind> = { first: 'emerald', pearl: 'pearl', tnt: 'tnt' }

export const GUIDE_SEEN = 'kddb:v3:guide'

export function Guide({ rules, unit, onClose }: { rules: Rules; unit: string; onClose: () => void }) {
  const reduced = useReducedMotion() ?? false
  const [step, setStep] = useState<Step>('first')
  const [opened, setOpened] = useState<Record<string, Kind>>({})
  const [points, setPoints] = useState(0)
  const [onB, setOnB] = useState(false)
  const penalty = Math.floor(((rules.smallReward) * rules.tntPercent) / 100)
  const grown = step !== 'first' && step !== 'pearl'

  const dig = (card: 'a' | 'b', index: number) => {
    const key = `${card}${index}`
    if (opened[key]) return
    if (card === 'a' && (step === 'first' || step === 'pearl')) {
      const kind = SCRIPT[step]
      setOpened(value => ({ ...value, [key]: kind }))
      if (kind === 'emerald') {
        setPoints(rules.smallReward)
        setStep('pearl')
      } else setStep('move')
    } else if (card === 'b' && step === 'tnt') {
      setOpened(value => ({ ...value, [key]: 'tnt' }))
      setPoints(value => value - penalty)
      setStep('done')
    }
  }

  const words: Record<Step, [string, string]> = {
    first: ['点一格，试着挖一下', '放大到一张卡上才能挖；一格用一次机会。'],
    pearl: [`挖到绿宝石，+${money(rules.smallReward)} ${unit}`, '奖励先记在矿洞里。再挖一格试试。'],
    move: ['末影珍珠！旁边长出了一张新卡', '旧卡挖完以前一直能挖。在地图上拖动或直接点新卡就能过去，这里点「移到新卡」。'],
    tnt: ['到了新卡，再挖一格', '每张卡上都有各种道具，也有 TNT。'],
    done: [`TNT！扣掉 ${rules.tntPercent}%（${money(penalty)} ${unit}）`, `点「见好就收」才领进红包；机会用完、奖池分完会自动领。截止前 2 分钟停止挖掘，没领的作废。`],
  }

  const card = (id: 'a' | 'b') => <div className={`guide-card${(id === 'b') === onB ? ' is-focused' : ''}`}>
    {Array.from({ length: 9 }, (_, index) => {
      const kind = opened[`${id}${index}`]
      const live = id === 'a' ? (step === 'first' || step === 'pearl') && !onB : step === 'tnt' && onB
      return kind
        ? <div key={index} className={`map-cell revealed kind-${kind} is-mine`}><ItemIcon kind={kind} size={22} /></div>
        : <button key={index} type="button" className="map-cell covered" disabled={!live} onClick={() => dig(id, index)} aria-label={`练习格子 ${index + 1}`} />
    })}
  </div>

  return <div className="rules-backdrop" onClick={onClose}>
    <section className="guide" role="dialog" aria-modal="true" aria-label="练习" onClick={event => event.stopPropagation()}>
      <header className="guide-head"><span>练习 · 不用真机会</span><button type="button" className="guide-close" onClick={onClose} aria-label="关闭练习">×</button></header>
      <div className="guide-copy" role="status"><h2>{words[step][0]}</h2><p>{words[step][1]}</p></div>
      <div className="guide-score">示例奖励 <b>{money(points)}</b> {unit}</div>
      <div className="guide-map">
        <motion.div className="guide-world" animate={{ x: onB ? '-50%' : '0%' }} transition={reduced ? { duration: 0 } : { type: 'spring', stiffness: 220, damping: 30 }}>
          {card('a')}
          <AnimatePresence>{grown ? <motion.div key="b" initial={reduced ? false : { opacity: 0, scale: .4, x: -40 }} animate={{ opacity: 1, scale: 1, x: 0 }} transition={{ duration: .6 }}>{card('b')}</motion.div> : null}</AnimatePresence>
        </motion.div>
      </div>
      <div className="guide-actions">
        {step === 'move' ? <button type="button" className="guide-next" onClick={() => { setOnB(true); setStep('tnt') }}>▶ 移到新卡</button> : null}
        {step === 'done' ? <>
          <button type="button" className="guide-again" onClick={() => { setStep('first'); setOpened({}); setPoints(0); setOnB(false) }}>再试一次</button>
          <button type="button" className="guide-start" onClick={onClose}>开始挖宝</button>
        </> : <button type="button" className="guide-skip" onClick={onClose}>跳过练习</button>}
      </div>
    </section>
  </div>
}
