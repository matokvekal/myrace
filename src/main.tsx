import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import './app/globals.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <BrowserRouter basename={import.meta.env.BASE_URL}>
    <App />
  </BrowserRouter>
)

// The service worker is registered in useServiceWorkerUpdate (mounted via
// <UpdatePrompt/>) so registration and update-detection live in one place.
