/**
 * Central query-key factory.
 *
 * A hook that spells its own key array cannot be invalidated by anyone else:
 * the mutation and the query drift apart and the list silently shows stale
 * rows. Every domain therefore takes its keys from `createQueryKeys`, and
 * `check-frontend-api-layer` rejects an inline `queryKey: ['...']` literal.
 */

interface QueryKeyFactory {
  all: readonly [string]
  lists: () => readonly [string, 'list']
  list: (params: object) => readonly [string, 'list', object]
  details: () => readonly [string, 'detail']
  detail: (id: string) => readonly [string, 'detail', string]
}

function createQueryKeys(scope: string): QueryKeyFactory {
  return {
    all: [scope],
    lists: () => [scope, 'list'],
    list: (params) => [scope, 'list', params],
    details: () => [scope, 'detail'],
    detail: (id) => [scope, 'detail', id],
  }
}

export const projectKeys = createQueryKeys('projects')

/**
 * A project's endpoints — their own scope, so an endpoint edit refreshes the
 * endpoint table without refetching every project list (the project rows only
 * carry the count, which the endpoint hooks invalidate explicitly).
 */
export const endpointKeys = createQueryKeys('endpoints')

/**
 * A project's request log — its own scope: every mock call writes one, from
 * any client, outside any request of this one, so a project's own edits must
 * not mark it invalid and it is polled while shown.
 */
export const logKeys = createQueryKeys('request-logs')

/**
 * The fields whose value changed between calls in a project's log - mined from
 * the log, so it is a scope of its own (not a discriminator in `logKeys`): a log
 * clear and a project's `ignored_fields` edit invalidate it, a log refetch does not.
 */
export const volatileFieldKeys = createQueryKeys('volatile-fields')

/** The forward proxy's status - written by no admin call, so it is polled while shown. */
export const proxyKeys = createQueryKeys('proxy')
