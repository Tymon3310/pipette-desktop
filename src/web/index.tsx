// SPDX-License-Identifier: GPL-2.0-or-later
// Web entry point for Pipette Web

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { I18nextProvider } from 'react-i18next'
import '../renderer/style.css'
import i18n from '../renderer/i18n'
import { App } from '../renderer/App'
import { AppConfigProvider } from '../renderer/hooks/useAppConfig'
import { UploadConfirmProvider } from '../renderer/hooks/useUploadConfirm'
import { createWebVialAPI } from './vial-api'
import { isWebHIDSupported } from './hid-transport'

// Inject Web VialAPI into window
if (!window.vialAPI) {
  window.vialAPI = createWebVialAPI()
}

const rootEl = document.getElementById('root')
if (rootEl) {
  if (!isWebHIDSupported()) {
    console.warn('WebHID is not supported in this browser. Connecting to physical keyboards requires Chrome, Edge, Brave, or Opera.')
  }

  createRoot(rootEl).render(
    <StrictMode>
      <I18nextProvider i18n={i18n}>
        <AppConfigProvider>
          <UploadConfirmProvider>
            <App />
          </UploadConfirmProvider>
        </AppConfigProvider>
      </I18nextProvider>
    </StrictMode>,
  )
}
