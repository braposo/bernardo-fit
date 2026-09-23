# Interview preparation

Use this alongside the role description, company research and Bernardo's confirmed
candidate evidence. The resources below guide answer structure; their sample
stories are not evidence about Bernardo.

## Tell me about yourself

Build a conversational opening using **Present → Past → Future → Fit**. Aim for
about 60 seconds in the phone-screen brief. Choose relevant achievements rather
than reciting the CV. Practise the sequence, rather than memorising every word.
This approach is adapted from [Resumeway](https://www.resumeway.com/blog/tell-me-about-yourself/).

Draft based on the repository's candidate profile; tailor the final two sentences
to the actual role and confirm that the career direction still reflects your aims:

> I'm an engineering manager and hands-on frontend technical leader. My work has
> covered frontend architecture, design systems and AI products, and I enjoy
> connecting engineering, design and product. At SingleStore, I hired and ran the
> Web team, with responsibility across the website, documentation, CMS and AI
> assistant. Before that, at TravelRepublic, I led a mobile-first platform shared
> across three travel brands and built its React design system and GraphQL service.
> I'm looking for a role where I can lead a team while staying close to technical
> decisions. This opportunity interests me because [specific responsibility from
> the job description], which connects with my experience in [relevant project].

## Likely questions and STAR drafts

Select questions from the actual job requirements and interview context. These
are practice predictions, not confirmed interviewer questions. For behavioural
answers, use **Situation, Task, Action, Result**, including what you learned.
Keep context brief, explain your own contribution and prepare for follow-up
questions. See the [National Careers Service](https://nationalcareers.service.gov.uk/careers-advice/interview-advice/the-star-method).

Give most of the answer to decisions, actions and outcomes. Use numbers only when
supported, and distinguish your contribution from the team's work. Practise
questions about priorities, disagreement, leadership, change and setbacks. See
[BetterUp](https://www.betterup.com/blog/star-interview-method).

The following are evidence-led starting points, **not finished accounts of events**.
Bracketed details require your input. A project appearing in the profile does not
establish its business impact, the decisions you made or a particular conflict.

### How have you built a shared platform across different needs?

- **Situation:** At TravelRepublic, the platform served TravelRepublic, Emirates
  Holidays and Dnata Travel. [Confirm the specific problem the brands faced.]
- **Task:** I led the mobile-first platform. [Confirm the goal and constraints.]
- **Action:** I built its React design system and GraphQL service. [Describe one
  architecture decision, alternatives and how you worked with the teams.]
- **Result:** [Add a verified outcome and what you learned. Do not assume faster
  delivery, adoption levels or conversion gains.]
- **Follow-up:** What did you standardise, and what remained specific to a brand?

### How do you lead a team while staying close to implementation?

- **Situation:** At SingleStore, my Web team worked across the website,
  documentation, CMS and AI assistant. [Choose one concrete delivery episode.]
- **Task:** I hired and ran the team. [State your responsibility in that episode.]
- **Action:** [Explain what you delegated, where you contributed directly and
  how you helped someone else make a decision.]
- **Result:** [Record the outcome and any change to your leadership approach.]
- **Follow-up:** How did you know your involvement was helping the team?

### Describe a disagreement about priorities or a technical direction.

Working across engineering, product, design and marketing is supported by the
profile, but no particular disagreement is documented. Select a real incident:

- **Situation:** [Who wanted what, and why did it matter?]
- **Task:** [What decision were you personally responsible for?]
- **Action:** [How did you listen, evaluate trade-offs and reach a decision?]
- **Result:** [What actually happened, including unresolved issues and learning?]
- **Follow-up:** What would the other person say about your approach?

Other useful questions: When did you change course after feedback? What failed,
and what did you change afterwards? How did you decide between competing
deadlines? Use a specific confirmed incident for each; do not turn general career
experience into an invented story.

## Include this in generated briefs

The existing document format supports this without new fields:

- `opening`: a spoken Present–Past–Future–Fit introduction.
- `likelyQuestions`: each entry contains the question, competency, answer draft
  and one follow-up; behavioural drafts use explicit STAR labels.
- `unknowns`: specific questions needed to complete missing evidence.
- `why`, `gapResponses` and `questionsToAsk`: retain their existing purpose.

The updated repository default is in `lib/sanity/analysis-defaults.js`. With
Sanity enabled, the published **Analysis settings → Interview brief prompt**
(`texts` entry keyed `brief`) remains authoritative. Append the companion
[prompt supplement](interview-preparation-prompt.txt) to that existing prompt and
replace its old “around 900 words” target with “around 1,200 words”. Keep the JSON
contract, writing-rule tokens and candidate-profile token intact. Do not replace
the full published prompt with only the supplement.

Keep confirmed personal stories in **Candidate profile → Summary for interview
preparation**, or in the relevant role notes. Candidate evidence attachments alone
do not necessarily enter the compact interview context. Clearly distinguish
unanswered story prompts from confirmed facts. Publish the settings and candidate
edits, then use **Rewrite interview brief** for each role that needs the new
preparation. Existing documents are not rewritten automatically.

The guidance links are methodology references, not company-research citations.
In generated lists, use `src: null` for personal stories and practice questions;
never assign a company research source ID as proof of a personal achievement.
