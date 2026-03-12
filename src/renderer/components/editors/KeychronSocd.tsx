// SPDX-License-Identifier: GPL-3.0-or-later

import { useState, useCallback, useRef, useLayoutEffect, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import type { KeychronState, SnapClickEntry } from '../../../shared/types/keychron'
import { KeyboardWidget } from '../keyboard/KeyboardWidget'
import { KEY_UNIT, KEYBOARD_PADDING } from '../keyboard/constants'
import type { KleKey } from '../../../shared/kle/types'
import {
  SNAP_CLICK_TYPE_NAMES,
  SNAP_CLICK_TYPE_TOOLTIPS,
} from '../../../shared/constants/keychron'
import { ModalCloseButton } from './ModalCloseButton'
import { codeToLabel } from '../../../shared/keycodes/keycodes'

interface Props {
  keychron: KeychronState
  keys: KleKey[]
  keymap: Map<string, number>
  onSettingChanged?: () => void
  onClose: () => void
}

export function KeychronSocd({ keychron, keys, keymap, onSettingChanged, onClose }: Props) {
  const { t } = useTranslation()
  const api = window.vialAPI

  const [snapEntries, setSnapEntries] = useState<SnapClickEntry[]>(keychron.snapClickEntries)
  const [socdPickMode, setSocdPickMode] = useState<{ pairIdx: number; whichKey: 1 | 2 } | null>(
    null,
  )

  useEffect(() => {
    setSnapEntries(keychron.snapClickEntries)
  }, [keychron.snapClickEntries])

  const kbContainerRef = useRef<HTMLDivElement>(null)
  const [kbScale, setKbScale] = useState(1)

  // Measure keyboard widget container and compute scale
  useLayoutEffect(() => {
    const container = kbContainerRef.current
    if (!container) return
    const observer = new ResizeObserver(() => {
      const containerWidth = container.clientWidth - 32 // subtract padding
      let maxX = 0
      for (const k of keys) {
        if (k.x + k.width > maxX) maxX = k.x + k.width
      }
      const naturalWidth = maxX * KEY_UNIT + KEYBOARD_PADDING * 2
      if (naturalWidth > containerWidth && naturalWidth > 0) {
        setKbScale(containerWidth / naturalWidth)
      } else {
        setKbScale(1)
      }
    })
    observer.observe(container)
    return () => observer.disconnect()
  }, [keys, socdPickMode])

  const handleSnapType = useCallback(
    async (index: number, type: number) => {
      const entry = snapEntries[index]
      const newEntries = [...snapEntries]
      newEntries[index] = { ...entry, type }
      setSnapEntries(newEntries)
      await api.keychronSetSnapClick(index, type, entry.key1, entry.key2)
      await api.keychronSaveSnapClick()
      onSettingChanged?.()
    },
    [api, snapEntries, onSettingChanged],
  )

  const handleKeyPick = useCallback(
    async (key: KleKey) => {
      if (!socdPickMode) return
      // Use layer 0 to find basic keycode
      const posKey = `0,${key.row},${key.col}`
      const fullKeycode = keymap.get(posKey) ?? 0
      const basicKc = fullKeycode & 0xff

      const { pairIdx, whichKey } = socdPickMode
      const entry = snapEntries[pairIdx]
      const newEntry = { ...entry }
      if (whichKey === 1) newEntry.key1 = basicKc
      else newEntry.key2 = basicKc

      const newEntries = [...snapEntries]
      newEntries[pairIdx] = newEntry
      setSnapEntries(newEntries)
      setSocdPickMode(null)

      await api.keychronSetSnapClick(pairIdx, newEntry.type, newEntry.key1, newEntry.key2)
      await api.keychronSaveSnapClick()
      onSettingChanged?.()
    },
    [api, socdPickMode, snapEntries, keymap, onSettingChanged],
  )

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        className="flex max-h-[90vh] w-[900px] max-w-[95vw] flex-col rounded-lg bg-surface-alt p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold">{t('keychron.socd.title', 'Keychron SOCD')}</h3>
          <ModalCloseButton testid="keychron-socd-close" onClick={onClose} />
        </div>
        <div className="flex-1 overflow-y-auto">
          {keychron.isDebug && (
            <div className="mb-4 rounded border border-warning/50 bg-warning/10 p-3 text-sm text-warning-content">
              <strong>Debug Mode Active:</strong> Simulating Keychron SOCD. Settings saved will not be written to physical EEPROM.
            </div>
          )}

          <p className="text-sm text-content-secondary mb-4">
            {t(
              'keychron.socdDesc',
              'Configure Simultaneous Opposite Cardinal Direction (SOCD) key pairs. When both keys in a pair are pressed, the selected resolution mode determines which key takes priority.',
            )}
          </p>

      {/* Show keyboard widget when in pick mode */}
      {socdPickMode && (
        <div ref={kbContainerRef} className="flex flex-col items-center overflow-x-hidden rounded-lg border-2 border-accent bg-surface-dim p-4">
          <p className="mb-2 self-start text-sm font-medium text-accent">
            Click a key on the keyboard to assign it as Key {socdPickMode.whichKey} for SOCD pair #
            {socdPickMode.pairIdx + 1}
          </p>
          <div data-kb-widget>
            <KeyboardWidget
              keys={keys}
              keycodes={new Map()}
              multiSelectedKeys={new Set()}
              onKeyClick={handleKeyPick}
              scale={kbScale}
              customLabels={(() => {
                const labels = new Map<string, string>()
                keys.forEach((k) => {
                  if (k.row !== undefined && k.col !== undefined) {
                    const posKey = `0,${k.row},${k.col}`
                    const code = keymap.get(posKey) ?? 0
                    // Find if it's currently assigned to Key 1 or Key 2 of the picked pair
                    if (code) {
                       labels.set(`${k.row},${k.col}`, codeToLabel(code))
                    }
                  }
                })
                return labels
              })()}
            />
          </div>
          <button
            className="mt-2 rounded border border-edge px-3 py-1 text-xs text-content-secondary hover:text-content"
            onClick={() => setSocdPickMode(null)}
          >
            Cancel
          </button>
        </div>
      )}

      {snapEntries.length === 0 ? (
        <p className="text-sm italic text-content-secondary">
          {t('keychron.noSocd', 'No SOCD slots available for this keyboard.')}
        </p>
      ) : (
        <div className="space-y-2">
          {snapEntries.map((pair, i) => (
            <div key={i} className="flex items-center gap-3">
              <span className="w-16 text-xs text-content-muted">
                {t('keychron.snapPair', 'Pair {{n}}', { n: i + 1 })}
              </span>
              <select
                value={pair.type}
                onChange={(e) => handleSnapType(i, parseInt(e.target.value, 10))}
                className="flex-1 rounded border border-edge bg-surface px-2 py-1 text-sm"
                title={SNAP_CLICK_TYPE_TOOLTIPS[pair.type] ?? ''}
              >
                {Object.entries(SNAP_CLICK_TYPE_NAMES).map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </select>

              <button
                className={`flex w-24 flex-col items-center justify-center rounded border px-2 py-1 text-xs transition-colors ${
                  socdPickMode?.pairIdx === i && socdPickMode?.whichKey === 1
                    ? 'border-accent bg-accent/10 text-accent'
                    : 'border-edge bg-surface text-content-secondary hover:text-content'
                }`}
                onClick={() => setSocdPickMode({ pairIdx: i, whichKey: 1 })}
              >
                <span className="font-medium">
                  Key 1 {pair.key1 ? <span className="opacity-70">({codeToLabel(pair.key1)})</span> : ''}
                </span>
                <span className="font-mono text-content-muted">
                  0x{pair.key1.toString(16).padStart(2, '0')}
                </span>
              </button>

              <span className="text-content-muted">+</span>

              <button
                className={`flex w-24 flex-col items-center justify-center rounded border px-2 py-1 text-xs transition-colors ${
                  socdPickMode?.pairIdx === i && socdPickMode?.whichKey === 2
                    ? 'border-accent bg-accent/10 text-accent'
                    : 'border-edge bg-surface text-content-secondary hover:text-content'
                }`}
                onClick={() => setSocdPickMode({ pairIdx: i, whichKey: 2 })}
              >
                <span className="font-medium">
                  Key 2 {pair.key2 ? <span className="opacity-70">({codeToLabel(pair.key2)})</span> : ''}
                </span>
                <span className="font-mono text-content-muted">
                  0x{pair.key2.toString(16).padStart(2, '0')}
                </span>
              </button>
            </div>
          ))}
        </div>
      )}
        </div>
      </div>
    </div>
  )
}
