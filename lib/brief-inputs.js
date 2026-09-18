const clean = (v, max = 1800) => String(v || "").replace(/[\u0000-\u001f]+/g, " ").trim().slice(0, max);

function confirmed(job, pattern) {
  const q = (job.questions || []).find((x) => x.a && !x.refused && pattern.test(String(x.q || "")));
  return q ? clean(q.a, 500) : "";
}

function labelledNote(notes, label) {
  const match = String(notes || "").match(new RegExp("(?:^|\\n)\\s*(?:" + label + ")\\s*:\\s*([^\\n]+)", "i"));
  return match ? clean(match[1], 500) : "";
}

export function briefInputs(job, report, research) {
  return {
    role: clean(job.role, 200), company: clean(job.company, 200), posting: clean(job.jobDescription, 18000),
    fit: {
      pitch: clean(report?.pitch), categories: (report?.categories || []).slice(0, 8),
      differentiators: (report?.differentiators || []).slice(0, 6), closing: clean(report?.closing),
    },
    conversation: { notes: String(job.notes || "").trim(), receivedAt: job.receivedAt || "", updatedAt: job.updatedAt || "" },
    confirmedAnswers: (job.questions || []).filter((q) => q.a && !q.refused).map((q) => ({ question: clean(q.q, 500), answer: clean(q.a, 1500), answeredAt: q.answeredAt || "" })),
    personalFacts: {
      advertisedSalary: clean(job.salary, 300),
      personallyExpectedSalary: confirmed(job, /salary\s*(expectation|expected)|expected\s*salary/i),
      previouslyDiscussedSalary: labelledNote(job.notes, "previously discussed salary|discussed salary"),
      availability: "Available now", location: clean(job.location || "Harrogate", 300), locationMode: clean(job.locationMode, 200),
      noticePeriod: confirmed(job, /notice\s*period/i), startDate: confirmed(job, /start\s*date/i),
      sponsorship: "UK Settled Status; no sponsorship needed",
    },
    research,
  };
}

// Operational timestamps do not affect the model's evidence. Keep them only in the artifact.
export function briefModelInput(job, report, research) {
  const input = briefInputs(job, report, research);
  delete input.conversation.updatedAt;
  input.confirmedAnswers = input.confirmedAnswers.map(({ answeredAt, ...answer }) => answer);
  if (input.research) {
    const { kind, jobId, id, model, versionInstructions, ...evidence } = input.research;
    input.research = evidence;
  }
  return input;
}
