// SPDX-License-Identifier: GPL-2.0-or-later

import type { SyncStatusType } from '../../shared/types/sync'

export const SYNC_STATUS_CLASS: Record<Exclude<SyncStatusType, 'none'>, string> = {
  pending: 'text-pending',
  syncing: 'text-warning animate-pulse',
  synced: 'text-accent',
  error: 'text-danger',
  partial: 'text-warning',
}
