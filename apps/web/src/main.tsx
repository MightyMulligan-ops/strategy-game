import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

const root = createRoot(document.getElementById('root')!)
// Explicit fixture-only development entry; never bypasses auth in a production build.
if (import.meta.env.DEV && new URLSearchParams(window.location.search).get('prototype') === 'europe-map') {
  void import('./europe/EuropeMapPrototype.tsx').then(({ default: EuropeMapPrototype }) => {
    root.render(<StrictMode><EuropeMapPrototype /></StrictMode>)
  })
} else root.render(
  <StrictMode>
    <App />
  </StrictMode>,
)
