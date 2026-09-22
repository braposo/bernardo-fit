import groq from "groq";

export const CONTENT_COUNTS_QUERY = groq`{
  "analysisSettings": count(*[_type == "analysisSettings"]),
  "candidateProfile": count(*[_type == "candidateProfile"]),
  "candidateEvidence": count(*[_type == "candidateEvidence"]),
  "job": count(*[_type == "job"]),
  "applicationQuestion": count(*[_type == "applicationQuestion"]),
  "fitReport": count(*[_type == "fitReport"]),
  "coverLetter": count(*[_type == "coverLetter"]),
  "companyResearch": count(*[_type == "companyResearch"]),
  "interviewBrief": count(*[_type == "interviewBrief"]),
  "fitAssessment": count(*[_type == "fitAssessment"]),
  "sitePage": count(*[_type == "sitePage"]),
  "writingGuidance": count(*[_type == "writingGuidance"])
}`;

export const CANDIDATE_QUERY = groq`*[_type == "candidateProfile" && _id == $id][0]{
  _id, _rev, name, headline, summary, motivationSummary, interviewSummary,
  location, availability, workEligibility, noticePeriod, careerDirection,
  workingPreferences, salaryPreferences, constraints, confirmedAnswers, reviewedAt,
  evidence[]->{_id, _rev, title, kind, organisation, period, body, sources, reviewedAt}
}`;

export const JOB_CONTENT_QUERY = groq`*[_type == "job" && _id == $id][0]{
  ...,
  candidate->{_id, name}, activeReport->, activeCoverLetter->, activeResearch->,
  activeBrief->, activeAssessment->,
  "questions": *[_type == "applicationQuestion" && job._ref == ^._id] | order(order asc, _createdAt asc),
  "reportVersions": *[_type == "fitReport" && legacyId == ^.activeReport->.legacyId && !defined(deletedAt) && pending != true] | order(generatedAt desc){_id, versionId, generatedAt, model, active},
  "coverVersions": *[_type == "coverLetter" && job._ref == ^._id] | order(generatedAt desc){_id, versionId, generatedAt, model},
  "researchVersions": *[_type == "companyResearch" && job._ref == ^._id] | order(generatedAt desc){_id, versionId, generatedAt, model},
  "briefVersions": *[_type == "interviewBrief" && job._ref == ^._id] | order(generatedAt desc){_id, versionId, generatedAt, model}
}`;

// Type is constrained by the server allowlist; all values are bound parameters.
export const CONTENT_LIST_QUERY = groq`*[_type == $type] | order(_updatedAt desc, _id asc)[$start...$end]{
  _id, _type, _rev, _updatedAt, title, name, role, company, question, headline, stage,
  "slug": slug.current
}`;

export const CONTENT_DOCUMENT_QUERY = groq`*[_type == $type && _id == $id][0]`;
