// Public CV contact links have a narrower policy than general page links.
// Phone links use the international E.164 form so the rendered label can be
// editorially formatted without letting arbitrary URI parameters through.
export function safeApplicationCvContactHref(value) {
  if(typeof value!=='string' || !value || /[\u0000-\u0020\u007f]/.test(value))return '';
  if(/^tel:/i.test(value))return /^tel:\+[1-9]\d{6,14}$/i.test(value)?`tel:${value.slice(4)}`:'';
  if(/^mailto:/i.test(value))return /^mailto:[^@/?#<>]+@[^@/?#<>]+\.[^@/?#<>]+$/i.test(value)?`mailto:${value.slice(7)}`:'';
  if(!/^https?:\/\//i.test(value))return '';
  try{
    const url=new URL(value);
    return ['https:','http:'].includes(url.protocol) && !url.username && !url.password?url.href:'';
  }catch{return '';}
}
