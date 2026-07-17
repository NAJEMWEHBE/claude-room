import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
// canonical Room module — the-room submodule (room-reunify 2026-07-17).
// Defaults fit claude-room exactly: 'You prompted', same-origin /api endpoints.
import { Room } from 'the-room'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Room />
  </StrictMode>,
)
