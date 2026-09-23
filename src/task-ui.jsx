import React, { useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { useRealtimeRun } from '@trigger.dev/react-hooks';
import { Toast } from 'radix-ui';
import { Button } from './admin/components/ui/button';

const notices = new Map();
let toastRoot;
export function taskToast(id, update) {
  notices.set(id, { ...notices.get(id), ...update });
  if (!toastRoot) {
    const host = document.createElement('div');
    document.body.append(host);
    toastRoot = createRoot(host);
  }
  paint();
}
function paint() {
  toastRoot.render(<Toast.Provider swipeDirection="right"><>
    {[...notices].map(([id, notice]) => <Toast.Root key={id} open duration={Infinity}
      className="task-toast" data-tone={notice.tone || 'pending'} type="background"
      onOpenChange={open => { if (!open && notice.terminal) { notices.delete(id); paint(); } }}>
      <Toast.Title className="task-toast-title">{notice.title || 'Background work'}</Toast.Title>
      <Toast.Description className="task-toast-message" role="status" aria-live="polite" aria-atomic="true">{notice.message}</Toast.Description>
      <div className="task-toast-actions">
        {notice.href && <a href={notice.href}>{notice.linkLabel || 'Open result'}</a>}
        {notice.retry && <Button variant="outline" onClick={notice.retry}>Reconnect</Button>}
        {notice.terminal && <Toast.Close asChild><Button variant="ghost" aria-label={`Dismiss ${notice.title || 'notification'}`}>Dismiss</Button></Toast.Close>}
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
