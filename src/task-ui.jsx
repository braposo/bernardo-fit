import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useRealtimeRun } from '@trigger.dev/react-hooks';
import { Toast } from 'radix-ui';
import { Button } from './admin/components/ui/button';

const notices = new Map();
const dismissTimers = new Map();
let toastRoot;
const SUCCESS_DISMISS_MS = 5000;
export function taskToast(id, update, replaceId) {
  const previous = notices.get(id) || notices.get(replaceId);
  if (replaceId && replaceId !== id) {
    clearTimeout(dismissTimers.get(replaceId));
    dismissTimers.delete(replaceId);
    notices.delete(replaceId);
  }
  clearTimeout(dismissTimers.get(id));
  dismissTimers.delete(id);
  const notice = { ...previous, ...update };
  notice.dismissAt = notice.terminal && notice.tone === 'ok'
    ? previous?.dismissAt || Date.now() + SUCCESS_DISMISS_MS
    : undefined;
  notices.set(id, notice);
  if (notice.dismissAt) {
    dismissTimers.set(id, setTimeout(() => {
      dismissTimers.delete(id);
      if (notices.get(id)?.dismissAt === notice.dismissAt) {
        notices.delete(id);
        paint();
      }
    }, Math.max(0, notice.dismissAt - Date.now())));
  }
  if (!toastRoot) {
    const host = document.createElement('div');
    document.body.append(host);
    toastRoot = createRoot(host);
  }
  paint();
}
function DismissCountdown({ dismissAt }) {
  const [remaining, setRemaining] = useState(() => Math.max(0, Math.ceil((dismissAt - Date.now()) / 1000)));
  useEffect(() => {
    setRemaining(Math.max(0, Math.ceil((dismissAt - Date.now()) / 1000)));
    const interval = setInterval(() => {
      setRemaining(Math.max(0, Math.ceil((dismissAt - Date.now()) / 1000)));
    }, 200);
    return () => clearInterval(interval);
  }, [dismissAt]);
  return <span aria-hidden="true"> ({remaining}s)</span>;
}
function paint() {
  toastRoot.render(<Toast.Provider swipeDirection="right"><>
    {[...notices].map(([id, notice]) => <Toast.Root key={id} open duration={Infinity}
      className="task-toast" data-task-id={id} data-tone={notice.tone || 'pending'} type="background"
      onOpenChange={open => { if (!open && notice.terminal) {
        clearTimeout(dismissTimers.get(id));
        dismissTimers.delete(id);
        notices.delete(id);
        paint();
      } }}>
      <Toast.Title className="task-toast-title">{notice.title || 'Background work'}</Toast.Title>
      <Toast.Description className="task-toast-message" role="status" aria-live="polite" aria-atomic="true">{notice.message}</Toast.Description>
      <div className="task-toast-actions">
        {notice.href && <a href={notice.href} onClick={event => {
          if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
          const url = new URL(notice.href, location.href);
          if (url.origin !== location.origin || url.pathname !== '/admin') return;
          const navigation = new CustomEvent('admin:navigate', { detail: url.href, cancelable: true });
          if (!document.dispatchEvent(navigation)) event.preventDefault();
        }}>{notice.linkLabel || 'Open result'}</a>}
        {notice.retry && <Button variant="outline" onClick={notice.retry}>Reconnect</Button>}
        {notice.terminal && <Toast.Close asChild><Button variant="ghost" aria-label={`Dismiss ${notice.title || 'notification'}`}>Dismiss{notice.dismissAt && <DismissCountdown dismissAt={notice.dismissAt} />}</Button></Toast.Close>}
      </div>
    </Toast.Root>)}
    <Toast.Viewport className="task-toast-viewport" label="Task notifications" />
  </></Toast.Provider>);
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
