import React, { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import parse, { attributesToProps, domToReact, Element } from 'html-react-parser';
import { Sparkles, FileText, ExternalLink, SlidersHorizontal, ChevronDown } from 'lucide-react';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Alert } from '@/components/ui/alert';
import { Card } from '@/components/ui/card';
import { ScoreGauge } from '@/components/score-gauge';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription,
  AlertDialogFooter, AlertDialogAction, AlertDialogCancel } from '@/components/ui/alert-dialog';

// Transitional boundary: existing controllers produce escaped view templates and
// bind native events after rendering. React owns each complete view snapshot;
// controllers keep API, draft and run state. Do not reconcile a mutated snapshot.
const roots = new Map();
function disposeWithin(container) {
  for (const [node, root] of [...roots].reverse()) {
    if (node === container || container.contains(node)) {
      flushSync(() => root.unmount());
      roots.delete(node);
    }
  }
}

function EconomyCheckbox(props) {
  const [checked, setChecked] = useState(!!props.defaultChecked);
  const ref = useRef(null);
  return <Checkbox {...props} ref={node => { ref.current = node; if (node) node.checked = checked; }}
    checked={checked} onCheckedChange={value => {
      setChecked(value === true);
      ref.current.checked = value === true;
      ref.current.dispatchEvent(new Event('change', { bubbles: true }));
    }} />;
}

const tableComponents = { table: Table, thead: TableHeader, tbody: TableBody, tr: TableRow, th: TableHead, td: TableCell };
const options = {
  replace(node) {
    if (!(node instanceof Element)) return;
    const props = attributesToProps(node.attribs);
    const classes = (props.className || '').split(/\s+/);
    const has = name => classes.includes(name);
    const children = () => domToReact(node.children, options);
    if (props['data-score-gauge']) return <ScoreGauge label={props['data-score-gauge']} value={props['data-value']} weight={props['data-weight']} />;
    if (props['data-icon']) {
      const Icon = { file: FileText, external: ExternalLink, settings: SlidersHorizontal, chevron: ChevronDown }[props['data-icon']];
      return Icon ? (has("document-icon") ? <span className="document-icon"><Icon aria-hidden="true" className="ui-icon" /></span> : <Icon aria-hidden="true" className="ui-icon" />) : null;
    }
    if (has('document-versions')) return <Collapsible {...props} defaultOpen={props['data-open'] === 'true'} onOpenChange={open => document.dispatchEvent(new CustomEvent('admin:versions', { detail: { key: props['data-key'], open } }))}>{children()}</Collapsible>;
    if (has('versions-trigger')) return <CollapsibleTrigger asChild><Button {...props} variant="ghost">{children()}</Button></CollapsibleTrigger>;
    if (has('versions-content')) return <CollapsibleContent {...props} forceMount>{children()}</CollapsibleContent>;
    if (has('stage-control')) return <Popover><div {...props}>{children()}</div></Popover>;
    if (has('status-edit')) return <PopoverTrigger asChild><Button {...props} variant="ghost">{children()}</Button></PopoverTrigger>;
    if (has('stage-popover')) return <PopoverContent {...props} align="start">{children()}</PopoverContent>;
    if (has('material-row') || has('role-header')) return <Card {...props}>{children()}</Card>;
    if (has('pipeline-stage') || has('document-live')) return <Badge {...props} variant="secondary">{children()}</Badge>;
    if (node.name === 'a' && has('listing-link')) return <Button asChild variant="link"><a {...props}>{children()}</a></Button>;
    if (node.name === 'article' && has('row-item')) {
      const nav = node.children.find(child => child instanceof Element && child.attribs.role === 'tablist');
      const active = nav?.children.find(child => child instanceof Element && child.attribs['aria-selected'] === 'true');
      return <Tabs value={active?.attribs['data-section'] || 'overview'} onValueChange={section => {
        queueMicrotask(() => document.dispatchEvent(new CustomEvent('admin:section', { detail: section })));
      }} asChild><article {...props}>{children()}</article></Tabs>;
    }
    if (props.role === 'tablist') return <TabsList {...props} variant="line">{children()}</TabsList>;
    if (props.role === 'tab') {
      delete props['aria-selected'];
      return <TabsTrigger {...props} id={'tab-' + props['data-section']} aria-controls={'panel-' + props['data-section']} value={props['data-section']}>{children()}</TabsTrigger>;
    }
    if (props.role === 'tabpanel') return <TabsContent {...props} aria-labelledby={props.id.replace('panel-', 'tab-')} value={props.id.replace('panel-', '')}>{children()}</TabsContent>;
    if (node.name === 'button') {
      const variant = has('generation') ? 'generation' : has('danger') ? 'destructive' :
        has('read-link') || has('back-pipeline') ? 'link' : has('ghost') ? 'outline' :
          has('pipeline-item') || props['data-collection'] || props.id === 'usagebtn' ? 'ghost' : 'default';
      return <Button type="button" {...props} variant={variant}>
        {has('generation') ? <><Sparkles aria-hidden="true" /><span data-button-label>{children()}</span></> : children()}
      </Button>;
    }
    if (node.name === 'a' && (has('read-link') || has('primary-link'))) {
      return <Button asChild variant="link"><a {...props}>{children()}</a></Button>;
    }
    if (node.name === 'input') {
      props.defaultValue = props.value; delete props.value;
      if (props.type === 'checkbox') {
        props.defaultChecked = props.checked; delete props.checked; delete props.type;
        return <EconomyCheckbox {...props} />;
      }
      return <Input {...props} />;
    }
    if (node.name === 'textarea') return <Textarea {...props} defaultValue={node.children.map(child => child.data || '').join('')} />;
    if (node.name === 'select') {
      if (props['data-act'] === 'stage') props.onChange = event => document.dispatchEvent(new CustomEvent('admin:stage', { detail: event.target.value }));
      const selected = node.children.find(child => child instanceof Element && 'selected' in child.attribs);
      return <NativeSelect {...props} defaultValue={selected?.attribs.value}>{children()}</NativeSelect>;
    }
    if (node.name === 'option') { delete props.selected; return <NativeSelectOption {...props}>{children()}</NativeSelectOption>; }
    if (node.name === 'label') return <Label {...props}>{children()}</Label>;
    if (has('pipeline-signal') || has('vlive')) return <Badge {...props} variant="secondary">{children()}</Badge>;
    if (has('notice') || has('stalejd') || has('owed')) return <Alert {...props} role="status" variant={has('error') ? 'destructive' : 'default'}>{children()}</Alert>;
    if (has('gate')) return <Card {...props}>{children()}</Card>;
    if (node.name === 'p' && node.children.some(child => child.data === 'Loading role details…')) {
      return <div role="status"><span className="sr-only">Loading role details…</span><Skeleton className="h-6 w-2/3 mb-4" /><Skeleton className="h-24 w-full" /></div>;
    }
    const TableComponent = tableComponents[node.name];
    if (TableComponent) return <TableComponent {...props}>{children()}</TableComponent>;
  },
};

export function renderAdmin(container, markup) {
  disposeWithin(container);
  const root = createRoot(container);
  roots.set(container, root);
  flushSync(() => root.render(<>{parse(markup, options)}</>));
}

export function setButtonLabel(button, text) {
  (button.querySelector('[data-button-label]') || button).textContent = text;
}

export function showAdminError(container, message) {
  let region = container.querySelector('[data-ui-error]');
  if (!region) { region = document.createElement('div'); region.dataset.uiError = ''; container.prepend(region); }
  disposeWithin(region);
  const root = createRoot(region); roots.set(region, root);
  flushSync(() => root.render(<Alert variant="destructive" role="alert">{message}</Alert>));
}

// Radix owns modality, focus trapping, Escape, background inertness and focus
// restoration. The returned content node supports the existing async controller.
export function createAdminDialog({ title, description, className = '', content = '' }) {
  const trigger = document.activeElement;
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  let element, closed = false;
  function close() {
    if (closed) return;
    closed = true;
    disposeWithin(element);
    flushSync(() => root.unmount());
    host.remove();
    element.dispatchEvent(new Event('close'));
    if (trigger?.isConnected) trigger.focus();
  }
  flushSync(() => root.render(<Dialog open onOpenChange={open => { if (!open) queueMicrotask(close); }}>
    <DialogContent className={className} showCloseButton={false} ref={node => { if (node) element = node; }}
      onCloseAutoFocus={event => { event.preventDefault(); if (trigger?.isConnected) trigger.focus(); }}>
      <DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>{description}</DialogDescription></DialogHeader>
      {parse(content, options)}
    </DialogContent>
  </Dialog>));
  element.close = close;
  return element;
}

export function confirmAdmin({ title, description, confirmLabel = 'Continue', destructive = false, notice = false }) {
  const trigger = document.activeElement;
  return new Promise(resolve => {
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    let settled = false;
    const finish = value => {
      if (settled) return;
      settled = true;
      queueMicrotask(() => { root.unmount(); host.remove(); if (trigger?.isConnected) trigger.focus(); resolve(value); });
    };
    flushSync(() => root.render(<AlertDialog open onOpenChange={open => { if (!open) finish(false); }}>
      <AlertDialogContent onCloseAutoFocus={event => { event.preventDefault(); if (trigger?.isConnected) trigger.focus(); }}>
        <AlertDialogHeader><AlertDialogTitle>{title}</AlertDialogTitle><AlertDialogDescription>{description}</AlertDialogDescription></AlertDialogHeader>
        <AlertDialogFooter>
          {!notice && <AlertDialogCancel onClick={() => finish(false)}>Cancel</AlertDialogCancel>}
          <AlertDialogAction variant={destructive ? 'destructive' : 'default'} onClick={() => finish(true)}>{notice ? 'OK' : confirmLabel}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>));
  });
}

export function notifyAdmin(description) {
  return confirmAdmin({ title: 'Please check', description, notice: true });
}
