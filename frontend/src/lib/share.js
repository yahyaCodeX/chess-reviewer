// Shareable review links:  https://site/review/<gameId>?side=black
// `?review=<id>` also works, for static hosts without SPA rewrites.

const ID = /^[0-9a-f-]{8,64}$/i

/** { id, side } from the current URL, or null. */
export function reviewFromLocation(loc = window.location) {
  const fromPath = loc.pathname.match(/\/review\/([^/?#]+)/)?.[1]
  const params = new URLSearchParams(loc.search)
  const id = fromPath || params.get('review')
  if (!id || !ID.test(id)) return null
  const side = params.get('side') === 'black' ? 'black' : 'white'
  return { id, side }
}

export function reviewPath(id, side = 'white') {
  return `/review/${id}${side === 'black' ? '?side=black' : ''}`
}

export function reviewUrl(id, side) {
  return `${window.location.origin}${reviewPath(id, side)}`
}

/** Put the review in the address bar without reloading. */
export function showReviewInUrl(id, side) {
  try {
    window.history.replaceState(null, '', reviewPath(id, side))
  } catch {
    // sandboxed iframe etc. — sharing still works through the button
  }
}

export function clearReviewFromUrl() {
  try {
    if (reviewFromLocation()) window.history.replaceState(null, '', '/')
  } catch {
    // ignore
  }
}

/** Native share sheet on phones, clipboard elsewhere. Returns 'shared' | 'copied' | 'failed'. */
export async function shareLink(url, title) {
  try {
    if (navigator.share && window.matchMedia?.('(pointer: coarse)').matches) {
      await navigator.share({ title, url })
      return 'shared'
    }
  } catch (err) {
    if (err?.name === 'AbortError') return 'failed'
  }
  try {
    await navigator.clipboard.writeText(url)
    return 'copied'
  } catch {
    // Fallback for http pages / old browsers
    const ta = document.createElement('textarea')
    ta.value = url
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    ta.remove()
    return ok ? 'copied' : 'failed'
  }
}
