/**
 * Every context the app needs, composed once.
 *
 * The order is load-bearing: the snackbar must wrap everything that reports an
 * error. The client is created inside `useState` so a remount never shares a
 * cache with the tree it replaced.
 */

import { useState } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { SnackbarProvider } from 'notistack'
import type { ReactNode } from 'react'
import Toast from '@/components/snackbar/Toast'
import ThemeProvider from '@/theme/index'
import {
  QUERY_GC_TIME,
  QUERY_RETRY,
  QUERY_RETRY_DELAY_MAX_MS,
  QUERY_STALE_TIME,
} from '@/lib/api/queryDefaults'
import { toApiError } from '@/lib/api/errors'
import '@/locales/i18n'

const SNACKBAR_AUTO_HIDE_MS = 4000

export default function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: QUERY_STALE_TIME.STANDARD,
            gcTime: QUERY_GC_TIME.STANDARD,
            // A 4xx is the request's own fault: asking again answers the same,
            // and a half-typed date's 422 retried into a second error toast.
            retry: (failureCount, error) => {
              const status = toApiError(error).status
              return status >= 400 && status < 500 ? false : failureCount < QUERY_RETRY
            },
            retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, QUERY_RETRY_DELAY_MAX_MS),
            refetchOnWindowFocus: false,
          },
          mutations: { retry: 0 },
        },
      }),
  )

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <SnackbarProvider
          maxSnack={3}
          autoHideDuration={SNACKBAR_AUTO_HIDE_MS}
          anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
          Components={{ success: Toast, error: Toast }}
          /**
           * One toast per sentence while it is on screen.
           *
           * A record dialog fires several reads at once, so a backend that is
           * down answered with stacked copies of the same sentence — three
           * shown, the rest queued behind them, and the reader had to dismiss a
           * wall to reach the screen. Identical text is one event to a reader,
           * whatever the request count was.
           */
          preventDuplicate
          /**
           * The countdown runs whether or not the window is focused.
           *
           * notistack pauses it on window blur, which is meant for "the user was
           * away, so show them what they missed" — but this app's toasts report
           * an action the user just took, and a reader who clicks to their editor
           * and back finds an old "deleted" toast still on screen (measured:
           * still there 8s after a blur, with no way to tell it from a message
           * about the row they are looking at now).
           */
          disableWindowBlurListener
        >
          {children}
        </SnackbarProvider>
      </ThemeProvider>
    </QueryClientProvider>
  )
}
