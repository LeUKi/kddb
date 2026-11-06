import { useAtomValue } from 'jotai'
import { useCallback, useEffect, useState } from 'react'
import { CaveScene } from '../../src/CaveScene'
import { BottomBar, Rules, TopBar } from './Hud'
import { MapView } from './MapView'
import { phaseAtom, problemAtom, signIn, start, toastAtom } from './state'
import type { PublicCard } from './types'

export function App() {
  const phase = useAtomValue(phaseAtom)
  const problem = useAtomValue(problemAtom)
  const [card, setCard] = useState<PublicCard | null>(null)
  const [rules, setRules] = useState(false)
  const onFocus = useCallback((next: PublicCard | null) => setCard(next), [])

  useEffect(() => {
    void start()
  }, [])

  // 素材路径跟着网页走（线上在 /v3/ 下，开发包里在根上）
  useEffect(() => {
    document.documentElement.style.setProperty('--stone', `url("${new URL('assets/minecraft/1.21.4/textures/block/stone.png', document.baseURI)}")`)
  }, [])

  return <div className="v3-app">
    <CaveScene />
    {phase === 'starting' ? <div className="state-card"><div className="sheen" /><p>正在打开矿洞…</p></div>
      : phase === 'login' ? <div className="state-card"><p>登录以后才能挖宝</p><button type="button" onClick={() => void signIn()}>登录</button></div>
        : phase === 'error' ? <div className="state-card"><p>{problem}</p><button type="button" onClick={() => void start()}>再试一次</button></div>
          : <>
            <TopBar onRules={() => setRules(true)} />
            <MapView onFocus={onFocus} />
            <BottomBar card={card} />
          </>}
    {rules ? <Rules onClose={() => setRules(false)} /> : null}
    <Toast />
  </div>
}

function Toast() {
  const toast = useAtomValue(toastAtom)
  const [shown, setShown] = useState(toast)
  useEffect(() => {
    setShown(toast)
    if (!toast) return
    const timer = window.setTimeout(() => setShown(null), 3200)
    return () => window.clearTimeout(timer)
  }, [toast])
  return shown ? <div className={`toast tone-${shown.tone}`} role="status" key={shown.id}>{shown.text}</div> : null
}
