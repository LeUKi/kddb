import { useAtomValue } from 'jotai'
import { useEffect, useRef, useState } from 'react'
import { play } from './sound'
import { creeperAtAtom, creeperBoom, creeperShownAtom, meAtom, settledAtom, store, toast, totalOf } from './state'
import { money } from './types'

/** 苦力怕探头以后倒数多久（游戏站核对时也是 10 秒）。 */
export const CREEPER_WARN_MS = 10_000

/**
 * 苦力怕（docs/V3_ITEMS.md §3，防蹲守）：手上有分、开着网页、很久没挖也没用道具，它从地图右边
 * 探头，“嘶……”，倒数 10 秒；最后几秒胀大、闪白，和游戏里一样。这 10 秒里挖一格、用道具或领取，
 * 游戏站重新计时，它就走开；没走开就炸掉手上的 20%（末影箱里的炸不到），由游戏站核对时间再扣。
 */
export function Creeper() {
  const at = useAtomValue(creeperAtAtom)
  const me = useAtomValue(meAtom)
  const settled = useAtomValue(settledAtom)
  const [now, setNow] = useState(() => Date.now())
  const [flash, setFlash] = useState(0)
  const booming = useRef<number | null>(null)
  const hissed = useRef<number | null>(null)
  const active = at !== null && !settled && me?.status === 'playing' && (me?.points ?? 0) > 0

  // 没到时候就睡到那一刻（以前一直每 250 毫秒走一下）；来了以后每 250 毫秒走一下，倒数和胀大要用
  useEffect(() => {
    if (!active || at === null) return
    let timer = 0
    const tick = () => {
      const time = Date.now()
      setNow(time)
      timer = window.setTimeout(tick, time < at ? Math.min(at - time, 60_000) : 250)
    }
    tick()
    return () => window.clearTimeout(timer)
  }, [active, at])

  // 只在看得见的时候来：网页在后台（切走的标签页、锁屏回来）时不倒数，回来以后从头给 10 秒（审查发现：
  // 后台里倒数没人看见，手机锁屏回来一打开就炸了）
  const [visible, setVisible] = useState(() => document.visibilityState === 'visible')
  useEffect(() => {
    const onChange = () => setVisible(document.visibilityState === 'visible')
    document.addEventListener('visibilitychange', onChange)
    return () => document.removeEventListener('visibilitychange', onChange)
  }, [])
  /** 本机：苦力怕在画面上探头的时刻（从这时起倒数 10 秒） */
  const [shownAt, setShownAt] = useState<number | null>(null)
  const due = active && at !== null && now >= at
  // 游戏站给了新的时刻（挖了、用了道具、没炸成）：重新来过
  const lastAt = useRef(at)
  useEffect(() => {
    const changed = lastAt.current !== at
    lastAt.current = at
    if (!due || !visible || changed) setShownAt(due && visible ? Date.now() : null)
    else setShownAt(value => value ?? Date.now())
  }, [due, visible, at])
  const coming = due && visible && shownAt !== null
  // 顶上那一行它最优先：步骤条、通知让开
  useEffect(() => {
    store.set(creeperShownAtom, coming)
    return () => store.set(creeperShownAtom, false)
  }, [coming])
  const left = coming && shownAt !== null ? shownAt + CREEPER_WARN_MS - now : CREEPER_WARN_MS

  useEffect(() => {
    if (!coming || shownAt === null || hissed.current === shownAt) return
    hissed.current = shownAt
    play('fuse')
  }, [coming, shownAt])

  useEffect(() => {
    if (!coming || shownAt === null || left > 0 || booming.current === shownAt) return
    booming.current = shownAt
    void creeperBoom().then(lost => {
      if (!lost) return
      setFlash(Date.now())
      play('tnt')
      toast(`苦力怕炸掉了手上的 ${money(lost)}`, 'bad')
    })
  }, [coming, shownAt, left])

  useEffect(() => {
    if (!flash) return
    const timer = window.setTimeout(() => setFlash(0), 700)
    return () => window.clearTimeout(timer)
  }, [flash])

  const chest = me && totalOf(me) > me.points
  return <>
    <div className={`creeper${coming ? ' is-on' : ''}${coming && left <= 3000 ? ' is-swell' : ''}${coming && left <= 1200 ? ' is-fast' : ''}`} aria-hidden="true">
      <span className="creeper-face" />
    </div>
    {coming ? <p className="creeper-hiss" aria-hidden="true">嘶……</p> : null}
    {coming ? <div className="item-tip creeper-tip" role="alert">
      <b className="is-green">苦力怕来了</b>
      {Math.max(0, Math.ceil(left / 1000))} 秒内挖一格、用个道具或者见好就收，它就走开；不然炸掉手上的 20%{chest ? '，末影箱里的炸不到' : ''}。
    </div> : null}
    {flash ? <div key={flash} className="creeper-flash" aria-hidden="true" /> : null}
  </>
}
