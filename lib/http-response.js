// Trigger retry.fetch clones non-2xx responses while checking status retry
// rules. Awaiting cancellation of the original body can wait on that unread
// clone branch, so error cleanup must not delay request error handling.
export function discardResponseBody(response) {
  try {
    response.body?.cancel()?.catch(() => {});
  } catch {}
}
