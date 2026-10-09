import React, { useEffect } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { useRealtimeRun } from '@trigger.dev/react-hooks';
import { Toaster, toast } from 'sonner';

const notices = new Map();
const dismissTimers = new Map();
const dismissed = new Set();
try { JSON.parse(sessionStorage.getItem('fit.dismissedToasts') || '[]').forEach(id => dismissed.add(id)); } catch {}
let toastRoot;
const SUCCESS_DISMISS_MS = 5000;
function dismissNotice(id) {
  dismissed.add(id);
  // Presentation state only: subscriptions and action locks belong to the task tracker.
  try { sessionStorage.setItem('fit.dismissedToasts', JSON.stringify([...dismissed].slice(-200))); } catch {}
  clearTimeout(dismissTimers.get(id));
  dismissTimers.delete(id);
  notices.delete(id);
  toast.dismiss(id);
}
export function taskToast(id, update, replaceId) {
  // A fresh submission reuses the action placeholder, whereas run IDs are unique.
  if (update.message === 'Starting…' && update.terminal === false) {
    dismissed.delete(id);
    notices.delete(id);
    try { sessionStorage.setItem('fit.dismissedToasts', JSON.stringify([...dismissed].slice(-200))); } catch {}
  }
  const previous = notices.get(id) || notices.get(replaceId);
  if (replaceId && replaceId !== id) {
    clearTimeout(dismissTimers.get(replaceId));
    dismissTimers.delete(replaceId);
    notices.delete(replaceId);
    toast.dismiss(replaceId);
    if (dismissed.delete(replaceId)) dismissNotice(id);
  }
  if (dismissed.has(id)) return;
  clearTimeout(dismissTimers.get(id));
  dismissTimers.delete(id);
  const notice = { ...previous, ...update };
  notice.dismissAt = notice.terminal && notice.tone === 'ok'
    ? previous?.dismissAt || Date.now() + SUCCESS_DISMISS_MS
    : undefined;
  notices.set(id, notice);
  if (notice.dismissAt) {
    // Sonner pauses native durations on hover/focus. The task deadline must not pause.
    dismissTimers.set(id, setTimeout(() => dismissNotice(id), Math.max(0, notice.dismissAt - Date.now())));
  }
  if (!toastRoot) {
    const host = document.createElement('div');
    document.body.append(host);
    toastRoot = createRoot(host);
    flushSync(() => toastRoot.render(<Toaster className="task-toast-viewport" position="bottom-right"
      offset={16} mobileOffset={16} gap={8} duration={Infinity} containerAriaLabel="Task notifications"
      toastOptions={{ unstyled: true }} />));
  }
  toast.custom(() => <TaskNotice id={id} notice={notice} />, {
    id, duration: Infinity, onDismiss: () => { if (notices.has(id)) dismissNotice(id); },
  });
}
function TaskNotice({ id, notice }) {
  const title = notice.title || 'Background work';
  return <div className="task-toast" data-task-id={id} data-tone={notice.tone || 'pending'} data-dismiss-at={notice.dismissAt}>
      <span className="task-toast-dot" aria-hidden="true" />
      <div className="task-toast-text">
        <div className="task-toast-title" title={title}>{title}</div>
        <div className="task-toast-message" role="status" aria-live="polite" aria-atomic="true">{notice.message}</div>
      </div>
      <div className="task-toast-actions">
        {notice.href && <a href={notice.href} onClick={event => {
          if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
          const url = new URL(notice.href, location.href);
          if (url.origin !== location.origin || url.pathname !== '/admin') return;
          const navigation = new CustomEvent('admin:navigate', { detail: url.href, cancelable: true });
          if (!document.dispatchEvent(navigation)) event.preventDefault();
        }}>{notice.linkLabel || 'Open result'}</a>}
        {notice.retry && <button type="button" className="task-toast-retry" onClick={notice.retry}>Reconnect</button>}
        {/* Swiping dismisses; this control appears only for keyboard focus. */}
        <button type="button" className="task-toast-dismiss" onClick={() => dismissNotice(id)} aria-label={`Dismiss ${title}`}>Dismiss</button>
      </div>
  </div>;
}

function Subscription({ credentials, refreshAccessToken, onUpdate, onError }) {
  const { run, error } = useRealtimeRun(credentials.runId, {
    accessToken: credentials.publicAccessToken, refreshAccessToken,
    skipColumns: ['payload', 'output', 'error'],
  });
  useEffect(() => { if (run) onUpdate(run); }, [run, onUpdate]);
  useEffect(() => { if (error) onError(error); }, [error, onError]);
  return null;
}

// Reconnect the subscription, never restart the task, after a transport failure.
export function subscribeRun(credentials, { refreshAccessToken, onUpdate, onError }) {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  let stopped = false, timer, attempt = 0;
  function connect() {
    if (stopped) return;
    root.render(<Subscription key={attempt++} credentials={credentials}
      refreshAccessToken={refreshAccessToken} onUpdate={onUpdate} onError={error => {
        onError(error);
        clearTimeout(timer);
        timer = setTimeout(connect, 5000);
      }} />);
  }
  connect();
  return () => {
    if (stopped) return;
    stopped = true; clearTimeout(timer);
    queueMicrotask(() => { root.unmount(); host.remove(); });
  };
}
