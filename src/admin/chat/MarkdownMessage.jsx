import React, { memo } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

const plugins = [remarkGfm];
const components = {
  pre: ({ children }) => <pre tabIndex={0} aria-label="Code block">{children}</pre>,
  a: ({ children, href }) => href ? <a href={href} target="_blank" rel="noopener noreferrer">{children}</a> : <span>{children}</span>,
  // Model-generated images must not make unsolicited requests to remote hosts.
  img: ({ alt }) => alt ? <span>{alt}</span> : null,
  table: ({ children }) => <div className="chat-table-scroll" role="region" aria-label="Response table" tabIndex={0}><table>{children}</table></div>,
};

export const MarkdownMessage = memo(function MarkdownMessage({ text }) {
  return <div className="chat-markdown"><Markdown remarkPlugins={plugins} components={components} skipHtml>{text}</Markdown></div>;
});
