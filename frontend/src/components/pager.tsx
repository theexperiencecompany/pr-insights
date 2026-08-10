import type { Pager } from '@/lib/api'

import { Button } from '@/components/ui/button'

interface PagerProps {
  pager: Pager
  onPage: (page: number) => void
}

export function Pager({ pager, onPage }: PagerProps) {
  return (
    <div className="flex items-center justify-between px-4 py-3">
      <span className="text-xs text-muted-foreground">
        Showing {pager.from + 1}–{pager.to} of {pager.total}
      </span>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={!pager.hasPrev}
          onClick={() => onPage(pager.page - 1)}
        >
          Previous
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={!pager.hasNext}
          onClick={() => onPage(pager.page + 1)}
        >
          Next
        </Button>
      </div>
    </div>
  )
}
