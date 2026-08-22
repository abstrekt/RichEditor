import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import './index.css'

const root = document.getElementById('root')
if (!root) throw new Error('#root not found')

createRoot(root).render(
  /* StrictMode stays on deliberately. It double-invokes effects in
     development, which surfaces exactly the bug this codebase is most likely
     to write: a selection-restore effect that isn't idempotent. Free stress
     test for the one thing that's hardest to get right. */
  <StrictMode>
    <App />
  </StrictMode>,
)
