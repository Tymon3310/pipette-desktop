import React, { useState, useEffect, useRef, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { ModalCloseButton } from './ModalCloseButton'

import { useUnlockGate } from '../../hooks/useUnlockGate'
import type { DeviceInfo } from '../../../shared/types/protocol'

/** How often to poll for the device to re-appear after DFU flashing (ms) */
const RECONNECT_POLL_MS = 2000
/** Maximum time to wait for the device to re-appear after DFU flashing (ms) */
const RECONNECT_TIMEOUT_MS = 60_000

interface KeychronDfuFlasherProps {
  isOpen: boolean
  onClose: () => void
  onSaveBackup?: () => Promise<boolean>
  unlocked?: boolean
  onUnlock?: () => void
  /** Suppress disconnect detection while flashing */
  setSuppressDisconnect?: (suppress: boolean) => void
  /** Original device info for auto-reconnect matching */
  originalDevice?: DeviceInfo | null
  /** Connect to a specific device */
  connectDevice?: (device: DeviceInfo) => Promise<boolean>
}

export const KeychronDfuFlasher = ({
  onClose,
  onSaveBackup,
  unlocked,
  onUnlock,
  setSuppressDisconnect,
  originalDevice,
  connectDevice,
}: KeychronDfuFlasherProps) => {
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [isFlashing, setIsFlashing] = useState(false)
  const [progress, setProgress] = useState(0)
  const [logs, setLogs] = useState<string[]>([])
  const [backupLayout, setBackupLayout] = useState(true)
  const [flashSuccess, setFlashSuccess] = useState<boolean | null>(null)
  const [reconnecting, setReconnecting] = useState(false)
  const logEndRef = useRef<HTMLDivElement>(null)
  const { t } = useTranslation()

  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [logs])

  // Clean up suppress on unmount
  useEffect(() => {
    return () => {
      setSuppressDisconnect?.(false)
    }
  }, [setSuppressDisconnect])

  const { guardAll } = useUnlockGate({ unlocked, onUnlock })

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setSelectedFile(e.target.files[0])
      setFlashSuccess(null)
      setProgress(0)
      setLogs([])
    }
  }

  /**
   * After flashing, poll for the original device to re-appear and reconnect.
   */
  const waitForReconnect = useCallback(async (): Promise<boolean> => {
    if (!originalDevice || !connectDevice) return false

    setReconnecting(true)
    setLogs((prev) => [...prev, 'Waiting for keyboard to reconnect...'])

    const deadline = Date.now() + RECONNECT_TIMEOUT_MS
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, RECONNECT_POLL_MS))
      try {
        const devices = await window.vialAPI.listDevices()
        const match = devices.find(
          (d) =>
            d.vendorId === originalDevice.vendorId &&
            d.productId === originalDevice.productId,
        )
        if (match) {
          setLogs((prev) => [...prev, `Device found: ${match.productName}. Reconnecting...`])
          // Release the suppress so the normal poller takes over after connect
          setSuppressDisconnect?.(false)
          const ok = await connectDevice(match)
          if (ok) {
            setLogs((prev) => [...prev, 'Reconnected successfully! Layout + settings will be restored.'])
            setReconnecting(false)
            return true
          }
        }
      } catch {
        // polling error, try again
      }
    }

    setLogs((prev) => [...prev, 'Timed out waiting for keyboard. Please reconnect manually.'])
    setSuppressDisconnect?.(false)
    setReconnecting(false)
    return false
  }, [originalDevice, connectDevice, setSuppressDisconnect])

  const handleFlash = async () => {
    if (!selectedFile) return

    setIsFlashing(true)
    setFlashSuccess(null)
    setProgress(0)
    setLogs(['Starting Keychron DFU Flashing sequence...'])

    // Save layout silently
    if (backupLayout && onSaveBackup) {
      setLogs((prev) => [...prev, 'Backing up current layout and keychron settings...'])
      try {
        const success = await onSaveBackup()
        if (success) {
          setLogs((prev) => [...prev, 'Layout saved successfully to background.'])
        } else {
          setLogs((prev) => [...prev, 'Warning: Failed to save layout.'])
        }
      } catch (e: unknown) {
        setLogs((prev) => [...prev, `Warning: Failed to save layout: ${e instanceof Error ? e.message : String(e)}`])
      }
    }

    // Parse the file explicitly as an ArrayBuffer since Electron's isolated context removes native .path
    let firmwareData: ArrayBuffer
    try {
      firmwareData = await selectedFile.arrayBuffer()
    } catch (e: unknown) {
      setLogs((prev) => [...prev, `Error: Failed to read file data: ${e instanceof Error ? e.message : String(e)}`])
      setIsFlashing(false)
      setFlashSuccess(false)
      return
    }

    // Gate the actual jump + flash behind unlock
    // Note: backup is done BEFORE unlock gate, just like vial-gui does
    guardAll(async () => {
      // Suppress disconnect detection BEFORE jumping to bootloader
      setSuppressDisconnect?.(true)

      setLogs((prev) => [...prev, 'Rebooting keyboard to DFU bootloader...'])
      try {
        await window.vialAPI.jumpToBootloader()
        setLogs((prev) => [...prev, 'Jump command sent. Waiting for DFU device...'])
      } catch (e: unknown) {
        setLogs((prev) => [...prev, `Warning: Jump command failed (if already in DFU mode, this is fine). Error: ${e instanceof Error ? e.message : String(e)}`])
      }

      // Subscribe to progress
      const unsubscribe = window.vialAPI.keychronDfuOnOutput((data) => {
        if (data.log) {
          setLogs((prev) => [...prev, data.log!])
        }
        if (data.progress !== undefined) {
          setProgress(Math.round(data.progress * 100))
        }
      })

      try {
        const result = await window.vialAPI.keychronDfuFlash(firmwareData)
        if (result.success) {
          setFlashSuccess(true)
          setLogs((prev) => [...prev, 'Firmware flashed successfully!'])
          // Auto-reconnect after successful flash
          await waitForReconnect()
        } else {
          setFlashSuccess(false)
          setLogs((prev) => [...prev, `Flash failed: ${result.error}`])
          setSuppressDisconnect?.(false)
        }
      } catch (err: unknown) {
        setFlashSuccess(false)
        setLogs((prev) => [...prev, `IPC Error: ${err instanceof Error ? err.message : String(err)}`])
        setSuppressDisconnect?.(false)
      } finally {
        setIsFlashing(false)
        unsubscribe()
      }
    })
  }

  const handleClose = () => {
    setSuppressDisconnect?.(false)
    onClose()
  }

  const isBusy = isFlashing || reconnecting

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={isBusy ? undefined : handleClose}
    >
      <div 
        className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded bg-gray-800 shadow-lg text-white"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-gray-700 px-4 py-3 shrink-0">
          <h2 className="text-lg font-semibold">{t('keychron.flasher.title', 'Keychron Firmware Flasher')}</h2>
          {!isBusy && <ModalCloseButton testid="keychron-dfu-flasher-close" onClick={handleClose} />}
        </div>
        
        <div className="flex-1 overflow-y-auto px-6 py-4 min-h-0 flex flex-col gap-6">
          <p className="text-sm">
            Select a <b>.bin</b> firmware file to flash your Keychron keyboard. This process will reboot your keyboard into DFU mode and use <code>dfu-util</code> to deploy the firmware.
          </p>

          <div className="p-4 border border-white/30 rounded-md bg-gray-900">
            <div className="flex items-center justify-between gap-4">
              <span className="font-medium text-sm truncate flex-1">
                {selectedFile ? selectedFile.name : 'No file selected'}
              </span>
              <input
                type="file"
                accept=".bin"
                ref={fileInputRef}
                style={{ display: 'none' }}
                onChange={handleFileChange}
              />
              <button
                type="button"
                className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium hover:bg-blue-700 transition-colors disabled:opacity-50"
                onClick={() => fileInputRef.current?.click()}
                disabled={isBusy}
              >
                Browse...
              </button>
            </div>
          </div>

          <label className="flex items-center gap-2 cursor-pointer text-sm font-medium">
            <input 
              type="checkbox"
              checked={backupLayout}
              onChange={(e) => setBackupLayout(e.target.checked)}
              disabled={isBusy}
              className="rounded text-blue-600"
            />
            {t('keychron.flasher.backup', 'Restore current layout after flashing')}
          </label>

          {(isBusy || logs.length > 0) && (
            <div>
              <div className="mb-2 font-bold text-sm">
                {reconnecting ? 'Reconnecting...' : 'Flash Progress'}
              </div>
              <div className="w-full h-2 bg-gray-700 rounded-full overflow-hidden mb-2">
                <div 
                  className={`h-full transition-all duration-300 ${
                    flashSuccess === false ? 'bg-red-500' : 
                    reconnecting ? 'bg-yellow-500 animate-pulse' : 
                    'bg-blue-500'
                  }`}
                  style={{ width: reconnecting ? '100%' : `${progress}%` }} 
                />
              </div>
                
              <div className="bg-black p-3 rounded-md font-mono text-sm h-48 overflow-y-auto border border-white/20">
                {logs.map((log, i) => (
                  <div key={i} className={log.toLowerCase().includes('error') || log.toLowerCase().includes('failed') ? 'text-red-300' : 'text-gray-300'}>
                    {log}
                  </div>
                ))}
                <div ref={logEndRef} />
              </div>
            </div>
          )}

          {flashSuccess === true && !reconnecting && (
            <div className="flex gap-2 p-2 bg-green-900 text-green-300 rounded-md items-center">
              <span>✓</span>
              <span>Flash completed successfully. The keyboard should reconnect shortly.</span>
            </div>
          )}

          {flashSuccess === false && (
            <div className="flex gap-2 p-2 bg-red-900 text-red-300 rounded-md items-center">
              <span>⚠</span>
              <span>Flashing failed. Check the logs above for details.</span>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-gray-700 px-6 py-4 shrink-0">
          <button
            type="button"
            className="rounded px-4 py-2 text-sm font-medium hover:bg-gray-700 transition-colors disabled:opacity-50"
            onClick={handleClose}
            disabled={isBusy}
          >
            {flashSuccess ? 'Close' : 'Cancel'}
          </button>
          <button
            type="button"
            className="rounded bg-red-600 px-4 py-2 text-sm font-medium hover:bg-red-700 transition-colors disabled:opacity-50"
            onClick={handleFlash}
            disabled={!selectedFile || isBusy}
          >
            {isFlashing ? 'Flashing...' : reconnecting ? 'Reconnecting...' : 'Flash Firmware'}
          </button>
        </div>
      </div>
    </div>
  )
}
