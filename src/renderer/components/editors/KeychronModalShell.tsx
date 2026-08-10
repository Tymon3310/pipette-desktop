// SPDX-License-Identifier: GPL-2.0-or-later
// Shared modal shell for Keychron setting panels.
// Provides a consistent backdrop, scrollable body, and close button.

import type { ReactNode } from 'react'
import { ModalCloseButton } from './ModalCloseButton'

interface KeychronModalShellProps {
  title: string
  testId: string
  onClose: () => void
  /** Tailwind width class (e.g. "w-modal-lg") or raw class like "w-[1200px]" */
  width?: string
  /** Extra className on the scrollable content area (e.g. for custom padding) */
  contentClassName?: string
  children: ReactNode
}

export function KeychronModalShell({
  title,
  testId,
  onClose,
  width = 'w-modal-lg',
  contentClassName,
  children,
}: KeychronModalShellProps) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      data-testid={`${testId}-backdrop`}
      onClick={onClose}
    >
      <div
        className={`flex max-h-[90vh] ${width} max-w-modal-xl-vw flex-col overflow-hidden rounded-lg bg-surface-alt shadow-xl`}
        data-testid={testId}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between px-6 pt-6 pb-4">
          <h3 className="text-lg font-semibold">{title}</h3>
          <ModalCloseButton testid={`${testId}-close`} onClick={onClose} />
        </div>
        <div className={`flex min-h-0 flex-1 flex-col overflow-y-auto${contentClassName ? ` ${contentClassName}` : ' px-6 pb-6'}`}>
          {children}
        </div>
      </div>
    </div>
  )
}
