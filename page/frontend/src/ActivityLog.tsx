import { AnimatePresence, motion } from 'motion/react'
import { useReducedMotion } from './useReducedMotion'
import { coordinate, loot, type PublicGame } from './game'
import { ItemIcon } from './ItemIcon'
import './activity-log.css'

const clock = new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })

/** Display only the judge's persisted public events; private outcomes stay private. */
export function ActivityLog({ feed }: { feed: PublicGame['feed'] }) {
  const reduced = useReducedMotion()
  const entries = feed.slice(0, 10)

  return <section className="activity-log" aria-labelledby="activity-log-title" data-testid="activity-log">
    <header className="activity-log-heading">
      <h2 id="activity-log-title">挖掘动态</h2>
      {entries.length > 0 && <span>最近 {entries.length} 条</span>}
    </header>
    {entries.length === 0
      ? <p className="activity-log-empty">还没有挖掘记录</p>
      : <ol className="activity-log-list" aria-label="最近挖掘记录" tabIndex={0}>
        <AnimatePresence initial={false} mode="popLayout">
          {entries.map(entry => {
            const date = new Date(entry.at)
            const validDate = Number.isFinite(date.getTime())
            const text = entry.kind === 'totem'
              ? entry.text.replace(/不死图腾|图腾/g, loot.totem.name)
              : entry.text

            return <motion.li
              key={entry.id}
              className="activity-log-entry"
              layout={reduced ? false : 'position'}
              initial={{ opacity: 0, y: reduced ? 0 : 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, transition: { duration: reduced ? 0 : .12 } }}
              transition={{ duration: reduced ? 0 : .3, ease: [.22, 1, .36, 1] }}
            >
              <div className="activity-log-icon"><ItemIcon kind={entry.kind} size={28} /></div>
              <div className="activity-log-content">
                <p><strong>{entry.actor}</strong> <span>{text}</span></p>
                <div className="activity-log-meta">
                  <span>第 {entry.cardId} 张 · {coordinate(entry.index)}</span>
                  {validDate && <time dateTime={date.toISOString()} title={date.toLocaleString('zh-CN')}>{clock.format(date)}</time>}
                </div>
              </div>
            </motion.li>
          })}
        </AnimatePresence>
      </ol>}
  </section>
}
