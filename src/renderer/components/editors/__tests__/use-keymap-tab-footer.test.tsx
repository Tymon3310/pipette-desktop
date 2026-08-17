// SPDX-License-Identifier: GPL-2.0-or-later
// @vitest-environment jsdom

import { describe, it, expect, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { render, screen, fireEvent } from '@testing-library/react'
import { useKeymapTabFooter } from '../use-keymap-tab-footer'
import type { UseKeymapTabFooterOptions } from '../use-keymap-tab-footer'

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

function createDefaultOptions(overrides: Partial<UseKeymapTabFooterOptions> = {}): UseKeymapTabFooterOptions {
  return {
    openSettings: vi.fn(),
    tdJson: { show: false, open: vi.fn(), close: vi.fn(), apply: vi.fn() },
    comboJson: { show: false, open: vi.fn(), close: vi.fn(), apply: vi.fn() },
    koJson: { show: false, open: vi.fn(), close: vi.fn(), apply: vi.fn() },
    arkJson: { show: false, open: vi.fn(), close: vi.fn(), apply: vi.fn() },
    macroJson: { show: false, openGated: vi.fn(), close: vi.fn(), apply: vi.fn() },
    ...overrides,
  }
}

describe('useKeymapTabFooter — Keychron specific UI buttons', () => {
  it('hides all Keychron buttons when no Keychron handlers are provided', () => {
    const opts = createDefaultOptions()
    const { result } = renderHook(() => useKeymapTabFooter(opts))

    // Behavior tab
    if (result.current.behavior) {
      render(<div>{result.current.behavior}</div>)
      expect(screen.queryByTestId('keychron-settings-btn')).toBeNull()
      expect(screen.queryByTestId('keychron-analog-settings-btn')).toBeNull()
      expect(screen.queryByTestId('keychron-socd-settings-btn')).toBeNull()
    }

    // Lighting tab
    if (result.current.lighting) {
      render(<div>{result.current.lighting}</div>)
      expect(screen.queryByTestId('keychron-rgb-settings-btn')).toBeNull()
    }

    // System tab
    if (result.current.system) {
      render(<div>{result.current.system}</div>)
      expect(screen.queryByTestId('keychron-flasher-btn')).toBeNull()
    }
  })

  it('shows Keychron Settings button on behavior tab and fires onOpenKeychron on click', () => {
    const onOpenKeychron = vi.fn()
    const opts = createDefaultOptions({ onOpenKeychron })
    const { result } = renderHook(() => useKeymapTabFooter(opts))

    expect(result.current.behavior).toBeDefined()
    render(<div>{result.current.behavior}</div>)

    const btn = screen.getByTestId('keychron-settings-btn')
    expect(btn).toBeInTheDocument()
    expect(btn).toHaveTextContent('Keychron')

    fireEvent.click(btn)
    expect(onOpenKeychron).toHaveBeenCalledTimes(1)
  })

  it('shows Keychron RGB button on lighting tab and fires onOpenKeychronRgb on click', () => {
    const onOpenKeychronRgb = vi.fn()
    const opts = createDefaultOptions({ onOpenKeychronRgb })
    const { result } = renderHook(() => useKeymapTabFooter(opts))

    expect(result.current.lighting).toBeDefined()
    render(<div>{result.current.lighting}</div>)

    const btn = screen.getByTestId('keychron-rgb-settings-btn')
    expect(btn).toBeInTheDocument()
    expect(btn).toHaveTextContent('Keychron RGB')

    fireEvent.click(btn)
    expect(onOpenKeychronRgb).toHaveBeenCalledTimes(1)
  })

  it('shows Keychron HE (Analog) button on behavior tab and fires onOpenKeychronAnalog on click', () => {
    const onOpenKeychronAnalog = vi.fn()
    const opts = createDefaultOptions({ onOpenKeychronAnalog })
    const { result } = renderHook(() => useKeymapTabFooter(opts))

    expect(result.current.behavior).toBeDefined()
    render(<div>{result.current.behavior}</div>)

    const btn = screen.getByTestId('keychron-analog-settings-btn')
    expect(btn).toBeInTheDocument()
    expect(btn).toHaveTextContent('Keychron HE')

    fireEvent.click(btn)
    expect(onOpenKeychronAnalog).toHaveBeenCalledTimes(1)
  })

  it('shows Snap Click (SOCD) button on behavior tab and fires onOpenKeychronSocd on click', () => {
    const onOpenKeychronSocd = vi.fn()
    const opts = createDefaultOptions({ onOpenKeychronSocd })
    const { result } = renderHook(() => useKeymapTabFooter(opts))

    expect(result.current.behavior).toBeDefined()
    render(<div>{result.current.behavior}</div>)

    const btn = screen.getByTestId('keychron-socd-settings-btn')
    expect(btn).toBeInTheDocument()
    expect(btn).toHaveTextContent('Snap Click (SOCD)')

    fireEvent.click(btn)
    expect(onOpenKeychronSocd).toHaveBeenCalledTimes(1)
  })

  it('shows Keychron Flasher button on system tab and fires onOpenKeychronFlasher on click', () => {
    const onOpenKeychronFlasher = vi.fn()
    const opts = createDefaultOptions({ onOpenKeychronFlasher })
    const { result } = renderHook(() => useKeymapTabFooter(opts))

    expect(result.current.system).toBeDefined()
    render(<div>{result.current.system}</div>)

    const btn = screen.getByTestId('keychron-flasher-btn')
    expect(btn).toBeInTheDocument()
    expect(btn).toHaveTextContent('Keychron Flasher')

    fireEvent.click(btn)
    expect(onOpenKeychronFlasher).toHaveBeenCalledTimes(1)
  })
})
