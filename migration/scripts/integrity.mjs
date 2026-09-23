import {createHash} from 'node:crypto';
const stable = value => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value;
export const payload = doc => Object.fromEntries(Object.entries(doc).filter(([key]) => !['_rev', '_createdAt', '_updatedAt'].includes(key)));
export function digest(doc) {
  const copy = structuredClone(payload(doc));
  if (copy.migration) delete copy.migration.importHash;
  return createHash('sha256').update(JSON.stringify(stable(copy))).digest('hex');
}
export function assertUnedited(current, intended) {
  if (!current) return;
  if (current.migration?.sourceKey !== intended.migration?.sourceKey || current.migration?.importHash !== digest(current)) {
    throw new Error(`Destination changed outside importer: ${intended.migration?.sourceKey}. No overwrite allowed.`);
  }
}
