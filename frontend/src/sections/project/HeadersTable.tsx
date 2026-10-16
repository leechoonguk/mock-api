/**
 * A set of HTTP headers, one row per name — what was sent or what came back.
 *
 * Shared by the test panel's response and the log panel's request, so both
 * read the same: the name clipped to its share, the value whole on hover.
 */

import { Stack, Table, TableBody, TableCell, TableRow, Typography } from '@mui/material'
import ClippedText from '@/components/clipped-text/ClippedText'
import { RECORD_SURFACE } from '@/config'

interface HeadersTableProps {
  title: string
  headers: Record<string, string>
  /** The sentence shown instead of an empty table. */
  empty: string
}

export default function HeadersTable({ title, headers, empty }: HeadersTableProps) {
  const entries = Object.entries(headers).sort(([left], [right]) => left.localeCompare(right))

  return (
    <Stack spacing={0.5}>
      <Typography variant="caption" color="text.secondary">
        {title}
      </Typography>
      {entries.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          {empty}
        </Typography>
      ) : (
        <Table
          size="small"
          sx={{
            tableLayout: 'fixed',
            bgcolor: 'background.paper',
            '& td': { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
          }}
        >
          <TableBody>
            {entries.map(([name, value]) => (
              <TableRow key={name} sx={{ height: RECORD_SURFACE.TABLE_ROW_HEIGHT }}>
                <TableCell sx={{ width: '30%' }}>
                  <ClippedText text={name} />
                </TableCell>
                <TableCell>
                  <ClippedText text={value} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Stack>
  )
}
