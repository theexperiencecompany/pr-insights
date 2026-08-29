import { useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

export interface Column<T> {
  header: string
  headerClassName?: string
  cell: (row: T, index: number) => React.ReactNode
  cellClassName?: string
}

interface VirtualizedTableProps<T> {
  data: T[]
  columns: Column<T>[]
  rowKey: (row: T, index: number) => string
  estimateSize?: number
  maxHeight?: number
  overscan?: number
}

/**
 * VirtualizedTable renders large tables with row windowing via @tanstack/react-virtual.
 * Small datasets (<50 rows) render as a regular table to preserve semantics and avoid overhead.
 * Large datasets are virtualized: only visible rows are mounted, greatly reducing DOM cost.
 */
export function VirtualizedTable<T>({
  data,
  columns,
  rowKey,
  estimateSize = 44,
  maxHeight = 480,
  overscan = 8,
}: VirtualizedTableProps<T>) {
  const parentRef = useRef<HTMLDivElement>(null)

  if (data.length < 50) {
    return (
      <Table>
        <TableHeader>
          <TableRow>
            {columns.map((col, i) => (
              <TableHead key={i} className={col.headerClassName}>
                {col.header}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.map((row, idx) => (
            <TableRow key={rowKey(row, idx)}>
              {columns.map((col, ci) => (
                <TableCell key={ci} className={col.cellClassName}>
                  {col.cell(row, idx)}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    )
  }

  const virtualizer = useVirtualizer({
    count: data.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => estimateSize,
    overscan,
  })

  const items = virtualizer.getVirtualItems()

  return (
    <div ref={parentRef} className="relative w-full overflow-auto" style={{ maxHeight }}>
      <Table>
        <TableHeader className="sticky top-0 z-10 bg-background">
          <TableRow>
            {columns.map((col, i) => (
              <TableHead key={i} className={col.headerClassName}>
                {col.header}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {/* spacer for total height */}
          <tr>
            <td colSpan={columns.length} style={{ padding: 0, border: 0 }}>
              <div style={{ height: `${virtualizer.getTotalSize()}px`, position: 'relative', width: '100%' }}>
                {items.map((vr) => {
                  const row = data[vr.index]
                  return (
                    <div
                      key={rowKey(row, vr.index)}
                      data-index={vr.index}
                      ref={virtualizer.measureElement}
                      style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: '100%',
                        transform: `translateY(${vr.start}px)`,
                      }}
                    >
                      <Table style={{ tableLayout: 'fixed' }}>
                        <TableBody>
                          <TableRow>
                            {columns.map((col, ci) => (
                              <TableCell key={ci} className={col.cellClassName}>
                                {col.cell(row, vr.index)}
                              </TableCell>
                            ))}
                          </TableRow>
                        </TableBody>
                      </Table>
                    </div>
                  )
                })}
              </div>
            </td>
          </tr>
        </TableBody>
      </Table>
    </div>
  )
}
