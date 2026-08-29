import type { Pager } from '@/lib/api'

import { Button } from '@/components/ui/button'
import { CardFooter } from '@/components/ui/card'

interface PagerProps {
  pager: Pager
  onPage: (page: number) => void
}

/**
 * Enhanced Pager — now rendered as a CardFooter for visual consistency
 * (muted background, top border, rounded bottom). Works both inside a
 * Card (as a true footer) and standalone (as a bordered bar).
 */
export function Pager({ pager, onPage }: PagerProps) {
  return (
    <CardFooter className="justify-between py-3">
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
    </CardFooter>
  )
}
