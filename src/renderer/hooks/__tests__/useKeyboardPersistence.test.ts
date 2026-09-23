// SPDX-License-Identifier: GPL-2.0-or-later
// @vitest-environment jsdom
//
// Covers two things `applyVilFile` does on every restore:
//  - the `keymapRestoreSeq` bump — the single signal App.tsx's
//    restore-cleanup effect watches for. Snapshot/layout-store restore and
//    `.vil` import both converge on this function, so proving the bump
//    fires here covers both call sites without needing App.tsx's own
//    harness.
//  - QMK settings restore only applying qsids the connected firmware
//    supports, and keeping local state in sync with what was actually
//    written to the device.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useState, useRef } from 'react'
import { useKeyboardPersistence } from '../useKeyboardPersistence'
import { emptyState, type KeyboardState, type SetState, type KeyboardRefs, type BootGuardRef } from '../keyboard-types'
import { emptyKeychronState } from '../../../shared/types/keychron'
import type { VilFile } from '../../../shared/types/protocol'
import * as keychronSerialize from '../../../shared/keychron-serialize'
import { VALID_VIL } from './fixtures/valid-vil'

function createState(overrides?: Partial<KeyboardState>): KeyboardState {
  return {
    ...emptyState(),
    uid: 'device-uid',
    rows: 2,
    cols: 2,
    layers: 2,
    vialProtocol: 9,
    viaProtocol: 9,
    supportedQsids: new Set([1, 2, 5]),
    keymap: new Map([
      ['0,0,0', 4],
      ['0,0,1', 5],
    ]),
    encoderLayout: new Map([
      ['0,0,0', 6],
    ]),
    macroBuffer: [1, 2, 3],
    macroCount: 1,
    tapDanceEntries: [{ onTap: 4, onHold: 5, onDoubleTap: 6, onTapHold: 7, tappingTerm: 200 }],
    comboEntries: [{ key1: 4, key2: 5, key3: 0, key4: 0, output: 6 }],
    keyOverrideEntries: [],
    altRepeatKeyEntries: [],
    qmkSettingsValues: { '1': [10, 11] },
    layerNames: ['Base', 'Fn'],
    unlockStatus: { unlocked: true, inProgress: false, keys: [] },
    ...overrides,
  }
}

function setupPersistence(initialState: KeyboardState) {
  const stateRef = { current: initialState }
  const qmkSettingsBaselineRef = { current: {} }
  const saveLayerNames = vi.fn()
  const saveLayerNamesRef = { current: saveLayerNames }
  const refs = {
    stateRef,
    qmkSettingsBaselineRef,
    saveLayerNamesRef,
  } as unknown as KeyboardRefs

  const setState: SetState = ((update: KeyboardState | ((prev: KeyboardState) => KeyboardState)) => {
    stateRef.current = typeof update === 'function'
      ? (update as (prev: KeyboardState) => KeyboardState)(stateRef.current)
      : update
  }) as SetState

  const waitForUnlock = vi.fn(async () => {})
  const bootGuardRef = { current: { onUnlock: null } }
  const bumpActivity = vi.fn()

  const hook = renderHook(() => useKeyboardPersistence(
    setState,
    refs,
    bumpActivity,
    bootGuardRef,
    waitForUnlock,
  ))

  return {
    ...hook,
    stateRef,
    qmkSettingsBaselineRef,
    saveLayerNames,
    waitForUnlock,
    bootGuardRef,
    bumpActivity,
  }
}

/** A `window.vialAPI` stub covering the 9 HID-write methods `applyVilFile`
 *  calls, each defaulting to a no-op success — the shape every test below
 *  needs regardless of which specific method it's exercising. Pass
 *  `overrides` for the methods a test needs to observe or fail. */
function stubVialAPI(overrides?: Partial<typeof window.vialAPI>): typeof window.vialAPI {
  return {
    setKeycode: vi.fn(async () => {}),
    setEncoder: vi.fn(async () => {}),
    setMacroBuffer: vi.fn(async () => {}),
    setLayoutOptions: vi.fn(async () => {}),
    setTapDance: vi.fn(async () => {}),
    setCombo: vi.fn(async () => {}),
    setKeyOverride: vi.fn(async () => {}),
    setAltRepeatKey: vi.fn(async () => {}),
    qmkSettingsSet: vi.fn(async () => {}),
    ...overrides,
  } as unknown as typeof window.vialAPI
}

function useHarness(initial?: Partial<KeyboardState>) {
  const [state, setState] = useState<KeyboardState>({ ...emptyState(), isDummy: true, ...initial })
  const stateRef = useRef(state)
  stateRef.current = state
  const qmkSettingsBaselineRef = useRef<Record<string, number[]>>({})
  const saveLayerNamesRef = useRef<((names: string[]) => void) | null>(null)
  const bootGuardRef = useRef<BootGuardRef>({ onUnlock: null })
  const waitForUnlock = vi.fn(async () => {})
  const bumpActivity = vi.fn()

  const persistence = useKeyboardPersistence(
    setState,
    { stateRef, qmkSettingsBaselineRef, saveLayerNamesRef },
    bumpActivity,
    bootGuardRef,
    waitForUnlock,
  )

  return { state, ...persistence }
}

beforeEach(() => {
  window.vialAPI = {
    ...(window.vialAPI ?? {}),
    setKeycode: vi.fn(async () => {}),
    setEncoder: vi.fn(async () => {}),
    setMacroBuffer: vi.fn(async () => {}),
    setLayoutOptions: vi.fn(async () => {}),
    setTapDance: vi.fn(async () => {}),
    setCombo: vi.fn(async () => {}),
    setKeyOverride: vi.fn(async () => {}),
    setAltRepeatKey: vi.fn(async () => {}),
    qmkSettingsSet: vi.fn(async () => {}),
    keychronReload: vi.fn(async () => ({ ...emptyKeychronState(), hasNkro: true })),
  } as unknown as typeof window.vialAPI
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('useKeyboardPersistence', () => {
  it('serializes the normal snapshot payload and preserves keychron data', () => {
    const keychron = {
      ...emptyKeychronState(),
      hasNkro: true,
      nkroEnabled: true,
      nkroSupported: true,
    }
    const state = createState({
      keychron,
      vialRGBSupported: [1],
      vialRGBMode: 7,
      vialRGBSpeed: 8,
      vialRGBHue: 9,
      vialRGBSat: 10,
      vialRGBVal: 11,
    })
    const serializeKeychronSpy = vi
      .spyOn(keychronSerialize, 'serializeKeychronState')
      .mockReturnValue({ nkro: { enabled: true } })

    const { result } = setupPersistence(state)

    const vil = result.current.serialize()

    expect(vil.uid).toBe('device-uid')
    expect(vil.keymap).toEqual({ '0,0,0': 4, '0,0,1': 5 })
    expect(vil.encoderLayout).toEqual({ '0,0,0': 6 })
    expect(vil.qmkSettings).toEqual({ '1': [10, 11] })
    expect(vil.layerNames).toEqual(['Base', 'Fn'])
    expect(vil.keychron).toEqual({ nkro: { enabled: true } })
    expect(serializeKeychronSpy).toHaveBeenCalledWith(
      keychron,
      { mode: 7, speed: 8, hue: 9, sat: 10, val: 11 },
    )
  })

  it('applies the normal restore flow and invokes keychron restore for keychron snapshots', async () => {
    const currentKeychron = {
      ...emptyKeychronState(),
      hasNkro: true,
      nkroSupported: true,
      nkroEnabled: false,
    }
    const state = createState({
      isDummy: false,
      keychron: currentKeychron,
    })
    const restoreKeychronSpy = vi
      .spyOn(keychronSerialize, 'restoreKeychronSettings')
      .mockResolvedValue(undefined)

    const { result, stateRef, saveLayerNames } = setupPersistence(state)

    const vil: VilFile = {
      version: 2,
      uid: 'saved-uid',
      keymap: { '0,0,0': 42 },
      encoderLayout: { '0,0,0': 43 },
      macros: [9, 8, 7],
      macroJson: [],
      layoutOptions: 3,
      tapDance: [],
      combo: [],
      keyOverride: [],
      altRepeatKey: [],
      qmkSettings: { '5': [1, 2] },
      layerNames: ['Saved Base', 'Saved Fn'],
      keychron: { nkro: { enabled: true } },
    }

    await act(async () => {
      await result.current.applyVilFile(vil)
    })

    expect(window.vialAPI.setKeycode).toHaveBeenCalledWith(0, 0, 0, 42)
    expect(window.vialAPI.setEncoder).toHaveBeenCalledWith(0, 0, 0, 43)
    expect(window.vialAPI.setMacroBuffer).toHaveBeenCalledWith([9, 8, 7])
    expect(window.vialAPI.setLayoutOptions).toHaveBeenCalledWith(3)
    expect(window.vialAPI.qmkSettingsSet).toHaveBeenCalledWith(5, [1, 2])
    expect(restoreKeychronSpy).toHaveBeenCalledWith(
      { nkro: { enabled: true } },
      currentKeychron,
      window.vialAPI,
      2,
      2,
    )
    expect(window.vialAPI.keychronReload).toHaveBeenCalled()
    expect(saveLayerNames).toHaveBeenCalledWith(['Saved Base', 'Saved Fn'])
    expect(stateRef.current.keymap.get('0,0,0')).toBe(42)
    expect(stateRef.current.encoderLayout.get('0,0,0')).toBe(43)
    expect(stateRef.current.qmkSettingsValues).toEqual({ '5': [1, 2] })
    expect(stateRef.current.layerNames).toEqual(['Saved Base', 'Saved Fn'])
  })

  it('waits for unlock before writing to a real device restore', async () => {
    const state = createState({
      isDummy: false,
      unlockStatus: { unlocked: false, inProgress: false, keys: [] },
    })
    const { result, waitForUnlock, bootGuardRef } = setupPersistence(state)

    const vil: VilFile = {
      version: 2,
      uid: 'saved-uid',
      keymap: { '0,0,0': 42 },
      encoderLayout: {},
      macros: [],
      macroJson: [],
      layoutOptions: 0,
      tapDance: [],
      combo: [],
      keyOverride: [],
      altRepeatKey: [],
      qmkSettings: {},
      layerNames: [],
    }

    await act(async () => {
      await result.current.applyVilFile(vil)
    })

    expect(waitForUnlock).toHaveBeenCalledOnce()
    expect(bootGuardRef.current.onUnlock).toBeNull()
    expect(window.vialAPI.setKeycode).toHaveBeenCalledWith(0, 0, 0, 42)
  })

  it('round-trips a normal save -> clean baseline -> restore flow', async () => {
    const originalState = createState({
      isDummy: false,
      keymap: new Map([
        ['0,0,0', 14],
        ['0,0,1', 15],
      ]),
      encoderLayout: new Map([
        ['0,0,0', 22],
      ]),
      macroBuffer: [7, 7, 7],
      tapDanceEntries: [{ onTap: 10, onHold: 11, onDoubleTap: 12, onTapHold: 13, tappingTerm: 180 }],
      comboEntries: [{ key1: 20, key2: 21, key3: 0, key4: 0, output: 22 }],
      qmkSettingsValues: { '2': [99] },
      layerNames: ['Main', 'Alt'],
      layoutOptions: 5,
    })

    const { result, stateRef } = setupPersistence(originalState)
    const saved = result.current.serialize()

    stateRef.current = createState({
      ...emptyState(),
      isDummy: false,
      rows: 2,
      cols: 2,
      layers: 2,
      uid: 'device-uid',
      viaProtocol: 9,
      vialProtocol: 9,
      unlockStatus: { unlocked: true, inProgress: false, keys: [] },
      supportedQsids: new Set([2]),
      keymap: new Map([
        ['0,0,0', 1],
      ]),
      encoderLayout: new Map(),
      macroBuffer: [],
      tapDanceEntries: [],
      comboEntries: [],
      qmkSettingsValues: {},
      layerNames: ['', ''],
      layoutOptions: 0,
    })

    await act(async () => {
      await result.current.applyVilFile(saved)
    })

    expect(stateRef.current.keymap.get('0,0,0')).toBe(14)
    expect(stateRef.current.keymap.get('0,0,1')).toBe(15)
    expect(stateRef.current.encoderLayout.get('0,0,0')).toBe(22)
    expect(stateRef.current.macroBuffer).toEqual([7, 7, 7])
    expect(stateRef.current.tapDanceEntries).toEqual(originalState.tapDanceEntries)
    expect(stateRef.current.comboEntries).toEqual(originalState.comboEntries)
    expect(stateRef.current.qmkSettingsValues).toEqual({ '2': [99] })
    expect(stateRef.current.layerNames).toEqual(['Main', 'Alt'])
    expect(stateRef.current.layoutOptions).toBe(5)
  })

  it('round-trips a keychron save -> clean baseline -> restore flow', async () => {
    const originalKeychron = {
      ...emptyKeychronState(),
      hasDebounce: true,
      debounceType: 1,
      debounceTime: 9,
      hasNkro: true,
      nkroSupported: true,
      nkroAdaptive: false,
      nkroEnabled: true,
      hasWireless: true,
      wirelessBacklitTime: 60,
      wirelessIdleTime: 600,
    }
    const restoreKeychronSpy = vi
      .spyOn(keychronSerialize, 'restoreKeychronSettings')
      .mockResolvedValue(undefined)

    const { result, stateRef } = setupPersistence(createState({
      isDummy: false,
      keychron: originalKeychron,
      vialRGBSupported: [1],
      vialRGBMode: 3,
      vialRGBSpeed: 4,
      vialRGBHue: 5,
      vialRGBSat: 6,
      vialRGBVal: 7,
    }))

    const saved = result.current.serialize()
    expect(saved.keychron).toBeDefined()

    const reloadedKeychron = {
      ...emptyKeychronState(),
      hasDebounce: true,
      hasNkro: true,
      nkroSupported: true,
      hasWireless: true,
    }
    vi.mocked(window.vialAPI.keychronReload).mockResolvedValue(reloadedKeychron)

    stateRef.current = createState({
      ...emptyState(),
      isDummy: false,
      rows: 2,
      cols: 2,
      layers: 2,
      uid: 'device-uid',
      viaProtocol: 9,
      vialProtocol: 9,
      unlockStatus: { unlocked: true, inProgress: false, keys: [] },
      keychron: reloadedKeychron,
      keymap: new Map(),
      encoderLayout: new Map(),
      macroBuffer: [],
      qmkSettingsValues: {},
      layerNames: ['', ''],
    })

    await act(async () => {
      await result.current.applyVilFile(saved)
    })

    expect(restoreKeychronSpy).toHaveBeenCalledWith(
      saved.keychron,
      reloadedKeychron,
      window.vialAPI,
      2,
      2,
    )
    expect(window.vialAPI.keychronReload).toHaveBeenCalled()
    expect(stateRef.current.keychron).toEqual(reloadedKeychron)
  })
})

describe('applyVilFile qmk settings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('skips qmk settings qsids the connected firmware does not report as supported (HID path), and only stores the applied qsid in local state', async () => {
    const originalVialAPI = window.vialAPI
    const qmkSettingsSet = vi.fn(async () => {})
    window.vialAPI = stubVialAPI({ qmkSettingsSet })

    try {
      // VALID_VIL carries qsids '1' and '2'; only qsid 1 is reported as
      // supported by the (mocked) connected keyboard.
      const { result } = renderHook(() =>
        useHarness({
          isDummy: false,
          supportedQsids: new Set([1]),
          unlockStatus: { unlocked: true, inProgress: false, keys: [] },
        }),
      )

      await act(async () => {
        await result.current.applyVilFile(VALID_VIL)
      })

      expect(qmkSettingsSet).toHaveBeenCalledTimes(1)
      expect(qmkSettingsSet).toHaveBeenCalledWith(1, [0])

      // qsid 2 was never written to the device, so it must not be claimed
      // by local state either — otherwise serialize()/resolveTappingTerm
      // would report a value the device never accepted.
      expect(result.current.state.qmkSettingsValues).toEqual({ '1': [0] })
      expect(result.current.state.qmkSettingsValues).not.toHaveProperty('2')
    } finally {
      window.vialAPI = originalVialAPI
    }
  })
})

// applyVilFile's backup-before-write / rollback-on-failure behavior for a
// real (non-dummy) device. Each test installs its own window.vialAPI mock
// since the write sequence itself — and where it's made to fail — is the
// point under test.
describe('applyVilFile HID backup and rollback', () => {
  const originalVialAPI = window.vialAPI

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    window.vialAPI = originalVialAPI
  })

  function baseHidState(overrides?: Partial<KeyboardState>): Partial<KeyboardState> {
    return {
      isDummy: false,
      unlockStatus: { unlocked: true, inProgress: false, keys: [] },
      supportedQsids: new Set([1, 2]),
      // parsedMacros: [] sidesteps splitMacroBuffer/deserializeMacro entirely
      // for serialize()'s macroJson field — irrelevant to these tests, which
      // only care about the raw macroBuffer array passed to setMacroBuffer.
      parsedMacros: [],
      ...overrides,
    }
  }

  it('B1: a fully successful apply returns { ok: true } and updates state', async () => {
    const setKeycode = vi.fn(async () => {})
    window.vialAPI = stubVialAPI({ setKeycode })

    const { result } = renderHook(() => useHarness(baseHidState()))

    let applyResult: Awaited<ReturnType<typeof result.current.applyVilFile>> | undefined
    await act(async () => {
      applyResult = await result.current.applyVilFile(VALID_VIL)
    })

    expect(applyResult).toEqual({ ok: true })
    expect(setKeycode).toHaveBeenCalledWith(0, 0, 0, 0x4f)
    expect(result.current.state.keymap.get('0,0,0')).toBe(0x4f)
    expect(result.current.state.keymapRestoreSeq).toBe(1)
  })

  it('B2: a mid-apply setKeycode failure rewrites the backup keymap and reports rolledBack: true, leaving state unchanged', async () => {
    const setKeycode = vi.fn(async (_layer: number, row: number, col: number) => {
      // Fails on the 5th distinct keymap entry (layer 0, row 1, col 5 —
      // VALID_VIL's keycode for '0,1,5') so the first four keys and the
      // rollback's own (single) backup key are all still observable.
      if (row === 1 && col === 5) throw new Error('device write failed')
    })
    window.vialAPI = stubVialAPI({ setKeycode })

    const { result } = renderHook(() =>
      useHarness(baseHidState({
        keymap: new Map([['0,0,0', 5]]),
        macroBufferSize: 0,
      })),
    )

    let applyResult: Awaited<ReturnType<typeof result.current.applyVilFile>> | undefined
    await act(async () => {
      applyResult = await result.current.applyVilFile(VALID_VIL)
    })

    expect(applyResult).toEqual({ ok: false, rolledBack: true })
    // The rollback writes the pre-apply backup value back — the last
    // setKeycode call must be the backup's own (0,0,0) -> 5, not anything
    // from VALID_VIL.
    const lastCall = setKeycode.mock.calls[setKeycode.mock.calls.length - 1]
    expect(lastCall).toEqual([0, 0, 0, 5])
    // Local state was never updated — the failed apply must not leave the
    // screen claiming a keymap the device doesn't actually hold.
    expect(result.current.state.keymap.get('0,0,0')).toBe(5)
    expect(result.current.state.keymapRestoreSeq).toBe(0)
  })

  it('B3: a failure during rollback itself reports rolledBack: false and still leaves state unchanged', async () => {
    const setKeycode = vi.fn(async () => { throw new Error('apply failed') })
    const setLayoutOptions = vi.fn(async () => { throw new Error('rollback failed') })
    window.vialAPI = stubVialAPI({ setKeycode, setLayoutOptions })

    const { result } = renderHook(() =>
      useHarness(baseHidState({ macroBufferSize: 0 })),
    )

    let applyResult: Awaited<ReturnType<typeof result.current.applyVilFile>> | undefined
    await act(async () => {
      applyResult = await result.current.applyVilFile(VALID_VIL)
    })

    expect(applyResult).toEqual({ ok: false, rolledBack: false })
    expect(result.current.state.keymapRestoreSeq).toBe(0)
  })

  it('B4: rollback pads a shorter backup macro buffer with zeros up to macroBufferSize', async () => {
    const setKeycode = vi.fn(async () => { throw new Error('apply failed') })
    const setMacroBuffer = vi.fn(async () => {})
    window.vialAPI = stubVialAPI({ setKeycode, setMacroBuffer })

    const { result } = renderHook(() =>
      useHarness(baseHidState({
        macroBuffer: [1, 2, 3],
        macroBufferSize: 6,
      })),
    )

    await act(async () => {
      await result.current.applyVilFile(VALID_VIL)
    })

    expect(setMacroBuffer).toHaveBeenCalledWith([1, 2, 3, 0, 0, 0])
  })

  it('F7: rollback still pads to the macroBufferSize captured before the first write, even if state changes mid-apply', async () => {
    let capturedStateRef: { current: KeyboardState } | undefined
    const setMacroBuffer = vi.fn(async () => {})
    // The apply's first write (setKeycode) reaches directly into the
    // harness's stateRef and shrinks macroBufferSize before it fails —
    // simulating a disconnect resetting state partway through, after the
    // backup should already have captured the pre-apply value. Mutating
    // the ref directly (rather than going through setState) sidesteps
    // React's update-flush timing, which otherwise makes this race hard
    // to reproduce deterministically in a test.
    const setKeycode = vi.fn(async () => {
      if (capturedStateRef) capturedStateRef.current = { ...capturedStateRef.current, macroBufferSize: 0 }
      throw new Error('device write failed')
    })
    window.vialAPI = stubVialAPI({ setKeycode, setMacroBuffer })

    function useHarnessWithRefAccess(initial?: Partial<KeyboardState>) {
      const [state, setState] = useState<KeyboardState>({ ...emptyState(), isDummy: true, ...initial })
      const stateRef = useRef(state)
      stateRef.current = state
      capturedStateRef = stateRef
      const qmkSettingsBaselineRef = useRef<Record<string, number[]>>({})
      const saveLayerNamesRef = useRef<((names: string[]) => void) | null>(null)
      const bootGuardRef = useRef<BootGuardRef>({ onUnlock: null })
      const waitForUnlock = vi.fn(async () => {})
      const bumpActivity = vi.fn()

      const persistence = useKeyboardPersistence(
        setState,
        { stateRef, qmkSettingsBaselineRef, saveLayerNamesRef },
        bumpActivity,
        bootGuardRef,
        waitForUnlock,
      )

      return { state, ...persistence }
    }

    const { result } = renderHook(() =>
      useHarnessWithRefAccess(baseHidState({
        macroBuffer: [1, 2, 3],
        macroBufferSize: 6,
      })),
    )

    await act(async () => {
      await result.current.applyVilFile(VALID_VIL)
    })

    // Even though macroBufferSize was reset to 0 by the time the catch
    // block would have read stateRef.current, the rollback must still pad
    // to 6 (the value captured alongside the backup, before any write).
    expect(setMacroBuffer).toHaveBeenCalledWith([1, 2, 3, 0, 0, 0])
  })

  it('B4b: rollback does not write macros at all when macroBufferSize is 0', async () => {
    const setKeycode = vi.fn(async () => { throw new Error('apply failed') })
    const setMacroBuffer = vi.fn(async () => {})
    window.vialAPI = stubVialAPI({ setKeycode, setMacroBuffer })

    const { result } = renderHook(() =>
      useHarness(baseHidState({
        macroBuffer: [],
        macroBufferSize: 0,
      })),
    )

    await act(async () => {
      await result.current.applyVilFile(VALID_VIL)
    })

    expect(setMacroBuffer).not.toHaveBeenCalled()
  })

  it('B5: a dummy/file-mode device never touches HID and still returns { ok: true }', async () => {
    const setKeycode = vi.fn(async () => {})
    window.vialAPI = stubVialAPI({ setKeycode })

    const { result } = renderHook(() => useHarness({ isDummy: true }))

    let applyResult: Awaited<ReturnType<typeof result.current.applyVilFile>> | undefined
    await act(async () => {
      applyResult = await result.current.applyVilFile(VALID_VIL)
    })

    expect(applyResult).toEqual({ ok: true })
    expect(setKeycode).not.toHaveBeenCalled()
    expect(result.current.state.keymap.get('0,0,0')).toBe(0x4f)
  })

  it('a restored file with an empty macro array skips the macro write and leaves state\'s macro fields untouched', async () => {
    const setKeycode = vi.fn(async () => {})
    const setMacroBuffer = vi.fn(async () => {})
    window.vialAPI = stubVialAPI({ setKeycode, setMacroBuffer })

    const previousMacros = [1, 2, 3]
    const previousParsedMacros = [[{ type: 'text', text: 'hi' }]] as unknown as KeyboardState['parsedMacros']
    const { result } = renderHook(() =>
      useHarness(baseHidState({
        macroBuffer: previousMacros,
        macroBufferSize: 3,
        parsedMacros: previousParsedMacros,
      })),
    )

    await act(async () => {
      await result.current.applyVilFile({ ...VALID_VIL, macros: [] })
    })

    expect(setMacroBuffer).not.toHaveBeenCalled()
    expect(result.current.state.macroBuffer).toBe(previousMacros)
    expect(result.current.state.parsedMacros).toBe(previousParsedMacros)
    // Everything else in the file is still applied as normal.
    expect(result.current.state.keymap.get('0,0,0')).toBe(0x4f)
  })

  it('a restored file with a non-empty macro array still writes and updates state (regression)', async () => {
    const setKeycode = vi.fn(async () => {})
    const setMacroBuffer = vi.fn(async () => {})
    window.vialAPI = stubVialAPI({ setKeycode, setMacroBuffer })

    const { result } = renderHook(() =>
      useHarness(baseHidState({
        macroBuffer: [9, 9],
        macroBufferSize: 2,
        parsedMacros: [],
      })),
    )

    await act(async () => {
      await result.current.applyVilFile(VALID_VIL)
    })

    expect(setMacroBuffer).toHaveBeenCalledWith(VALID_VIL.macros)
    expect(result.current.state.macroBuffer).toEqual(VALID_VIL.macros)
  })
})
