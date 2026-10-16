---
description: Frontend i18n — namespaces, locale parity, no hardcoded user-visible text
globs:
      - frontend/src/locales/**/*.ts
      - frontend/src/sections/**/*.tsx
      - frontend/src/pages/*.tsx
      - frontend/src/layouts/**/*.tsx
alwaysApply: false
---

# Frontend I18n

A missing translation key does not fail a build and does not throw: i18next
renders the key itself, so `project.table.slug` ships to a user. Every check
here exists because the runtime is silent.

Machine-checked by `check-frontend-i18n.ts` (`make check-frontend-i18n`).

## Layout

| File | Contains |
|---|---|
| `locales/ko.ts` | Korean — the default *and* the fallback language |
| `locales/en.ts` | English — the same key set, field for field |
| `locales/i18n.ts` | init: `defaultNS: 'common'`, `fallbackLng: 'ko'`, and `SUPPORTED_LANGUAGES` |

**`SUPPORTED_LANGUAGES` in `i18n.ts` is the list of languages** — the checker
reads it rather than carrying its own. The two must agree in both directions: a
`locales/<x>.ts` absent from it is never loaded and never checked for parity
(measured: a third language file passed every check), and a name in it with no
file fails at startup.

Namespaces: `common` (words every screen needs), `nav`, and one per
domain. Korean is the fallback because this is a Korean-first product — falling
back to English would show a user text they cannot read, and falling back to the
key shows them nothing at all.

**A placeholder is a contract, and both halves are checked.** `{{name}}의
엔드포인트 {{total}}개` called with `{ project, total }` renders the literal
`{{name}}` on the screen — i18next leaves an unmatched placeholder in the
output, and every other check stays green because the key exists and is
translated in both locales. `check-frontend-i18n` compares the names a
`t(key, { … })` call passes against the `{{names}}` the string declares, in
either direction: a renamed value, a dropped one, and a renamed placeholder in
the locale all fire.

**Mock template tokens are not placeholders.** An endpoint body template uses
`{{path.id}}`, `{{query.x}}`, … and the help text that lists them must show the
braces literally. A token spelled inside a locale string is read by i18next as
an interpolation (and by this check as a placeholder no call passes), so the
tokens never appear in `locales/`: the sentence comes from the locale, the
tokens are rendered from the code constant `TEMPLATE_TOKENS`.

## Using a Namespace

```tsx
const { t } = useTranslation('project')    // t('table.slug')
const { t: tCommon } = useTranslation('common')
const { t: tNav } = useTranslation('nav')
```

`useTranslation()` with no argument resolves against `common` — so
`t('nav.project')` under a bare `useTranslation()` looks up
`common.nav.project` and renders the key. Name the namespace.

A key held in a config object (`t(item.titleKey)`) must still be a bare key
inside a named namespace: `useTranslation('nav')` + `titleKey: 'project'`,
never a dotted path against the default namespace.

## The Compiler Owns The Keys

`locales/i18next.d.ts` declares the resources to i18next, so **every `t()` call
is type-checked against `ko`** — the default *and* fallback language, whose key
set `check-frontend-i18n` proves `en` matches. A key that exists nowhere is a
build failure, not a string rendered on screen.

This is why the closed vocabularies are unions. A composed key type-checks only
when *every* value its interpolation can take forms a real key:

```tsx
t(`method.${endpoint.method}`)        // HttpMethod union — every key present
t(`table.${column.key}`)              // string — refused
```

The second line type-checks only if `t()` takes any string; a header keyed off
a free `string` renders `table.<x>` the day a column is added without its key.

So the chain that ends here starts in the backend: a closed set (the matcher's
`METHODS`) becomes a `Literal` in the schema, becomes a TS union in
`types/<domain>.ts`, and only then can a composed key be proven. A field left
as `string` anywhere along it breaks the proof at this end.

A key held in a config object is typed the same way — `ParseKeys<'nav'>` on
`NavItem.titleKey`, not `string`, because the sidebar renders it at a distance
and no test reads a label.

**Interpolation values are text.** The types infer `{{from}}` as a string, so a
number is converted at the call site. And `count` is **reserved**: i18next reads
it as the plural selector, so a sentence that merely displays a total names it
something else (`{{total}}`) rather than silently asking for plural forms the
key does not have.

## Server Failures Are Codes, Not Sentences

The backend answers every failure with `{ detail, code, request_id }`. `detail`
is English written for a log; the user reads a translation keyed by `code`:

```ts
// locales/ko.ts and locales/en.ts, same keys
errors: {
  not_found: '대상을 찾을 수 없습니다',
  conflict: '이미 사용 중인 값입니다',
  stale_version: '다른 곳에서 먼저 수정되었습니다',
  service_unavailable: '서버를 사용할 수 없습니다',
  mock_not_matched: '일치하는 엔드포인트가 없습니다',
  unknown: '요청을 처리할 수 없습니다',
}
```

- The UI renders `t('errors.<code>', { ns: 'common' })` — **never**
  `apiError.message`, never `detail`. Rendering the server's string ships
  English into a Korean screen and hard-codes copy the frontend cannot change.
- Every code the backend can emit has a key in **every** locale. A new failure
  mode without a translation is a gate failure, not an `unknown_error` on screen.
- `errors.unknown` is the fallback for a transport failure that never reached a
  handler, so it always exists.
- A dialog may put the message on the input that owns it (`conflict` →
  the `slug` field), but the sentence still comes from the locale file.

## The Reader's Language

- **Remembered, and first painted.** The choice is stored in the `app-settings`
  object the theme keeps its mode in (`theme/settings.tsx`), under `language`.
  `i18n.ts` reads it before `init` (`lng: storedLanguage()`), because the
  module runs before the first render - applied in an effect, the page painted
  in the default language and then swapped every word - and stores it again on
  `languageChanged`.
- **Dates follow it.** `formatDateTime` builds one `Intl.DateTimeFormat` per
  language from `i18next.language`; nothing else spells a date. A fixed
  `'ko-KR'` printed Korean dates in the English UI, and `toLocaleDateString()`
  speaks the browser's language, not the app's.
- **Composition is not Enter.** A text box that acts on Enter returns while
  `nativeEvent.isComposing` or `keyCode === 229`: the Enter that ends a Hangul
  syllable belongs to the IME, and acting on it submits and then types the
  last syllable again into the emptied box.

## What Is Checked

1. **Locale parity, both ways** — a key in `ko` and not in `en` is a silent
   fallback only an English user sees
2. **Every literal `t('key')` resolves** in the namespace its alias was bound to
3. **No Korean outside `locales/`** — text that bypassed i18n cannot be
   translated at all, and it is the one violation that is invisible in review
   when the reviewer reads Korean
4. **Error-code parity, both ways** — every `code` the backend can emit
   (handler literals in `app/core/exceptions.py` plus `code=` at any raise site)
   has `errors.<code>` in every locale, and an `errors.*` key no backend code
   emits is dead copy
5. **No server string on screen** — `apiError.message`, `error.message` and
   `detail` never reach a toast or JSX; the sentence comes from the locale file
6. **The language is remembered** — `lng` is read from storage, never the bare
   `DEFAULT_LANGUAGE`; a switch is stored; `i18n.ts`'s `SETTINGS_KEY` equals the
   theme's `STORAGE_KEY`
7. **Dates follow the language** — no `Intl.DateTimeFormat('<locale>'` and no
   `toLocaleDateString(`/`toLocaleTimeString(` outside `locales/`
8. **Composition guard** — a `.tsx` that renders a text box and tests
   `key === 'Enter'` also tests `isComposing` and keyCode 229

## Review Judgement (not machine-checked)

- Whether a translation is *correct*. Key parity is checked; a wrong Korean
  sentence with a matching key passes.
- Whether a dynamic key (`t(item.titleKey)`) resolves. Only literal keys can be
  verified, so a computed key is a review concern — keep it a bare key inside a
  named namespace so the possible values are visible in one file.
- Korean inside a **comment** is exempt: a comment quoting the string it
  explains is how the reason survives, and flagging it would push authors to
  write vaguer comments.

## Never Do These

- Add a key to one language and not the other
- Use a dotted path against the default namespace (`t('nav.project')`)
- Put user-visible Korean in a component, a comment excepted only in `locales/`
- Interpolate a name into a sentence by concatenation — use `{{name}}`
- Spell a mock template token (`{{path.id}}`) inside a locale string — render it from `TEMPLATE_TOKENS`
- Read a label from a hook when the screen already has `t`
- Render a server `detail` (or `ApiError.message`) as user-facing copy
- Add a backend error code without an `errors.<code>` entry in every locale
- Reuse one code for two failures a user must tell apart
- Initialise i18next with `DEFAULT_LANGUAGE`, or store the language under a key
  of its own
- Spell a date with a fixed locale or the browser's
- Act on Enter in a text box without the composition guard
