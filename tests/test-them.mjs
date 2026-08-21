process.env.ANTHROPIC_API_KEY = "sk-fake";
// Paths are derived rather than hard-coded so the suite runs from a clone.
import { fileURLToPath } from "node:url";
import path from "node:path";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..").replace(/\\/g, "/") + "/";
const base = "file:///" + root + "api/";

const { buildCoverPrompt } = await import(base + "_cover.js");

let pass = 0, fail = 0;
const check = (n, c, e) => {
  if (c) { pass++; console.log("  ok   " + n); }
  else { fail++; console.log("  FAIL " + n + (e !== undefined ? "  -> " + JSON.stringify(e).slice(0, 200) : "")); }
};

const p = buildCoverPrompt({ report: { job_description: "x" }, fitUrl: "https://x" });

console.log("\n--- the shape leads with them ---");
check("lead opens on their goal", p.includes("Lead: what they are setting out to do"));
check("evidence carries its consequence in the same paragraph", p.includes("in the same paragraph what it means for their situation"));
check("the two separate evidence paragraphs are gone", !p.includes("a second, different piece of evidence"));
check("the picture has a slot", p.includes("the picture of the job actually being done"));
check("the risk paragraph survives", p.includes("the risk I can see in their situation"));
check("the honest gap survives", p.includes("the honest gap, named plainly"));
check("AI still closes it", p.indexOf("forward-looking thought about AI") < p.indexOf("Close: the fit-analysis link"));

console.log("\n--- and the ordering is right ---");
const order = ["Lead: what they are setting out to do", "the strongest piece of evidence", "the picture of the job actually being done", "the risk I can see", "the honest gap", "forward-looking thought about AI", "Close: the fit-analysis link"];
let ok = true;
for (let i = 1; i < order.length; i++) if (p.indexOf(order[i]) < p.indexOf(order[i - 1])) ok = false;
check("beats run in order", ok);

console.log("\n--- the coupling rule ---");
check("section exists", p.includes("## The letter is about them, not about me"));
check("names the CV-in-prose failure", p.includes("a CV in prose"));
check("states the test", p.includes("Does this paragraph tell them something about their own situation?"));
check("gives a worked before and after", p.includes("That is a fact about me, and it just sits there"));
check("sets the proportion", p.includes("More of the letter should be about their business than about my career"));
check("one example beats two", p.includes("beats two examples left to speak for themselves"));

console.log("\n--- the picture, with its guards ---");
check("section exists", p.includes("## The picture: what it looks like if I join"));
check("is one paragraph", p.includes("One paragraph, and the reason the letter is worth reading"));
check("grounded in the posting", p.includes("the teams they name, the problem they admit to"));
check("hypothesis, not plan", p.includes("It is a hypothesis, not a plan"));
check("bans knowing what is broken", p.includes("Never write as though I already know what is broken"));
check("bans outcome promises", p.includes("No promises about outcomes"));
check("names the specific ones", p.includes("not higher velocity, not unlocked potential"));
check("thin posting has a fallback", p.includes("write about what I would need to find out"));

console.log("\n--- nothing good was lost ---");
check("still bans CV restatement", p.includes("Do not restate my CV in prose"));
check("still has the different-company test", p.includes("Could this paragraph be pasted, unchanged, into a letter to a different company?"));
check("still bans counting my experience", p.includes("Never count my own experience"));
check("length is still hard", p.includes("words MAXIMUM across every paragraph combined"));
check("still 5 to 7 paragraphs", p.includes("5 to 7 paragraphs"));

console.log("\n--- the gap example no longer counts teams ---");
check("old count gone", !p.includes("I have led one team rather than several"));
check("replaced with a relative framing", p.includes("a team inside a larger org rather than an org of teams"));

console.log("\n=========================");
console.log("passed " + pass + ", failed " + fail);
process.exit(fail ? 1 : 0);
