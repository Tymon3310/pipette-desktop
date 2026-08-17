// SPDX-License-Identifier: GPL-2.0-or-later
// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useKeyboard } from '../useKeyboard'
import { emptyKeychronState } from '../../../shared/types/keychron'

describe('useKeyboard — Keychron state & reload', () => {
  beforeEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(window as any).vialAPI = {
      getProtocolVersion: vi.fn().mockResolvedValue(9),
      getKeyboardId: vi.fn().mockResolvedValue({ vialProtocol: 6, uid: '0x12345678' }),
      getLayerCount: vi.fn().mockResolvedValue(4),
      pipetteSettingsGet: vi.fn().mockResolvedValue(null),
      getMacroCount: vi.fn().mockResolvedValue(16),
      getMacroBufferSize: vi.fn().mockResolvedValue(900),
      getDefinition: vi.fn().mockResolvedValue({
        name: 'Keychron Q1 HE',
        matrix: { rows: 6, cols: 16 },
        layouts: { keymap: [] },
      }),
      getLayoutOptions: vi.fn().mockResolvedValue(0),
      getKeymapBuffer: vi.fn().mockResolvedValue([]),
      qmkSettingsQuery: vi.fn().mockResolvedValue([0xffff, 0xffff]),
      getDynamicEntryCount: vi.fn().mockResolvedValue({ tapDance: 0, combo: 0, keyOverride: 0, altRepeatKey: 0, featureFlags: 0 }),
      getMacroBuffer: vi.fn().mockResolvedValue([]),
      getUnlockStatus: vi.fn().mockResolvedValue({ unlocked: true, inProgress: false, keys: [] }),
      keychronReload: vi.fn().mockResolvedValue({
        ...emptyKeychronState(),
        hasDefaultLayer: true,
        defaultLayer: 2, // Windows mode
        hasSnapClick: true,
      }),
    }
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('populates Keychron state on reload', async () => {
    const { result } = renderHook(() => useKeyboard())

    await act(async () => {
      await result.current.reload()
    })

    expect(result.current.keychron).toBeDefined()
    expect(result.current.keychron?.defaultLayer).toBe(2)
    expect(result.current.keychron?.hasSnapClick).toBe(true)
  })

  it('refreshes Keychron state when refreshKeychron is called', async () => {
    const { result } = renderHook(() => useKeyboard())

    // Initial reload
    await act(async () => {
      await result.current.reload()
    })

    // Simulate switch position change
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(window as any).vialAPI.keychronReload = vi.fn().mockResolvedValue({
      ...emptyKeychronState(),
      hasDefaultLayer: true,
      defaultLayer: 0, // Mac mode
    })

    await act(async () => {
      await result.current.refreshKeychron()
    })

    expect(result.current.keychron?.defaultLayer).toBe(0)
  })
})
