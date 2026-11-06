import { useAtomValue } from 'jotai'
import { motion } from 'motion/react'
import { useEffect, useMemo, useState } from 'react'
import { ItemIcon } from '../../src/ItemIcon'
import type { Mark } from './chart'
import { CHART, chartOf } from './chart'
import { hongbaoAtom, loadSummary, settledAtom, uidAtom } from './state'
import type { Summary } from './types'
import { money } from './types'

// 收益卡（docs/V3_MAP.md §6）：底栏“收益”点开，这一局对他结束了（领到了、奖池分完或机会
// 用完而手里没分）自动弹一次。打开时才向游戏站要数据、才画曲线，平时不占资源。排成一张
// 能直接截图分享的卡：红包名、领到多少、收益曲线、我的数据、全场前几名。

const MARK_NAMES: Record<Mark, string> = { big: '钻石', apple: '金苹果', boom: '踩雷', blocked: '盾牌挡住' }

export function SummaryCard({ reason, onClose }: { reason: 'button' | 'end'; onClose: () => void }) {
  const hongbao = useAtomValue(hongbaoAtom)
  const settled = useAtomValue(settledAtom)
  const uid = useAtomValue(uidAtom)
  const [summary, setSummary] = useState<Summary | null>(null)
  const [problem, setProblem] = useState('')
  const unit = settled?.unit ?? hongbao?.unit ?? 'LDC'

  const load = () => {
    setProblem('')
    loadSummary().then(setSummary, (error: unknown) => setProblem(error instanceof Error ? error.message : '没读到，再试一次'))
  }
  useEffect(load, [])
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const chart = useMemo(() => summary?.me.trail?.length ? chartOf(summary.me.trail) : null, [summary])
  const me = summary?.me
  const ended = reason === 'end'
  const headline = settled ? `领到 ${settled.amount}`
    : me?.status === 'claimed' ? `领取 ${money(me.points)}`
      : me && me.points > 0 ? money(me.points)
        : null

  return <div className="summary-backdrop" onClick={onClose}>
    <motion.section className="summary" role="dialog" aria-modal="true" aria-label="我的收益" onClick={event => event.stopPropagation()}
      initial={{ opacity: 0, y: 18, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ type: 'spring', stiffness: 320, damping: 28 }}>
      <header className="summary-head">
        <span className="summary-brand"><ItemIcon kind="pickaxe" size={16} />{hongbao?.title ? (hongbao.title.includes('矿洞夺宝') ? hongbao.title : `矿洞夺宝 · ${hongbao.title}`) : '矿洞夺宝'}</span>
        <button type="button" className="summary-close" onClick={onClose} aria-label="关闭">×</button>
      </header>
      <h2>{ended ? '这一局结束了' : '我的收益'}</h2>
      {problem ? <div className="summary-problem"><p>{problem}</p><button type="button" onClick={load}>再试一次</button></div>
        : !summary || !me ? <div className="summary-loading" aria-label="正在读"><div className="sheen summary-sheen" /><div className="sheen summary-sheen is-short" /></div>
          : <>
            <p className="summary-amount">
              {headline ? <span className="summary-figure"><strong>{headline}</strong> <small>{unit}</small></span> : <strong className="is-none">这一局没挖到奖励</strong>}
              <span>{me.name}{settled || me.status === 'claimed' ? '' : me.points > 0 ? ' · 还在矿洞里，没领' : ''}</span>
            </p>
            {chart ? <figure className="summary-chart" aria-label={`收益曲线：挖了 ${me.digs} 格，最高 ${money(chart.peak?.points ?? 0)}，最后 ${money(chart.end.points)}`}>
              <svg viewBox={`0 0 ${CHART.width} ${CHART.height}`} preserveAspectRatio="none" aria-hidden="true">
                <defs>
                  <linearGradient id="summary-fill" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0" stopColor="#e9b56b" stopOpacity=".38" />
                    <stop offset="1" stopColor="#e9b56b" stopOpacity="0" />
                  </linearGradient>
                </defs>
                <line x1={CHART.padX} x2={CHART.width - CHART.padX} y1={chart.baseY} y2={chart.baseY} className="chart-base" />
                <motion.path d={chart.area} fill="url(#summary-fill)" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5, duration: 0.5 }} />
                <motion.path d={chart.line} className="chart-line" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }} />
                {chart.markers.map(marker => <motion.circle key={marker.step} cx={marker.x} cy={marker.y} r={marker.mark === 'big' ? 3.6 : 3.2} className={`chart-mark mark-${marker.mark}`}
                  initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.25 + (marker.step / Math.max(1, me.digs)) * 0.7 }} />)}
              </svg>
              {chart.peak ? <span className={`chart-peak${chart.peak.x > CHART.width * 0.7 ? ' is-right' : chart.peak.x < CHART.width * 0.3 ? ' is-left' : ''}`} style={{ left: `${(chart.peak.x / CHART.width) * 100}%`, top: `${(chart.peak.y / CHART.height) * 100}%` }}>最高 {money(chart.peak.points)}</span> : null}
              <figcaption>
                <span>第 1 格</span>
                <span className="chart-legend">{(['big', 'apple', 'boom', 'blocked'] as Mark[]).filter(mark => chart.markers.some(marker => marker.mark === mark)).map(mark =>
                  <span key={mark}><i className={`legend-dot mark-${mark}`} />{MARK_NAMES[mark]}</span>)}</span>
                <span>第 {me.digs} 格</span>
              </figcaption>
            </figure>
              : <p className="summary-note">{me.trail === null ? '你在开始记录以前就来过这一局，没有逐格的曲线。' : '还没挖过，挖几格以后这里会画出收益曲线。'}</p>}
            <dl className="summary-stats">
              <div><dt>挖了</dt><dd>{me.digs} 格</dd></div>
              <div><dt>最大一笔</dt><dd>{me.best > 0 ? `+${money(me.best)}` : '—'}</dd></div>
              <div><dt>踩雷</dt><dd>{me.tnt} 次{me.blocked ? <small>，挡住 {me.blocked} 次</small> : null}</dd></div>
              <div><dt>被炸掉</dt><dd>{me.lost > 0 ? `-${money(me.lost)}` : '—'}</dd></div>
            </dl>
            <section className="summary-top" aria-label="全场领得最多">
              <h3>全场领得最多</h3>
              {summary.top.length === 0 ? <p className="summary-note">还没有人领到奖励。</p>
                : <ol>{summary.top.map((entry, index) => <li key={entry.uid} className={entry.uid === uid ? 'is-me' : ''}>
                  <span className="top-rank">{index + 1}</span>
                  <span className="top-name">{entry.uid === uid ? `${entry.name}（我）` : entry.name}</span>
                  <span className="top-points">{money(entry.points)} <small>{unit}</small></span>
                </li>)}</ol>}
            </section>
            <p className="summary-foot">{summary.stats.players} 人挖过 · {summary.stats.claimed} 人领了 · 奖池{summary.over ? '已经分完' : `还剩 ${money(summary.left)} ${unit}`}</p>
          </>}
      <div className="summary-actions">
        <span>截图就能分享这张卡</span>
        <button type="button" onClick={onClose}>{ended ? '好的' : '知道了'}</button>
      </div>
    </motion.section>
  </div>
}
