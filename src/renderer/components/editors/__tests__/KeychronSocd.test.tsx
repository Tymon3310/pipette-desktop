// SPDX-License-Identifier: GPL-3.0-or-later
// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { KeychronSocd } from '../KeychronSocd'
import { emptyKeychronState } from '../../../../shared/types/keychron'
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

// Global mock for ResizeObserver
global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

describe('KeychronSocd', () => {
  const mockKeys: KleKey[] = [
    { x: 0, y: 0, width: 1, height: 1, row: 0, col: 0, rotation: 0, rotationX: 0, rotationY: 0, x2: 0, y2: 0, width2: 1, height2: 1, encoderIdx: -1, encoderDir: 0 },
    { x: 1, y: 0, width: 1, height: 1, row: 0, col: 1, rotation: 0, rotationX: 0, rotationY: 0, x2: 0, y2: 0, width2: 1, height2: 1, encoderIdx: -1, encoderDir: 0 },
  ]
  const mockKeymap = new Map<string, number>([
    ['0,0,0', 0x0004], // 'A' on layer 0
    ['0,0,1', 0x0007], // 'D' on layer 0
  ])

  beforeEach(() => {
    window.vialAPI = {
      ...window.vialAPI,
      keychronSetSnapClick: vi.fn().mockResolvedValue(true),
      keychronSaveSnapClick: vi.fn().mockResolvedValue(true),
    } as unknown as typeof window.vialAPI
  })

  it('renders SOCD pairs and modal shell', () => {
    const keychron = {
      ...emptyKeychronState(),
      hasSnapClick: true,
      snapClickCount: 1,
      snapClickEntries: [{ type: 1, key1: 0x04, key2: 0x07 }],
      defaultLayer: 0,
    }

    render(
      <KeychronSocd
        keychron={keychron}
        keys={mockKeys}
        keymap={mockKeymap}
        onClose={vi.fn()}
      />,
    )

    expect(screen.getByTestId('keychron-socd')).toBeInTheDocument()
    expect(screen.getByText('Pair 1')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Key 1/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Key 2/i })).toBeInTheDocument()
  })

  it('enters key pick mode when Key 1 button is clicked and shows keyboard widget', () => {
    const keychron = {
      ...emptyKeychronState(),
      hasSnapClick: true,
      snapClickCount: 1,
      snapClickEntries: [{ type: 1, key1: 0x04, key2: 0x07 }],
      defaultLayer: 0,
    }

    render(
      <KeychronSocd
        keychron={keychron}
        keys={mockKeys}
        keymap={mockKeymap}
        onClose={vi.fn()}
      />,
    )

    const key1Btn = screen.getByRole('button', { name: /Key 1/i })
    fireEvent.click(key1Btn)

    expect(screen.getByText(/Click a key on the keyboard to assign it as Key 1 for SOCD pair #1/i)).toBeInTheDocument()
    expect(screen.getByText('Cancel')).toBeInTheDocument()
  })

  it('assigns key and calls IPC when a key is picked in pick mode', async () => {
    const onSettingChanged = vi.fn()
    const keychron = {
      ...emptyKeychronState(),
      hasSnapClick: true,
      snapClickCount: 1,
      snapClickEntries: [{ type: 1, key1: 0x04, key2: 0x07 }],
      defaultLayer: 0,
    }

    render(
      <KeychronSocd
        keychron={keychron}
        keys={mockKeys}
        keymap={mockKeymap}
        onSettingChanged={onSettingChanged}
        onClose={vi.fn()}
      />,
    )

    // Enter pick mode for Key 1
    fireEvent.click(screen.getByRole('button', { name: /Key 1/i }))

    // Click the key at row 0, col 1 in the KeyboardWidget
    const keyWidget = screen.getByText('D')
    fireEvent.click(keyWidget)

    await waitFor(() => {
      expect(window.vialAPI.keychronSetSnapClick).toHaveBeenCalledWith(0, 1, 0x07, 0x07)
      expect(window.vialAPI.keychronSaveSnapClick).toHaveBeenCalled()
      expect(onSettingChanged).toHaveBeenCalled()
    })
  })

  it('changes snap click type resolution mode', async () => {
    const onSettingChanged = vi.fn()
    const keychron = {
      ...emptyKeychronState(),
      hasSnapClick: true,
      snapClickCount: 1,
      snapClickEntries: [{ type: 1, key1: 0x04, key2: 0x07 }],
      defaultLayer: 0,
    }

    render(
      <KeychronSocd
        keychron={keychron}
        keys={mockKeys}
        keymap={mockKeymap}
        onSettingChanged={onSettingChanged}
        onClose={vi.fn()}
      />,
    )

    const select = screen.getByRole('combobox')
    fireEvent.change(select, { target: { value: '2' } })

    await waitFor(() => {
      expect(window.vialAPI.keychronSetSnapClick).toHaveBeenCalledWith(0, 2, 0x04, 0x07)
      expect(window.vialAPI.keychronSaveSnapClick).toHaveBeenCalled()
      expect(onSettingChanged).toHaveBeenCalled()
    })
  })
})
