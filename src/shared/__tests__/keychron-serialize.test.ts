import { emptyKeychronState, type KeychronRGBState } from '../types/keychron'
import { restoreKeychronSettings, serializeKeychronState } from '../keychron-serialize'
import { describe, it, expect, vi } from 'vitest'

describe('serializeKeychronState', () => {
  it('correctly serializes a full KeychronState object to vial-gui JSON format', () => {
    const state = emptyKeychronState()
    state.hasRgb = true
    state.rgb = {
      perKeyRGBType: 1,
      perKeyColors: [
        [0, 0, 0],
        [255, 0, 0],
        [0, 255, 0],
      ],
      osIndicatorConfig: null as unknown as KeychronRGBState['osIndicatorConfig'],
      mixedRGBLayers: 1,
      mixedRGBRegions: [
        [
          [0, 0],
          [0, 1],
        ],
      ] as unknown as KeychronRGBState['mixedRGBRegions'],
      mixedRGBEffects: [
        [{ effect: 0, hue: 255, sat: 255, speed: 5, time: 0 }],
      ] as unknown as KeychronRGBState['mixedRGBEffects'],
      ledMatrix: null as unknown as KeychronRGBState['ledMatrix'],
    } as unknown as KeychronRGBState
    state.hasAnalog = true
    state.analog = {
      version: 1,
      currentProfile: 0,
      profileCount: 1,
      profileSize: 200,
      okmcCount: 1,
      socdCount: 1,
      curve: [0, 10, 20, 30],
      gameControllerMode: 1,
      profiles: [
        {
          name: 'FPS',
          keyConfigs: new Map([
            ['0,0', { mode: 1, actuationPoint: 10, sensitivity: 5, releaseSensitivity: 5, advMode: 0, advModeData: 0 }],
          ]),
          socdPairs: [{ type: 1, key1Row: 0, key1Col: 0, key2Row: 0, key2Col: 1 }],
          okmcConfigs: [
            {
              shallowAct: 5,
              shallowDeact: 4,
              deepAct: 20,
              deepDeact: 19,
              keycodes: [1, 0, 2, 0],
              events: [1, 2, 3, 4],
            },
          ],
        },
      ],
    }

    const result = serializeKeychronState(state)
    expect(result).toBeDefined()
    expect(result?.rgb).toBeDefined()
    expect((result?.rgb as Record<string, unknown>).mixed_rgb_effects).toEqual([
      [[0, 255, 255, 5, 0]],
    ])
    expect(result?.analog).toBeDefined()
    expect((result?.analog as { profiles: { name: string }[] }).profiles[0].name).toEqual('FPS')
    expect(
      (result?.analog as { profiles: { key_configs: Record<string, unknown> }[] }).profiles[0]
        .key_configs['0,0'],
    ).toBeDefined()
  })

  it('serializes non-adaptive NKRO and VialRGB global effect data', () => {
    const state = emptyKeychronState()
    state.hasNkro = true
    state.nkroAdaptive = false
    state.nkroEnabled = true
    state.hasRgb = true
    state.rgb = {
      perKeyRGBType: 0,
      perKeyColors: [],
      osIndicatorConfig: null as unknown as KeychronRGBState['osIndicatorConfig'],
      mixedRGBLayers: 0,
      mixedRGBRegions: [],
      mixedRGBEffects: [],
      ledMatrix: null as unknown as KeychronRGBState['ledMatrix'],
    } as unknown as KeychronRGBState

    const result = serializeKeychronState(state, {
      mode: 7,
      speed: 9,
      hue: 10,
      sat: 20,
      val: 30,
    })

    expect(result?.nkro).toEqual({ enabled: true })
    expect((result?.rgb as Record<string, unknown>).vialrgb_mode).toBe(7)
    expect((result?.rgb as Record<string, unknown>).vialrgb_speed).toBe(9)
    expect((result?.rgb as Record<string, unknown>).vialrgb_hsv).toEqual([10, 20, 30])
  })
})

describe('restoreKeychronSettings', () => {
  it('restores NKRO and VialRGB effect when supported', async () => {
    const state = emptyKeychronState()
    state.hasNkro = true
    state.nkroAdaptive = false
    state.hasRgb = true
    state.rgb = {
      ledCount: 0,
      perKeyRGBType: 0,
      perKeyColors: [],
      osIndicatorConfig: null as unknown as KeychronRGBState['osIndicatorConfig'],
      mixedRGBLayers: 0,
      mixedRGBRegions: [],
      mixedRGBEffects: [],
      ledMatrix: null as unknown as KeychronRGBState['ledMatrix'],
    } as unknown as KeychronRGBState

    const api = {
      keychronSetDebounce: vi.fn(async () => true),
      keychronSetNkro: vi.fn(async () => true),
      keychronSetReportRate: vi.fn(async () => true),
      keychronSetPollRateV2: vi.fn(async () => true),
      keychronSetWirelessLpm: vi.fn(async () => true),
      keychronSetSnapClick: vi.fn(async () => true),
      keychronSaveSnapClick: vi.fn(async () => true),
      keychronSetPerKeyRGBType: vi.fn(async () => {}),
      keychronSetPerKeyColor: vi.fn(async () => {}),
      keychronSetIndicators: vi.fn(async () => {}),
      keychronSetMixedRGBRegions: vi.fn(async () => {}),
      keychronSetMixedRGBEffects: vi.fn(async () => {}),
      keychronSaveRGB: vi.fn(async () => {}),
      setVialRGBMode: vi.fn(async () => {}),
      keychronAnalogSetProfileName: vi.fn(async () => true),
      keychronAnalogSetTravel: vi.fn(async () => true),
      keychronAnalogSetAdvanceModeToggle: vi.fn(async () => true),
      keychronAnalogSetAdvanceModeDks: vi.fn(async () => true),
      keychronAnalogSetSocd: vi.fn(async () => true),
      keychronAnalogSaveProfile: vi.fn(async () => true),
      keychronAnalogSetCurve: vi.fn(async () => true),
      keychronAnalogSetGameControllerMode: vi.fn(async () => true),
      keychronAnalogSetProfile: vi.fn(async () => true),
    }

    await restoreKeychronSettings(
      {
        nkro: { enabled: true },
        rgb: {
          vialrgb_mode: 4,
          vialrgb_speed: 5,
          vialrgb_hsv: [6, 7, 8],
        },
      },
      state,
      api,
      6,
      16,
    )

    expect(api.keychronSetNkro).toHaveBeenCalledWith(true)
    expect(api.keychronSaveRGB).toHaveBeenCalled()
    expect(api.setVialRGBMode).toHaveBeenCalledWith(4, 5, 6, 7, 8)
  })
})
