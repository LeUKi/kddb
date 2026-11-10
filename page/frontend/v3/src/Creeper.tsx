import { useAtomValue } from 'jotai'
import { useEffect, useRef, useState } from 'react'
import { play } from './sound'
import { creeperAtAtom, creeperBoom, meAtom, settledAtom, toast, totalOf } from './state'
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

  useEffect(() => {
    if (!active) return
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), 250)
    return () => window.clearInterval(timer)
  }, [active, at])

  const coming = active && at !== null && now >= at
  const left = active && at !== null ? at + CREEPER_WARN_MS - now : CREEPER_WARN_MS

  useEffect(() => {
    if (!coming || at === null || hissed.current === at) return
    hissed.current = at
    play('fuse')
  }, [coming, at])

  useEffect(() => {
    if (!coming || at === null || left > 0 || booming.current === at) return
    booming.current = at
    void creeperBoom().then(lost => {
      if (!lost) return
      setFlash(Date.now())
      play('tnt')
      toast(`苦力怕炸掉了手上的 ${money(lost)}`, 'bad')
    })
  }, [coming, at, left])

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
