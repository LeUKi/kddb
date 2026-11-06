import { Provider } from 'jotai'
import { MotionConfig } from 'motion/react'
import { createRoot } from 'react-dom/client'
import '../../src/styles.css'
import './v3.css'
import { App } from './App'
import { store } from './state'

createRoot(document.getElementById('root')!).render(
  <Provider store={store}>
    <MotionConfig reducedMotion="user">
      <App />
    </MotionConfig>
  </Provider>,
)
