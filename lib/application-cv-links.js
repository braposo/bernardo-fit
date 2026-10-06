// Contribution links are published editorial data, never model-authored URLs.
export function safeApplicationCvWebHref(value) {
  if(typeof value!=='string' || /[\u0000-\u0020\u007f]/.test(value) || !/^https?:\/\//i.test(value))return '';
  try {
    const url=new URL(value);
    return !url.username && !url.password ? url.href : '';
  } catch {return '';}
}

export function publicApplicationCvLinks(links) {
  return Array.isArray(links) ? links.filter(link=>typeof link?.label==='string' && link.label.trim() && safeApplicationCvWebHref(link.href))
    .map(link=>({label:link.label.trim(),href:safeApplicationCvWebHref(link.href)})) : [];
}
