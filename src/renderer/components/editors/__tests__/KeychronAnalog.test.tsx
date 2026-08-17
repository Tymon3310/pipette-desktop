// SPDX-License-Identifier: GPL-3.0-or-later
// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { KeychronAnalog } from '../KeychronAnalog'
import type { KeychronAnalogState } from '../../../../shared/types/keychron'
import type { KleKey } from '../../../../shared/kle/types'

vi.mock('react-i18next', () => ({
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

global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

describe('KeychronAnalog', () => {
  const mockKeys: KleKey[] = [
    { x: 0, y: 0, width: 1, height: 1, row: 0, col: 0, rotation: 0, rotationX: 0, rotationY: 0, x2: 0, y2: 0, width2: 1, height2: 1, encoderIdx: -1, encoderDir: 0 },
    { x: 1, y: 0, width: 1, height: 1, row: 0, col: 1, rotation: 0, rotationX: 0, rotationY: 0, x2: 0, y2: 0, width2: 1, height2: 1, encoderIdx: -1, encoderDir: 0 },
  ]
  const mockKeymap = new Map<string, number>([
    ['0,0,0', 0x0004], // 'A'
    ['0,0,1', 0x0007], // 'D'
  ])

  const mockAnalogState: KeychronAnalogState = {
    version: 1,
    profileCount: 3,
    currentProfile: 0,
    profileSize: 256,
    okmcCount: 4,
    socdCount: 2,
    gameControllerMode: 0,
    curve: [0, 0, 85, 85, 170, 170, 255, 255],
    profiles: [
      {
        name: 'Gaming',
        keyConfigs: new Map([
          ['0,0', { mode: 0, actuationPoint: 20, sensitivity: 3, releaseSensitivity: 3, advMode: 0, advModeData: 0 }],
          ['0,1', { mode: 0, actuationPoint: 15, sensitivity: 3, releaseSensitivity: 3, advMode: 0, advModeData: 0 }],
        ]),
        socdPairs: [{ type: 1, key1Row: 0, key1Col: 0, key2Row: 0, key2Col: 1 }],
        okmcConfigs: [
          {
            shallowAct: 10,
            shallowDeact: 8,
            deepAct: 30,
            deepDeact: 28,
            keycodes: [0x04, 0x05, 0x00, 0x00],
            events: [1, 2, 0, 0, 0, 0, 0, 0, 1, 2, 0, 0, 0, 0, 0, 0],
          },
        ],
      },
      {
        name: 'Typing',
        keyConfigs: new Map(),
        socdPairs: [],
        okmcConfigs: [],
      },
      {
        name: 'Profile 3',
        keyConfigs: new Map(),
        socdPairs: [],
        okmcConfigs: [],
      },
    ],
  }

  beforeEach(() => {
    window.vialAPI = {
      ...window.vialAPI,
      keychronAnalogSetProfile: vi.fn().mockResolvedValue(true),
      keychronAnalogSetProfileName: vi.fn().mockResolvedValue(true),
      keychronAnalogResetProfile: vi.fn().mockResolvedValue(true),
      keychronAnalogSetTravel: vi.fn().mockResolvedValue(true),
      keychronAnalogSaveProfile: vi.fn().mockResolvedValue(true),
      keychronAnalogSetSocd: vi.fn().mockResolvedValue(true),
      keychronAnalogSetAdvanceModeDks: vi.fn().mockResolvedValue(true),
      keychronAnalogSetAdvanceModeClear: vi.fn().mockResolvedValue(true),
      keychronAnalogSetGameControllerMode: vi.fn().mockResolvedValue(true),
      keychronAnalogSetCurve: vi.fn().mockResolvedValue(true),
    } as unknown as typeof window.vialAPI
  })

  it('renders tabs and profile buttons', () => {
    render(
      <KeychronAnalog
        analog={mockAnalogState}
        keys={mockKeys}
        rows={1}
        cols={2}
        keymap={mockKeymap}
        defaultLayer={0}
      />,
    )

    expect(screen.getByRole('button', { name: 'Gaming' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Typing' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Actuation' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'DKS (OKMC)' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'SOCD' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Gamepad' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Calibration' })).toBeInTheDocument()
  })

  it('switches profiles when profile button is clicked', async () => {
    render(
      <KeychronAnalog
        analog={mockAnalogState}
        keys={mockKeys}
        rows={1}
        cols={2}
        keymap={mockKeymap}
        defaultLayer={0}
      />,
    )

    const typingProfileBtn = screen.getByRole('button', { name: 'Typing' })
    fireEvent.click(typingProfileBtn)

    await waitFor(() => {
      expect(window.vialAPI.keychronAnalogSetProfile).toHaveBeenCalledWith(1)
    })
  })

  it('switches tabs between Actuation, DKS, and SOCD', () => {
    render(
      <KeychronAnalog
        analog={mockAnalogState}
        keys={mockKeys}
        rows={1}
        cols={2}
        keymap={mockKeymap}
        defaultLayer={0}
      />,
    )

    // Initially on Actuation
    expect(screen.getByRole('button', { name: 'Apply to All Keys' })).toBeInTheDocument()

    // Switch to DKS
    fireEvent.click(screen.getByRole('button', { name: 'DKS (OKMC)' }))
    expect(screen.getByRole('button', { name: /Assign DKS to Selected/i })).toBeInTheDocument()

    // Switch to SOCD
    fireEvent.click(screen.getByRole('button', { name: 'SOCD' }))
    expect(screen.getByText(/Configure Simultaneous Opposite Cardinal Direction/i)).toBeInTheDocument()
  })

  it('applies global travel settings when Apply to All Keys is clicked', async () => {
    render(
      <KeychronAnalog
        analog={mockAnalogState}
        keys={mockKeys}
        rows={1}
        cols={2}
        keymap={mockKeymap}
        defaultLayer={0}
      />,
    )

    const applyAllBtn = screen.getByRole('button', { name: 'Apply to All Keys' })
    fireEvent.click(applyAllBtn)

    await waitFor(() => {
      expect(window.vialAPI.keychronAnalogSetTravel).toHaveBeenCalledWith(
        0, // currentProfile
        0, // globalMode
        20, // globalActPt
        3, // globalSens
        3, // globalRlsSens
        true, // entire
      )
    })
  })
})
