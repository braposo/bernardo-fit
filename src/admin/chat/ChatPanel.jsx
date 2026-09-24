import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MessageCircle, Send, Square, Plus } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Textarea } from '../components/ui/textarea';
import { Dialog, DialogContent, DialogTitle, DialogDescription, DialogTrigger } from '../components/ui/dialog';
import { Message, MessageContent, MessageHeader } from '../components/ui/message';
import { Bubble, BubbleContent } from '../components/ui/bubble';
import { MessageScrollerProvider, MessageScroller, MessageScrollerViewport, MessageScrollerContent,
  MessageScrollerItem, MessageScrollerButton } from '../components/ui/message-scroller';
import { readChatStream, historyForTurns } from './stream';
import { MarkdownMessage } from './MarkdownMessage';

function ChatPanel({ authenticated, getSecret, onUnauthorized }) {
  const [open, setOpen] = useState(false), [config, setConfig] = useState(null), [configError, setConfigError] = useState('');
  const [turns, setTurns] = useState([]), [draft, setDraft] = useState(''), [error, setError] = useState('');
  const [busy, setBusy] = useState(false), [phase, setPhase] = useState('');
  const active = useRef(null), conversation = useRef(null), composer = useRef(null), generation = useRef(0);
  const headers = () => ({ 'x-admin-secret': getSecret(), 'Content-Type': 'application/json' });
  useEffect(() => {
    if (!authenticated) {
      generation.current++; active.current?.abort(); active.current = null;
      setOpen(false); setTurns([]); setDraft(''); setConfig(null); setBusy(false); setError(''); conversation.current = null;
    }
  }, [authenticated]);
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
  const canSend = config?.enabled && config.contextConfigured && hasProvider && config.autoAvailable;
  const updateTurn = turn => setTurns(previous => previous.map(item => item.id === turn.id ? { ...turn } : item));
  async function send(question, retry = false) {
    if (active.current || !canSend || !question.trim()) return;
    const previous = retry ? turns.slice(0, -1) : turns;
    let messages;
    try { messages = historyForTurns(previous, question.trim()); } catch (e) { setError(e.message); return; }
    const controller = new AbortController(), epoch = ++generation.current;
    active.current = controller;
    conversation.current ||= crypto.randomUUID();
    const turn = { id: crypto.randomUUID(), question: question.trim(), text: '', sources: [], status: 'running' };
    setTurns([...previous, turn]); if (!retry) setDraft(''); setError(''); setBusy(true); setPhase('Connecting…');
    let frame;
    const flush = () => { frame = undefined; if (generation.current === epoch) updateTurn(turn); };
    try {
      const response = await fetch('/api/admin/chat', { method: 'POST', headers: headers(), signal: controller.signal,
        body: JSON.stringify({ messages, provider: 'auto', model: 'auto', conversationId: conversation.current }) });
      if (response.status === 401) { onUnauthorized(); return; }
      await readChatStream(response, (event, value) => {
        if (generation.current !== epoch) return;
        if (event === 'route') setPhase('Thinking…');
        if (event === 'text' && typeof value.text === 'string') { turn.text += value.text; setPhase('Writing…'); }
        if (event === 'activity') setPhase(value.state === 'query-failed' ? 'Checking another source…' : 'Reading content…');
        if (event === 'sources' && Array.isArray(value.sources)) turn.sources = value.sources.filter(s => typeof s?.id === 'string' && typeof s.title === 'string');
        if (event === 'persistence') turn.storage = value.state;
        if (event === 'done') turn.status = value.truncated ? 'truncated' : 'complete';
        if (!frame) frame = requestAnimationFrame(flush);
      });
      if (!turn.text.trim()) throw new Error('The response contained no text. Please retry.');
    } catch (e) {
      if (generation.current !== epoch) return;
      turn.status = controller.signal.aborted ? 'stopped' : 'failed';
      if (!controller.signal.aborted) turn.error = e.code === 'CHAT_ROUTER_UNAVAILABLE' ? 'Chat is temporarily unavailable. Please retry.' : e.message;
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
    !hasProvider || !config.autoAvailable ? 'Chat is temporarily unavailable. Please try again later.' : '');
  if (!authenticated) return null;
  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger asChild><Button className="admin-chat-launcher" variant="secondary"><MessageCircle aria-hidden="true" />Chat</Button></DialogTrigger>
    <DialogContent className="admin-chat-panel" onOpenAutoFocus={e => { e.preventDefault(); composer.current?.focus(); }}>
      <header className="chat-heading"><div><DialogTitle>Chat with your content</DialogTitle>
        <DialogDescription>Explore your experience, roles and application materials.</DialogDescription></div>
        <Button variant="ghost" onClick={newChat} disabled={busy || !turns.length} aria-label="Start a new chat"><Plus aria-hidden="true" />New chat</Button></header>
      <MessageScrollerProvider key={conversation.current || 'empty'} defaultScrollPosition="end">
        <MessageScroller className="chat-scroll">
          <MessageScrollerViewport aria-label="Chat messages"><MessageScrollerContent className="chat-messages" aria-live="off">
            {!turns.length && <div className="chat-empty"><MessageCircle size={28} aria-hidden="true" /><h3>What would you like to explore?</h3><p>Ask about your strongest evidence, compare roles, or work through an application.</p>
              <Button variant="outline" onClick={() => { setDraft('Which roles best match my experience?'); composer.current?.focus(); }}>Compare my roles</Button></div>}
            {turns.map(turn => <MessageScrollerItem key={turn.id} messageId={turn.id}>
              <Message align="end"><MessageContent><MessageHeader>You</MessageHeader><Bubble variant="secondary"><BubbleContent className="chat-text">{turn.question}</BubbleContent></Bubble></MessageContent></Message>
              <Message className="chat-answer"><MessageContent><MessageHeader>Assistant</MessageHeader>
                <Bubble variant="ghost"><BubbleContent>{turn.text ? <MarkdownMessage text={turn.text} /> : (turn.status === 'running' ? 'Working on your question…' : 'No response received.')}</BubbleContent></Bubble>
                {turn.sources.length > 0 && <details className="chat-sources"><summary>Sources consulted ({turn.sources.length})</summary><ul>{turn.sources.map(source => <li key={source.id}>{source.type === 'job' && typeof source.jobId === 'string' ?
                  <a href={`/admin?job=${encodeURIComponent(source.jobId)}&section=overview`} onClick={event => {
                    if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
                    event.preventDefault();
                    const url = new URL(window.location.href); url.searchParams.set('job', source.jobId); url.searchParams.set('section', 'overview');
                    window.history.pushState({}, '', url); window.dispatchEvent(new PopStateEvent('popstate')); setOpen(false);
                  }}>{source.title}</a> : source.title}</li>)}</ul></details>}
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
        <div className="chat-status" role="status">{busy ? phase : configError || unavailable || (!config ? 'Loading chat settings…' : last?.status === 'complete' ? 'Response complete.' : '')}</div>
        {error && <p className="chat-error" role="alert">{error}</p>}
        {!busy && incomplete && <div className="chat-retry"><span>Retry this question or start a new chat to continue.</span><Button type="button" variant="outline" disabled={!canSend} onClick={() => send(last.question, true)}>Retry</Button></div>}
        <label className="sr-only" htmlFor="chat-question">Message</label>
        <Textarea id="chat-question" ref={composer} value={draft} maxLength={12000} placeholder="Ask about your content…" rows={2}
          onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); if (!busy && !incomplete) send(draft); } }} />
        <div className="chat-composer-footer"><p>{config?.insightsEnabled ? 'Conversations are saved privately for Insights.' : 'Conversation stays in this session.'} Answers don’t change your content.</p>
          {busy ? <Button type="button" variant="outline" onClick={() => active.current?.abort()}><Square aria-hidden="true" />Stop</Button> :
            <Button type="submit" disabled={!canSend || !draft.trim() || incomplete}><Send aria-hidden="true" />Send</Button>}</div>
      </form>
    </DialogContent>
  </Dialog>;
}

export function mountAdminChat(options) {
  const host = document.createElement('div'); host.id = 'admin-chat-root'; document.body.append(host);
  const root = createRoot(host);
  return { setAuthenticated: authenticated => root.render(<ChatPanel {...options} authenticated={authenticated} />) };
}
