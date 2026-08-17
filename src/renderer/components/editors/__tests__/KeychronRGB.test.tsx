// SPDX-License-Identifier: GPL-3.0-or-later
// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { KeychronRGB } from '../KeychronRGB'
import type { KeychronRGBState } from '../../../../shared/types/keychron'
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

vi.mock('../HSVColorPicker', () => ({
  HSVColorPicker: () => <div data-testid="hsv-color-picker" />,
  hsvToRgb: () => [0, 0, 0] as [number, number, number],
  rgbToHsv: () => [0, 0, 0] as [number, number, number],
  rgbToHex: () => '#000000',
  hexToRgb: () => [0, 0, 0] as [number, number, number],
}))

global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

describe('KeychronRGB', () => {
  const mockKeys: KleKey[] = [
    { x: 0, y: 0, width: 1, height: 1, row: 0, col: 0, rotation: 0, rotationX: 0, rotationY: 0, x2: 0, y2: 0, width2: 1, height2: 1, encoderIdx: -1, encoderDir: 0 },
    { x: 1, y: 0, width: 1, height: 1, row: 0, col: 1, rotation: 0, rotationX: 0, rotationY: 0, x2: 0, y2: 0, width2: 1, height2: 1, encoderIdx: -1, encoderDir: 0 },
  ]
  const mockLedMatrix = new Map<string, number>([
    ['0,0', 0],
    ['0,1', 1],
  ])

  const mockRgbState: KeychronRGBState = {
    protocolVersion: 1,
    ledCount: 2,
    perKeyRGBType: 0,
    perKeyColors: [
      [0, 255, 255],
      [128, 255, 255],
    ],
    osIndicatorConfig: null,
    ledMatrix: mockLedMatrix,
    mixedRGBLayers: 2,
    mixedRGBEffectsPerLayer: 2,
    mixedRGBRegions: [0, 1],
    mixedRGBEffects: [
      [
        { effect: 1, hue: 0, sat: 255, speed: 128, time: 1000 },
        { effect: 2, hue: 128, sat: 255, speed: 128, time: 1000 },
      ],
      [
        { effect: 3, hue: 64, sat: 255, speed: 128, time: 1000 },
        { effect: 4, hue: 192, sat: 255, speed: 128, time: 1000 },
      ],
    ],
  }

  beforeEach(() => {
    window.vialAPI = {
      ...window.vialAPI,
      keychronSaveRGB: vi.fn().mockResolvedValue(true),
      keychronSetPerKeyColors: vi.fn().mockResolvedValue(true),
    } as unknown as typeof window.vialAPI
  })

  it('renders RGB editor sections and mode selector', () => {
    render(
      <KeychronRGB
        rgb={mockRgbState}
        ledMatrix={mockLedMatrix}
        keys={mockKeys}
        vialRGBMode={0}
        vialRGBSpeed={128}
        vialRGBHue={0}
        vialRGBSat={255}
        vialRGBVal={255}
        vialRGBMaxBrightness={255}
        vialRGBSupported={[0, 1, 48, 49]}
        onSetVialRGBMode={vi.fn()}
        onSetVialRGBSpeed={vi.fn()}
        onSetVialRGBColor={vi.fn()}
        onSetVialRGBBrightness={vi.fn()}
      />,
    )

    expect(screen.getByTestId('keychron-rgb-editor')).toBeInTheDocument()
    expect(screen.getByTestId('keychron-rgb-mode')).toBeInTheDocument()
    expect(screen.getByTestId('keychron-rgb-brightness')).toBeInTheDocument()
    expect(screen.getByTestId('keychron-rgb-speed')).toBeInTheDocument()
  })

  it('changes mode when mode select value changes', () => {
    const onSetMode = vi.fn()
    render(
      <KeychronRGB
        rgb={mockRgbState}
        ledMatrix={mockLedMatrix}
        keys={mockKeys}
        vialRGBMode={0}
        vialRGBSpeed={128}
        vialRGBHue={0}
        vialRGBSat={255}
        vialRGBVal={255}
        vialRGBMaxBrightness={255}
        vialRGBSupported={[0, 1, 48, 49]}
        onSetVialRGBMode={onSetMode}
        onSetVialRGBSpeed={vi.fn()}
        onSetVialRGBColor={vi.fn()}
        onSetVialRGBBrightness={vi.fn()}
      />,
    )

    fireEvent.change(screen.getByTestId('keychron-rgb-mode'), { target: { value: '48' } })
    expect(onSetMode).toHaveBeenCalledWith(48)
  })
})
