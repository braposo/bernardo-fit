import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MessageCircle, Send, Square, Plus, ExternalLink } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Textarea } from '../components/ui/textarea';
import { Dialog, DialogContent, DialogTitle, DialogDescription, DialogTrigger } from '../components/ui/dialog';
import { Message, MessageContent, MessageHeader } from '../components/ui/message';
import { Bubble, BubbleContent } from '../components/ui/bubble';
import { MessageScrollerProvider, MessageScroller, MessageScrollerViewport, MessageScrollerContent,
  MessageScrollerItem, MessageScrollerButton } from '../components/ui/message-scroller';
import { historyForTurns } from './stream';
import { followChatRequest } from './transport';
import { MarkdownMessage } from './MarkdownMessage';

const SESSION_KEY = 'bfit_admin_chat';
const phases = { queued: 'Queued…', connecting: 'Connecting to your content…', routing: 'Thinking…', reading: 'Reading content…', 'query-failed': 'Checking another source…', writing: 'Writing…', saving: 'Saving…', complete: 'Response complete.', truncated: 'Response limit reached.', failed: 'Response failed.', stopped: 'Response stopped.' };
const sourceSections = { job: 'overview', fitAssessment: 'overview', fitReport: 'materials', coverLetter: 'materials', companyResearch: 'materials', interviewBrief: 'materials', applicationQuestion: 'materials' };
const sourceTypes = { candidateProfile: 'Profile', candidateEvidence: 'Experience', job: 'Role', fitAssessment: 'Fit assessment', fitReport: 'Fit report', coverLetter: 'Cover letter', companyResearch: 'Research', interviewBrief: 'Interview brief', applicationQuestion: 'Application question', sitePage: 'Page', writingGuidance: 'Writing guidance' };

function sourceDestination(source) {
  return typeof source.jobId === 'string' && source.jobId.trim() && sourceSections[source.type]
    ? `/admin?job=${encodeURIComponent(source.jobId)}&section=${sourceSections[source.type]}` : '';
}

function sourceTitle(source) {
  return source.title === source.type ? sourceTypes[source.type] || 'Source' : source.title;
}

function displaySources(sources) {
  const seen = new Set();
  return (Array.isArray(sources) ? sources : []).filter(source => {
    if (!source || typeof source.title !== 'string' || !source.title.trim()) return false;
    const key = `${source.type}:${source.title.trim().toLocaleLowerCase()}:${sourceDestination(source)}`;
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
}

function ChatPanel({ authenticated, getSecret, onUnauthorized }) {
  const [open, setOpen] = useState(false), [config, setConfig] = useState(null), [configError, setConfigError] = useState('');
  const [turns, setTurns] = useState([]), [draft, setDraft] = useState(''), [error, setError] = useState('');
  const [restored, setRestored] = useState(false);
  const [busy, setBusy] = useState(false), [phase, setPhase] = useState('');
  const active = useRef(null), conversation = useRef(null), composer = useRef(null), generation = useRef(0);
  const headers = () => ({ 'x-admin-secret': getSecret(), 'Content-Type': 'application/json' });
  useEffect(() => {
    if (!authenticated) {
      generation.current++; active.current?.abort(); active.current = null;
      sessionStorage.removeItem(SESSION_KEY); setRestored(false);
      setOpen(false); setTurns([]); setDraft(''); setConfig(null); setBusy(false); setError(''); conversation.current = null;
    } else {
      try {
        const saved = JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null');
        if (saved && Array.isArray(saved.turns)) {
          conversation.current = saved.conversationId; setTurns(saved.turns); setDraft(saved.draft || '');
        }
      } catch { sessionStorage.removeItem(SESSION_KEY); }
      setRestored(true);
    }
  }, [authenticated]);
  useEffect(() => {
    if (authenticated && restored) {
      try { sessionStorage.setItem(SESSION_KEY, JSON.stringify({ conversationId: conversation.current, turns, draft })); } catch { /* Chat still works if browser storage is full. */ }
    }
  }, [authenticated, restored, turns, draft]);
  useEffect(() => {
    const pending = turns.at(-1);
    if (authenticated && restored && pending?.status === 'running' && pending.request && !active.current) runTurn(pending.request, { ...pending });
  }, [authenticated, restored]);
  useEffect(() => () => { generation.current++; active.current?.abort(); }, []);
  useEffect(() => {
    if (!open || !authenticated) return;
    const controller = new AbortController();
    setConfigError('');
    fetch('/api/admin/chat', { headers: headers(), signal: controller.signal }).then(async response => {
      if (response.status === 401) { onUnauthorized(); throw new Error('Your session expired.'); }
      if (!response.ok) throw new Error('Could not load chat settings. Close and reopen chat to retry.');
      const data = await response.json();
      if (!Array.isArray(data.models)) throw new Error('Chat settings are unavailable.');
      if (!controller.signal.aborted) setConfig(data);
    }).catch(e => { if (!controller.signal.aborted) setConfigError(e.message); });
    return () => controller.abort();
  }, [open, authenticated]);

  const hasProvider = config?.models?.some(m => m.available);
  const canSend = config?.enabled && config.contextConfigured && hasProvider && config.autoAvailable && config.workerConfigured;
  const updateTurn = turn => setTurns(previous => previous.map(item => item.id === turn.id ? { ...turn } : item));
  async function send(question, retry = false) {
    if (active.current || !canSend || !question.trim()) return;
    const previous = retry ? turns.slice(0, -1) : turns;
    let messages;
    try { messages = historyForTurns(previous, question.trim()); } catch (e) { setError(e.message); return; }
    conversation.current ||= crypto.randomUUID();
    const request = { messages, provider: 'auto', model: 'auto', conversationId: conversation.current, requestId: crypto.randomUUID() };
    const turn = { id: request.requestId, request, question: question.trim(), text: '', sources: [], status: 'running' };
    // Persist the idempotency key before the first network call, including ambiguous submissions.
    try { sessionStorage.setItem(SESSION_KEY, JSON.stringify({ conversationId: conversation.current, turns: [...previous, turn], draft: retry ? draft : '' })); } catch { /* Storage can be unavailable. */ }
    setTurns([...previous, turn]); if (!retry) setDraft('');
    await runTurn(request, turn);
  }
  async function stop() {
    const controller = active.current;
    if (!controller) return;
    controller.stopRequested = true; setPhase('Stopping…');
    if (!controller.runId) return;
    try {
      const response = await fetch('/api/admin/chat', { method: 'POST', headers: headers(), body: JSON.stringify({ action: 'stop', runId: controller.runId }) });
      if (response.status === 401) { onUnauthorized(); return; }
      if (!response.ok) throw Error('Stop failed');
    } catch { setPhase('Could not stop. Try Stop again.'); }
  }
  async function runTurn(request, turn) {
    const controller = new AbortController(), epoch = ++generation.current;
    active.current = controller; controller.runId = turn.runId; setError(''); setBusy(true); setPhase(turn.runId ? 'Reconnecting…' : 'Submitting…');
    let frame;
    const flush = () => { frame = undefined; if (generation.current === epoch) updateTurn(turn); };
    try {
      await followChatRequest({ request, runId: turn.runId, cursor: turn.cursor || 0, headers, signal: controller.signal,
        onRun: runId => { controller.runId = runId; turn.runId = runId; flush(); if (controller.stopRequested) stop(); },
        onReconnect: () => setPhase('Reconnecting… Your request is still being tracked.'),
        onEvent: (event, value) => {
          if (generation.current !== epoch) return;
          if (Number.isSafeInteger(value.seq)) turn.cursor = value.seq + 1;
          if (event === 'route') setPhase('Thinking…');
          if (event === 'text' && typeof value.text === 'string') { turn.text += value.text; setPhase('Writing…'); }
          if (event === 'activity') setPhase(phases[value.state] || 'Processing…');
          if (event === 'sources' && Array.isArray(value.sources)) turn.sources = value.sources;
          if (event === 'snapshot') {
            for (const field of ['text', 'sources', 'status', 'storage', 'error']) if (value[field] !== undefined) turn[field] = value[field];
          }
          if (event === 'done') turn.status = value.status || (value.truncated ? 'truncated' : 'complete');
          if (!frame) frame = requestAnimationFrame(flush);
        },
      });
    } catch (e) {
      if (generation.current !== epoch) return;
      if (e.status === 401 || e.status === 403) { onUnauthorized(); return; }
      turn.status = 'failed'; turn.error = e.message;
    } finally {
      cancelAnimationFrame(frame);
      if (generation.current === epoch) {
        flush(); active.current = null; setBusy(false); setPhase(''); composer.current?.focus();
      }
    }
  }
  function newChat() {
    generation.current++; active.current?.abort(); active.current = null;
    setTurns([]); setError(''); setBusy(false); setPhase(''); conversation.current = null; composer.current?.focus();
  }
  const last = turns.at(-1), incomplete = last && last.status !== 'complete';
  const unavailable = config && (!config.enabled ? 'Chat is not enabled in this environment yet.' :
    !config.contextConfigured ? 'The content connection is unavailable.' :
    !hasProvider || !config.autoAvailable || !config.workerConfigured ? 'Chat is temporarily unavailable. Please try again later.' : '');
  if (!authenticated) return null;
  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger asChild><Button className="admin-chat-launcher" variant="secondary"><MessageCircle aria-hidden="true" />Your assistant</Button></DialogTrigger>
    <DialogContent className="admin-chat-panel" onOpenAutoFocus={e => { e.preventDefault(); composer.current?.focus(); }}>
      <header className="chat-heading"><div><DialogTitle>Your assistant</DialogTitle>
        <DialogDescription>Ask me about your experience, roles and applications.</DialogDescription></div>
        <Button className="chat-new-button" variant="outline" onClick={newChat} disabled={busy || !turns.length} aria-label="Start a new chat"><Plus aria-hidden="true" />New chat</Button></header>
      <MessageScrollerProvider key={conversation.current || 'empty'} defaultScrollPosition="end" autoScroll>
        <MessageScroller className="chat-scroll">
          <MessageScrollerViewport aria-label="Chat messages"><MessageScrollerContent className="chat-messages" aria-live="off">
            {!turns.length && <div className="chat-empty"><MessageCircle size={28} aria-hidden="true" /><h3>What would you like to explore?</h3><p>Ask about your strongest evidence, compare roles, or work through an application.</p>
              <Button variant="outline" onClick={() => { setDraft('Which roles best match my experience?'); composer.current?.focus(); }}>Compare my roles</Button></div>}
            {turns.map(turn => <MessageScrollerItem key={turn.id} messageId={turn.id}>
              <Message align="end"><MessageContent><MessageHeader>You</MessageHeader><Bubble variant="secondary"><BubbleContent className="chat-text">{turn.question}</BubbleContent></Bubble></MessageContent></Message>
              <Message className="chat-answer"><MessageContent><MessageHeader>Assistant</MessageHeader>
                <Bubble variant="ghost"><BubbleContent>{turn.text ? <MarkdownMessage text={turn.text} /> : (turn.status === 'running' ? 'Working on your question…' : 'No response received.')}</BubbleContent></Bubble>
                <details className="chat-sources"><summary><span>Sources consulted</span><span className="chat-source-count">{displaySources(turn.sources).length}</span></summary>{displaySources(turn.sources).length > 0 ? <ul>{displaySources(turn.sources).map(source => <li key={source.id}>
                  {source.title !== source.type && <span className="chat-source-type">{sourceTypes[source.type] || 'Source'}</span>}{sourceDestination(source) ?
                  <a href={sourceDestination(source)} onClick={event => {
                    if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
                    event.preventDefault();
                    const url = new URL(window.location.href); url.searchParams.set('job', source.jobId); url.searchParams.set('section', sourceSections[source.type]);
                    window.history.pushState({}, '', url); window.dispatchEvent(new PopStateEvent('popstate')); setOpen(false);
                  }}>{sourceTitle(source)}<ExternalLink size={14} aria-hidden="true" /></a> : <span className="chat-source-title">{sourceTitle(source)}</span>}</li>)}</ul> : <p className="chat-source-empty">{turn.status === 'running' ? 'Sources will appear here when found.' : 'No source records were returned for this answer.'}</p>}</details>
                {turn.status === 'stopped' && <p className="chat-notice">Stopped · partial response</p>}
                {turn.status === 'truncated' && <p className="chat-notice">Response limit reached. Try a narrower question.</p>}
                {turn.error && <p className="chat-error" role="alert">{turn.error}</p>}
                {turn.storage === 'failed' && <p className="chat-notice">This conversation could not be saved.</p>}
              </MessageContent></Message>
            </MessageScrollerItem>)}
          </MessageScrollerContent></MessageScrollerViewport>
          <MessageScrollerButton className="chat-scroll-button" />
        </MessageScroller>
      </MessageScrollerProvider>
      <form className="chat-composer" onSubmit={e => { e.preventDefault(); send(draft); }}>
        {error && <p className="chat-error" role="alert">{error}</p>}
        {!busy && incomplete && <div className="chat-retry"><span>Retry this question or start a new chat to continue.</span><Button type="button" variant="outline" disabled={!canSend} onClick={() => send(last.question, true)}>Retry</Button></div>}
        <label className="sr-only" htmlFor="chat-question">Message</label>
        <Textarea id="chat-question" ref={composer} value={draft} maxLength={12000} placeholder="Ask about your content…" rows={2}
          onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); if (!busy && !incomplete) send(draft); } }} />
        <div className="chat-composer-footer"><p className="chat-status" role="status" aria-live="polite">{busy ? phase : configError || unavailable || (!config ? 'Loading chat…' : phases[last?.status] || 'Ready when you are.')}</p>
          {busy ? <Button type="button" variant="outline" onClick={stop}><Square aria-hidden="true" />Stop</Button> :
            <Button type="submit" disabled={!canSend || !draft.trim() || incomplete}><Send aria-hidden="true" />Send</Button>}</div>
      </form>
    </DialogContent>
  </Dialog>;
}

export function mountAdminChat(options) {
  const host = document.createElement('div'); host.id = 'admin-chat-root'; (document.querySelector('.masthead') || document.body).append(host);
  const root = createRoot(host);
  return { setAuthenticated: authenticated => root.render(<ChatPanel {...options} authenticated={authenticated} />) };
}
