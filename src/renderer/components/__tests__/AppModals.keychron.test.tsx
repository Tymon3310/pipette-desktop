// SPDX-License-Identifier: GPL-2.0-or-later
// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/no-explicit-any */

import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { AppModals } from '../AppModals'
import { emptyKeychronState } from '../../../shared/types/keychron'
import type { KeychronAnalogState } from '../../../shared/types/keychron'

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => {} },
  useTranslation: () => ({
    t: (k: string, fallbackOrParams?: string | Record<string, unknown>, params?: Record<string, unknown>) => {
      let str = typeof fallbackOrParams === 'string' ? fallbackOrParams : k
      const p = typeof fallbackOrParams === 'object' && fallbackOrParams !== null ? fallbackOrParams : params
      if (p) {
        for (const [key, val] of Object.entries(p)) {
          str = str.replace(`{{${key}}}`, String(val))
        }
      }
      return str
    },
  }),
}))

vi.mock('../../hooks/useAppConfig', () => ({
  useAppConfig: () => ({ config: { language: 'en' }, updateConfig: vi.fn() }),
}))

global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function createDefaultProps() {
  const dummyKeychron = {
    ...emptyKeychronState(),
    hasRgb: true,
    rgb: {
      protocolVersion: 1,
      ledCount: 1,
      perKeyRGBType: 0,
      perKeyColors: [[0, 255, 255]],
      osIndicatorConfig: null,
      ledMatrix: new Map([['0,0', 0]]),
      mixedRGBLayers: 0,
      mixedRGBEffectsPerLayer: 0,
      mixedRGBRegions: [],
      mixedRGBEffects: [],
    },
    hasSnapClick: true,
    snapClickCount: 1,
    snapClickEntries: [{ type: 1, key1: 0x04, key2: 0x07 }],
    hasAnalog: true,
    defaultLayer: 0,
  }

  const dummyAnalogData: KeychronAnalogState = {
    version: 1,
    profileCount: 1,
    currentProfile: 0,
    profileSize: 256,
    okmcCount: 1,
    socdCount: 1,
    gameControllerMode: 0,
    curve: [],
    profiles: [
      {
        name: 'Profile 1',
        keyConfigs: new Map(),
        socdPairs: [],
        okmcConfigs: [],
      },
    ],
  }

  return {
    device: {
      connectedDevice: null,
      isDummy: false,
      connectDevice: vi.fn(),
      setSuppressDisconnect: vi.fn(),
    } as any,
    keyboard: {
      keychron: dummyKeychron,
      layout: { keys: [] },
      keymap: new Map(),
      rows: 1,
      cols: 1,
      unlockStatus: { unlocked: true, inProgress: false, keys: [] },
      vialRGBMode: 0,
      vialRGBSpeed: 128,
      vialRGBHue: 0,
      vialRGBSat: 255,
      vialRGBVal: 255,
      vialRGBMaxBrightness: 255,
      vialRGBSupported: [],
      setVialRGBMode: vi.fn(),
      setVialRGBSpeed: vi.fn(),
      setVialRGBColor: vi.fn(),
      setVialRGBBrightness: vi.fn(),
      refreshKeychron: vi.fn(),
      serialize: vi.fn(),
      applyVilFile: vi.fn(),
      reload: vi.fn(),
    } as any,
    editorUI: {
      showUnlockDialog: false,
      setShowUnlockDialog: vi.fn(),
      showLightingModal: false,
      setShowLightingModal: vi.fn(),
      showComboModal: false,
      setShowComboModal: vi.fn(),
      showAltRepeatKeyModal: false,
      setShowAltRepeatKeyModal: vi.fn(),
      showKeyOverrideModal: false,
      setShowKeyOverrideModal: vi.fn(),
    } as any,
    devicePrefs: {} as any,
    hub: {} as any,
    startupNotification: { activeNotification: null, dismiss: vi.fn() } as any,
    missingKeyLabel: { missingKeyLabelNotice: null, dismissMissingKeyLabelNotice: vi.fn() } as any,
    decodedLayoutOptions: new Map<number, number>(),
    deserializedMacros: [],
    keychronSupported: true,
    isBridge: false,
    showKeychronModal: false,
    setShowKeychronModal: vi.fn(),
    showKeychronRgbModal: false,
    setShowKeychronRgbModal: vi.fn(),
    showKeychronFlasherModal: false,
    setShowKeychronFlasherModal: vi.fn(),
    showKeychronAnalogModal: false,
    setShowKeychronAnalogModal: vi.fn(),
    showKeychronSocdModal: false,
    setShowKeychronSocdModal: vi.fn(),
    keychronAnalogData: dummyAnalogData,
    setKeychronAnalogData: vi.fn(),
    handleOpenKeychronAnalog: vi.fn(),
  }
}

describe('AppModals — Keychron Modals visibility', () => {
  it('does not render any Keychron modal when all flags are false', () => {
    const props = createDefaultProps()
    render(<AppModals {...props} />)

    expect(screen.queryByTestId('keychron-modal')).toBeNull()
    expect(screen.queryByTestId('keychron-rgb-modal')).toBeNull()
    expect(screen.queryByTestId('keychron-analog-modal')).toBeNull()
    expect(screen.queryByTestId('keychron-socd')).toBeNull()
    expect(screen.queryByText('Keychron Firmware Flasher')).toBeNull()
  })

  it('renders Keychron Settings modal when showKeychronModal is true', () => {
    const props = { ...createDefaultProps(), showKeychronModal: true }
    render(<AppModals {...props} />)
    expect(screen.getByTestId('keychron-modal')).toBeInTheDocument()
  })

  it('renders Keychron RGB modal when showKeychronRgbModal is true', () => {
    const props = { ...createDefaultProps(), showKeychronRgbModal: true }
    render(<AppModals {...props} />)
    expect(screen.getByTestId('keychron-rgb-modal')).toBeInTheDocument()
  })

  it('renders Keychron HE Analog modal when showKeychronAnalogModal is true', () => {
    const props = { ...createDefaultProps(), showKeychronAnalogModal: true }
    render(<AppModals {...props} />)
    expect(screen.getByTestId('keychron-analog-modal')).toBeInTheDocument()
  })

  it('renders Keychron SOCD modal when showKeychronSocdModal is true', () => {
    const props = { ...createDefaultProps(), showKeychronSocdModal: true }
    render(<AppModals {...props} />)
    expect(screen.getByTestId('keychron-socd')).toBeInTheDocument()
  })

  it('renders Keychron DFU Flasher modal when showKeychronFlasherModal is true', () => {
    const props = { ...createDefaultProps(), showKeychronFlasherModal: true }
    render(<AppModals {...props} />)
    expect(screen.getByText('Keychron Firmware Flasher')).toBeInTheDocument()
  })
})
