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
  /** Called after a successful flash and reconnect to refresh the UI */
  onReload?: () => void
}

export const KeychronDfuFlasher = ({
  onClose,
  onSaveBackup,
  unlocked,
  onUnlock,
  setSuppressDisconnect,
  originalDevice,
  connectDevice,
  onReload,
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
      handleFileSelection(e.target.files[0])
    }
  }

  const handleFileSelection = (file: File) => {
    // Basic validation
    if (!file.name.toLowerCase().endsWith('.bin')) {
      setLogs(['Error: Please select a valid .bin firmware file.'])
      setFlashSuccess(false)
      return
    }
    
    setSelectedFile(file)
    setFlashSuccess(null)
    setProgress(0)
    setLogs([])
  }

  const [isDragging, setIsDragging] = useState(false)

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    if (!isBusy) setIsDragging(true)
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    if (isBusy) return

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFileSelection(e.dataTransfer.files[0])
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
          (d) => d.vendorId === originalDevice.vendorId && d.productId === originalDevice.productId,
        )
        if (match) {
          setLogs((prev) => [...prev, `Device found: ${match.productName}. Reconnecting...`])
          // Release the suppress so the normal poller takes over after connect
          setSuppressDisconnect?.(false)
          const ok = await connectDevice(match)
          if (ok) {
            setLogs((prev) => [
              ...prev,
              'Reconnected successfully! Layout + settings will be restored.',
            ])
            setReconnecting(false)
            onReload?.()
            
            // Wait 3 seconds so the user can read the success message before closing
            setTimeout(() => {
              onClose()
            }, 3000)
            
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
        setLogs((prev) => [
          ...prev,
          `Warning: Failed to save layout: ${e instanceof Error ? e.message : String(e)}`,
        ])
      }
    }

    // Parse the file explicitly as an ArrayBuffer since Electron's isolated context removes native .path
    let firmwareData: ArrayBuffer
    try {
      firmwareData = await selectedFile.arrayBuffer()
    } catch (e: unknown) {
      setLogs((prev) => [
        ...prev,
        `Error: Failed to read file data: ${e instanceof Error ? e.message : String(e)}`,
      ])
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
        setLogs((prev) => [
          ...prev,
          `Warning: Jump command failed (if already in DFU mode, this is fine). Error: ${e instanceof Error ? e.message : String(e)}`,
        ])
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
        setLogs((prev) => [
          ...prev,
          `IPC Error: ${err instanceof Error ? err.message : String(err)}`,
        ])
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
        className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg bg-surface-alt shadow-xl text-content"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-edge px-6 py-4 shrink-0 bg-surface">
          <h2 className="text-lg font-semibold">
            {t('keychron.flasher.title', 'Keychron Firmware Flasher')}
          </h2>
          {!isBusy && (
            <ModalCloseButton testid="keychron-dfu-flasher-close" onClick={handleClose} />
          )}
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 min-h-0 flex flex-col gap-6">
          <p className="text-sm text-content-secondary">
            Select a <b>.bin</b> firmware file to flash your Keychron keyboard. This process will
            reboot your keyboard into DFU mode and use <code className="rounded bg-surface px-1 py-0.5 text-content">dfu-util</code> to deploy the firmware.
          </p>

          <div
            className={`p-6 border-2 border-dashed rounded-lg transition-colors flex flex-col items-center justify-center gap-3 cursor-pointer
              ${
                isBusy
                  ? 'border-edge bg-surface-dim opacity-50 cursor-not-allowed'
                  : isDragging
                    ? 'border-accent bg-accent/10'
                    : 'border-edge bg-surface hover:border-accent/50'
              }
            `}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => !isBusy && fileInputRef.current?.click()}
          >
            <div className="flex flex-col items-center justify-center text-center gap-1">
              <span className="font-medium text-sm text-content">
                {selectedFile ? selectedFile.name : 'Drag and drop your .bin file here'}
              </span>
              {!selectedFile && (
                <span className="text-xs text-content-secondary">
                  or click to browse from your computer
                </span>
              )}
            </div>
            
            <input
              type="file"
              accept=".bin"
              ref={fileInputRef}
              style={{ display: 'none' }}
              onChange={handleFileChange}
              disabled={isBusy}
            />
            
            {selectedFile && (
              <button
                type="button"
                className="mt-2 rounded bg-surface-dim px-3 py-1.5 text-xs font-medium text-content hover:bg-edge transition-colors disabled:opacity-50"
                onClick={(e) => {
                  e.stopPropagation()
                  fileInputRef.current?.click()
                }}
                disabled={isBusy}
              >
                Choose different file
              </button>
            )}
          </div>

          <label className="flex items-center gap-2 cursor-pointer text-sm font-medium text-content">
            <input
              type="checkbox"
              checked={backupLayout}
              onChange={(e) => setBackupLayout(e.target.checked)}
              disabled={isBusy}
              className="rounded accent-accent"
            />
            {t('keychron.flasher.backup', 'Restore current layout after flashing')}
          </label>

          {(isBusy || logs.length > 0) && (
            <div>
              <div className="mb-2 font-bold text-sm text-content">
                {reconnecting ? 'Reconnecting...' : 'Flash Progress'}
              </div>
              <div className="w-full h-2 bg-surface-dim rounded-full overflow-hidden mb-2">
                <div
                  className={`h-full transition-all duration-300 ${
                    flashSuccess === false
                      ? 'bg-danger'
                      : reconnecting
                        ? 'bg-warning animate-pulse'
                        : 'bg-accent'
                  }`}
                  style={{ width: reconnecting ? '100%' : `${progress}%` }}
                />
              </div>

              <div className="bg-surface-dim p-3 rounded-lg font-mono text-sm h-48 overflow-y-auto border border-edge">
                {logs.map((log, i) => (
                  <div
                    key={i}
                    className={
                      log.toLowerCase().includes('error') || log.toLowerCase().includes('failed')
                        ? 'text-danger'
                        : 'text-content-secondary'
                    }
                  >
                    {log}
                  </div>
                ))}
                <div ref={logEndRef} />
              </div>
            </div>
          )}

          {flashSuccess === true && !reconnecting && (
            <div className="flex gap-2 p-3 bg-success/10 text-success border border-success/20 rounded-lg items-center text-sm font-medium">
              <span>✓</span>
              <span>Flash completed successfully. The keyboard should reconnect shortly.</span>
            </div>
          )}

          {flashSuccess === false && (
            <div className="flex gap-2 p-3 bg-danger/10 text-danger border border-danger/20 rounded-lg items-center text-sm font-medium">
              <span>⚠</span>
              <span>Flashing failed. Check the logs above for details.</span>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-edge px-6 py-4 shrink-0 bg-surface">
          <button
            type="button"
            className="rounded px-4 py-2 text-sm font-medium text-content hover:bg-surface-dim border border-edge transition-colors disabled:opacity-50"
            onClick={handleClose}
            disabled={isBusy}
          >
            {flashSuccess ? 'Close' : 'Cancel'}
          </button>
          <button
            type="button"
            className="rounded bg-danger px-4 py-2 text-sm font-medium text-white hover:bg-danger/90 transition-colors disabled:opacity-50"
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
