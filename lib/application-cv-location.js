// A CV location may carry "Place | Kind of business"; each part sits on its own line.
export const applicationCvLocationLines=location=>String(location ?? '').split('|').map(part=>part.replace(/\s+/g,' ').trim()).filter(Boolean);
