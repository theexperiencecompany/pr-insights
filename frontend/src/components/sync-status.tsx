import { useEffect, useRef, useState } from 'react'
import { RefreshCw } from 'lucide-react'

import { getStatus, triggerSync } from '@/lib/api'
import { timeAgo } from '@/lib/format'
import { useApi } from '@/lib/use-api'
import { cn } from '@/lib/utils'

import { Button } from '@/components/ui/button'

export function SyncStatus() {
  const { data, loading, refetch } = useApi(getStatus)
  const [syncError, setSyncError] = useState<string | null>(null)
  const wasSyncing = useRef(false)

  const syncing = data?.syncing ?? false

  useEffect(() => {
    if (!syncing) return
    const timer = setInterval(() => {
      refetch()
    }, 1500)
    return () => clearInterval(timer)
  }, [syncing, refetch])

  useEffect(() => {
    if (wasSyncing.current && !syncing) window.location.reload()
    wasSyncing.current = syncing
  }, [syncing])

  const handleSync = async () => {
    setSyncError(null)
    try {
      await triggerSync()
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : String(err))
    }
    refetch()
  }

  const failed = syncError !== null || Boolean(data?.lastError && !syncing)

  const dotClass = syncing
    ? 'bg-amber-500 animate-pulse'
    : failed
      ? 'bg-red-500'
      : 'bg-green-500'

  const label =
    loading && !data
      ? '…'
      : syncing
        ? 'Syncing…'
        : failed
          ? 'Sync failed'
          : data?.syncedAt
            ? `Updated ${timeAgo(data.syncedAt)}`
            : 'Not synced yet'

  return (
    <div className="flex items-center gap-3">
      <div className="flex items-center gap-2">
        <span className={cn('inline-block size-2 rounded-full', dotClass)} />
        <span className="text-sm text-white/70">{label}</span>
      </div>
      <Button
        variant="outline"
        size="sm"
        onClick={handleSync}
        disabled={syncing || loading}
        className="border-white/20 bg-transparent text-white hover:bg-white/10 hover:text-white dark:border-white/20 dark:bg-transparent dark:text-white dark:hover:bg-white/10 dark:hover:text-white"
      >
        <RefreshCw className={cn(syncing && 'animate-spin')} />
        Sync
      </Button>
    </div>
  )
}
