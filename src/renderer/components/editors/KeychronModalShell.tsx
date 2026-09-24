// SPDX-License-Identifier: GPL-2.0-or-later
// Shared modal shell for Keychron setting panels.
// Provides a consistent backdrop, accessible dialog semantics, escape handling, and header/footer styling matching upstream modals.

import type { ReactNode } from 'react'
import { ModalCloseButton } from './ModalCloseButton'
import { useEscapeClose } from '../../hooks/useEscapeClose'

interface KeychronModalShellProps {
  title: string
  testId: string
  onClose: () => void
  /** Tailwind width class (e.g. "w-modal-md", "w-modal-lg", "w-modal-wide", "w-modal-xl", "w-modal-2xl") */
  width?: string
  /** Whether the modal is busy (disables escape, backdrop click, and hides close button) */
  isBusy?: boolean
  /** Optional sticky footer bar */
  footer?: ReactNode
  /** Extra className on the scrollable content area */
  contentClassName?: string
  children: ReactNode
}

export function KeychronModalShell({
  title,
  testId,
  onClose,
  width = 'w-modal-wide',
  isBusy = false,
  footer,
  contentClassName,
  children,
}: KeychronModalShellProps) {
  useEscapeClose(onClose, !isBusy)

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      data-testid={`${testId}-backdrop`}
      onClick={isBusy ? undefined : onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${testId}-title`}
        aria-busy={isBusy}
        className={`flex max-h-modal-90vh ${width} max-w-modal-xl-vw flex-col overflow-hidden rounded-lg bg-surface-alt p-6 shadow-xl`}
        data-testid={testId}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex shrink-0 items-center justify-between">
          <h3 id={`${testId}-title`} className="text-lg font-semibold text-content">
            {title}
          </h3>
          {!isBusy && <ModalCloseButton testid={`${testId}-close`} onClick={onClose} />}
        </div>
        <div
          className={`flex min-h-0 flex-1 flex-col overflow-y-auto${contentClassName ? ` ${contentClassName}` : ''}`}
        >
          {children}
        </div>
        {footer && (
          <div className="mt-4 flex shrink-0 items-center justify-end gap-2 border-t border-edge pt-4">
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}
