import { DEFAULT_LINKEDIN_SETTINGS, validateLinkedInSettings } from './linkedin-settings.js';

export function linkedinV2MigrationFields(document) {
  if (!document || document._id !== 'fit-analysis-settings' || !document._rev)
    throw new Error('Published Analysis settings and its revision are required.');
  const current = document.linkedinScreening;
  if (!current) throw new Error('Published LinkedIn screening settings are missing. Seed v1 first.');
  const validated = validateLinkedInSettings(current);
  if (validated.policyVersion === 2) return validated.maxSearchResults === undefined
    ? { 'linkedinScreening.maxSearchResults': DEFAULT_LINKEDIN_SETTINGS.maxSearchResults }
    : null;
  const next = DEFAULT_LINKEDIN_SETTINGS;
  return {
    'linkedinScreening.policyVersion': 2,
    'linkedinScreening.enabled': false,
    'linkedinScreening.searches': structuredClone(next.searches),
    'linkedinScreening.searchPageSize': next.searchPageSize,
    'linkedinScreening.maxSearchPages': next.maxSearchPages,
    'linkedinScreening.maxSearchResults': next.maxSearchResults,
    'linkedinScreening.relevanceProbability': next.relevanceProbability,
    'linkedinScreening.instructions': next.instructions,
    'linkedinScreening.investigateCriteria': next.investigateCriteria,
    'linkedinScreening.mismatchCriteria': next.mismatchCriteria,
  };
}
