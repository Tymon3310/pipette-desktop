// SPDX-License-Identifier: GPL-3.0-or-later

import { useState, useEffect, useRef, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { ModalCloseButton } from './ModalCloseButton'
import { useEscapeClose } from '../../hooks/useEscapeClose'
import { BTN_PRIMARY, BTN_SECONDARY } from '../../constants/ui-tokens'

interface Props {
  onClose: () => void
}

/** Total hold duration required in milliseconds (5 seconds) */
const HOLD_DURATION_MS = 5000

/** Progress update interval in milliseconds */
const TICK_MS = 50

export function FactoryResetDialog({ onClose }: Props) {
  const { t } = useTranslation()
  const [started, setStarted] = useState(false)
  const [progress, setProgress] = useState(0)
  const [done, setDone] = useState(false)
  const timerRef = useRef<number | null>(null)
  const startTimeRef = useRef<number>(0)

  const stop = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current)
      timerRef.current = null
    }
    setStarted(false)
    setProgress(0)
  }, [])

  const start = useCallback(() => {
    stop()
    setStarted(true)
    setDone(false)
    setProgress(0)
    startTimeRef.current = Date.now()

    timerRef.current = window.setInterval(() => {
      const elapsed = Date.now() - startTimeRef.current
      const pct = Math.min(100, Math.round((elapsed / HOLD_DURATION_MS) * 100))
      setProgress(pct)
      if (pct >= 100) {
        if (timerRef.current !== null) {
          window.clearInterval(timerRef.current)
          timerRef.current = null
        }
        setDone(true)
      }
    }, TICK_MS)
  }, [stop])

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        window.clearInterval(timerRef.current)
      }
    }
  }, [])

  const handleClose = useCallback(() => {
    stop()
    onClose()
  }, [stop, onClose])

  useEscapeClose(handleClose, !started || done)

  const isMac = typeof navigator !== 'undefined' && /mac/i.test(navigator.userAgent)
  const keyCombo = isMac ? ['Fn', 'Z', 'J'] : ['Fn', 'J', 'Z']

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      data-testid="factory-reset-backdrop"
      onClick={handleClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="factory-reset-title"
        className="flex max-h-modal-90vh w-modal-md max-w-modal-vw flex-col overflow-hidden rounded-lg bg-surface-alt p-6 shadow-xl"
        data-testid="factory-reset-dialog"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex shrink-0 items-center justify-between">
          <h3 id="factory-reset-title" className="text-lg font-semibold text-content">
            {t('keychron.factoryReset', 'Factory Reset')}
          </h3>
          <ModalCloseButton testid="factory-reset-close" onClick={handleClose} />
        </div>

        <div className="flex-1 overflow-y-auto flex flex-col gap-4 text-sm text-content">
          <p className="text-content-secondary">
            {t(
              'keychron.factoryResetIntro',
              'This will restore all keyboard settings to factory defaults. The reset is performed entirely on the keyboard — no USB command is sent.',
            )}
          </p>

          <div className="rounded-lg border border-edge bg-surface p-4 text-sm text-content-secondary">
            <p className="font-semibold text-content mb-2">
              {t('keychron.whatResets', 'The following will be reset:')}
            </p>
            <ul className="ml-4 list-disc space-y-1">
              <li>
                {t('keychron.resetKeymap', 'Keymap (all layers restored to firmware defaults)')}
              </li>
              <li>
                {t('keychron.resetActuation', 'Key actuation profiles (Hall Effect keyboards)')}
              </li>
              <li>{t('keychron.resetRgb', 'RGB lighting settings')}</li>
              <li>{t('keychron.resetDebounce', 'Debounce, NKRO, and USB report rate settings')}</li>
              <li>{t('keychron.resetWireless', 'Wireless pairing information')}</li>
            </ul>
          </div>

          <p className="text-content-secondary">
            {t(
              'keychron.holdInstructions',
              'Press and hold the following key combination until the bar fills:',
            )}
          </p>

          {/* Key combo badge */}
          <div className="flex items-center justify-center gap-2 py-1">
            {keyCombo.map((key, i) => (
              <span key={key} className="flex items-center gap-2">
                <span className="inline-block rounded-lg border border-edge bg-surface px-4 py-2 text-sm font-bold text-content shadow-xs">
                  {key}
                </span>
                {i < keyCombo.length - 1 && (
                  <span className="text-content-muted font-medium">+</span>
                )}
              </span>
            ))}
          </div>

          {/* Progress bar */}
          <div className="h-2 overflow-hidden rounded-full bg-surface-dim">
            <div
              className={`h-full rounded-full transition-all duration-75 ${done ? 'bg-success' : 'bg-accent'}`}
              style={{ width: `${progress}%` }}
            />
          </div>

          {/* Status */}
          <p className="text-center text-xs text-content-muted whitespace-pre-line">
            {done
              ? t(
                  'keychron.resetComplete',
                  'Release the keys — the keyboard is resetting.\nIt will flash red three times to confirm.\n\nClose this dialog and re-open the application to reload settings.',
                )
              : started
                ? t('keychron.resetHolding', 'Hold the keys above until the bar is full...')
                : t('keychron.resetReady', 'Press Start, then hold the key combo on your keyboard.')}
          </p>
        </div>

        {/* Footer */}
        <div className="mt-4 flex shrink-0 items-center justify-end gap-2 border-t border-edge pt-4">
          {!done && (
            <button
              type="button"
              className={BTN_PRIMARY}
              onClick={start}
              disabled={started && !done}
            >
              {t('common.start', 'Start')}
            </button>
          )}
          <button
            type="button"
            className={BTN_SECONDARY}
            onClick={handleClose}
          >
            {done ? t('common.close', 'Close') : t('common.cancel', 'Cancel')}
          </button>
        </div>
      </div>
    </div>
  )
}
