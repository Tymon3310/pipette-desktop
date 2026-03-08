import { emptyKeychronState } from '../types/keychron'
import { serializeKeychronState } from '../keychron-serialize'
import { describe, it, expect } from 'vitest'

describe('serializeKeychronState', () => {
  it('correctly serializes a full KeychronState object to vial-gui JSON format', () => {
    const state = emptyKeychronState()
    state.hasRgb = true
    state.rgb = {
      perKeyRGBType: 1,
      perKeyColors: [[0, 0, 0], [255, 0, 0], [0, 255, 0]],
      osIndicatorConfig: null as any,
      mixedRGBLayers: 1,
      mixedRGBRegions: [[[0,0], [0,1]]] as any,
      mixedRGBEffects: [[{ effect: 0, hue: 255, sat: 255, speed: 5, time: 0 }]] as any,
      ledMatrix: null as any
    } as any
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
      profiles: [{
        name: 'FPS',
        keyConfigs: new Map([
          ['0,0', { mode: 1, actuationPoint: 10, sensitivity: 5, releaseSensitivity: 5 }]
        ]),
        socdPairs: [{ type: 1, key1Row: 0, key1Col: 0, key2Row: 0, key2Col: 1 }],
        okmcConfigs: [{
          shallowAct: 5, shallowDeact: 4, deepAct: 20, deepDeact: 19,
          keycodes: [1, 0, 2, 0],
          events: [1, 2, 3, 4]
        }]
      }]
    }
    
    const result = serializeKeychronState(state)
    expect(result).toBeDefined()
    expect(result?.rgb).toBeDefined()
    expect((result?.rgb as any).mixed_rgb_effects).toEqual([[[0, 255, 255, 5, 0]]])
    expect(result?.analog).toBeDefined()
    expect((result?.analog as any).profiles[0].name).toEqual('FPS')
    expect((result?.analog as any).profiles[0].key_configs['0,0']).toBeDefined()
  })
})
