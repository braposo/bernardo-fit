import fs from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import * as store from "../lib/store.js";
import { briefFingerprint, researchFingerprint } from "../lib/generation-fingerprint.js";
import { briefInputs, normaliseBrief } from "../lib/brief.js";
import { companyResearchInput, normaliseResearch } from "../lib/research.js";
import { executeBriefWork, executeResearchWork, researchIsReusable } from "../lib/screen-work.js";
import { getActiveBrief, getActiveResearch, getScreenArtifact } from "../lib/screen-artifacts.js";

let pass=0,fail=0;
const check=(n,c,e)=>{if(c){pass++;console.log("  ok   "+n)}else{fail++;console.log("  FAIL "+n+(e!==undefined?" -> "+JSON.stringify(e).slice(0,300):""))}};
process.env.ANTHROPIC_API_KEY="test";
const requests=[];
let release=null, started=null;
global.fetch=async (_url,opts)=>{
  const body=JSON.parse(opts.body); requests.push(body);
  if(started) started();
  if(release) await release;
  const research=!!body.tools;
  return {ok:true,json:async()=>research ? {
    content:[
      {type:"web_search_tool_result",content:[{type:"web_search_result",title:"Acme newsroom",url:"https://acme.test/news",page_age:"2026-09-01",encrypted_content:"raw page body must not persist"}]},
      {type:"text",text:JSON.stringify({summary:[{text:"Acme launched X",url:"https://acme.test/news"}],signals:[],risks:[],roleContext:[],unknowns:["Hiring manager unknown"],sources:[]})}
    ],stop_reason:"end_turn",usage:{input_tokens:10,output_tokens:10,server_tool_use:{web_search_requests:1}}
  } : {
    content:[{type:"text",text:JSON.stringify({contact:"Recruiter",opening:"I build useful systems.",why:[{text:"The role connects product and engineering.",src:"posting"}],conversation:[],likelyQuestions:[{text:"How do you lead?",src:null}],gapResponses:[],greenFlags:[],redFlags:[],questionsToAsk:[{text:"How is success measured?",src:null}],companyReference:[{text:"Acme launched X",src:1}],roleReference:[],unknowns:["Salary expectation not recorded"]})}],
    stop_reason:"end_turn",usage:{input_tokens:10,output_tokens:10}
  }};
};

console.log("\n--- bounded inputs and source validation ---");
const input=companyResearchInput({company:"Acme",role:"EM",sourceUrl:"https://www.acme.test/jobs/1",notes:"private",jobDescription:"secret"});
check("research receives company identity",input.company==="Acme"&&input.domain==="acme.test");
check("research excludes personal and posting text",!("notes" in input)&&!("jobDescription" in input),input);
const norm=normaliseResearch({summary:[{text:"ok",url:"https://acme.test/a"},{text:"bad",url:"javascript:alert(1)"}],sources:[{title:"A",url:"https://acme.test/a"}]},[],input);
check("valid source gets a stable id",norm.summary[0].src===1&&norm.sources[0].id===1,norm);
check("invalid URL becomes unsupported",norm.summary[1].src===null&&norm.sources.length===1,norm);
const bin=briefInputs({role:"EM",company:"Acme",jobDescription:"JD",notes:"verbatim",questions:[],salary:"£100k"}, {pitch:"p",categories:[],differentiators:[]}, norm);
check("salary categories remain separate",bin.personalFacts.advertisedSalary==="£100k"&&bin.personalFacts.personallyExpectedSalary===""&&bin.personalFacts.previouslyDiscussedSalary==="");
const bn=normaliseBrief({why:[{text:"supported",src:1},{text:"bogus",src:99}],unknowns:[]},bin);
check("unknown source references are downgraded",bn.why[0].src===1&&bn.why[1].src===null,bn.why);

console.log("\n--- independent workers and immutable pointers ---");
const rid=await store.saveReport({job_title:"EM",company:"Acme",job_description:"JD",pitch:"p",categories:[],differentiators:[],created_at:new Date().toISOString()});
let job=await store.saveJob({company:"Acme",role:"EM",sourceUrl:"https://acme.test/jobs/1",jobDescription:"JD",fitReportId:rid,notes:"verbatim"});
const rf=researchFingerprint(job);
await store.updateJob(job.id,{researchRun:{requestId:"research01",runId:"",fingerprint:rf,status:"queued"}});
const rr=await executeResearchWork({jobId:job.id,requestId:"research01",fingerprint:rf,model:"claude-sonnet-5"});
job=await store.getJob(job.id);
const research=await getActiveResearch(job);
check("research completes and activates",rr.outcome==="completed"&&job.researchId==="research01");
check("artifact omits raw search page bodies",!JSON.stringify(research).includes("raw page body"),research);
check("research uses current web-search tool",requests[0].tools[0].type==="web_search_20260318",requests[0].tools);
check("fresh matching research is reusable",researchIsReusable(job,research));
const report=await store.getReport(rid),bf=briefFingerprint(job,report,research);
await store.updateJob(job.id,{briefRun:{requestId:"brief0001",runId:"",fingerprint:bf,status:"queued"}});
const br=await executeBriefWork({jobId:job.id,requestId:"brief0001",fingerprint:bf,model:"claude-opus-5"});
job=await store.getJob(job.id);
const active=await getActiveBrief(job);
check("brief completes and activates",br.outcome==="completed"&&job.briefId==="brief0001");
check("job keeps pointers rather than bodies",!job.summary&&!job.opening&&!!job.briefId);
check("conversation notes are preserved verbatim",active.conversation.notes==="verbatim");

console.log("\n--- late rewrite preserves the live brief ---");
const oldId=job.briefId,lateFp=briefFingerprint(job,report,research);
await store.updateJob(job.id,{briefRun:{requestId:"brief0002",runId:"",fingerprint:lateFp,status:"queued"}});
release=new Promise((r)=>{global.releaseResponse=r}); started=null;
const began=new Promise((r)=>{started=r});
const late=executeBriefWork({jobId:job.id,requestId:"brief0002",fingerprint:lateFp,model:"claude-opus-5"});
await began; await store.updateJob(job.id,{notes:"new context",briefRun:{requestId:"brief0003",runId:"",fingerprint:"new",status:"queued"}});
global.releaseResponse(); release=null; started=null;
const lateResult=await late; job=await store.getJob(job.id);
check("late rewrite is superseded",lateResult.outcome==="superseded",lateResult);
check("previous brief remains active",job.briefId===oldId,job.briefId);
check("late draft is retained by deterministic id",!!(await getScreenArtifact("brief",job.id,"brief0002")));

console.log("\n--- private page contract ---");
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const html=fs.readFileSync(path.join(root,"public/brief.html"),"utf8");
check("page refuses indexing and referrers",html.includes('name="referrer" content="no-referrer"')&&html.includes("noindex,nofollow"));
check("private sections start closed",html.includes('<details class="private">'));
check("presentation mode hides private material",html.includes(".present .private"));
check("links are restricted to http protocols",html.includes("/^https?:$/.test"));

console.log("\n=========================");
console.log("passed "+pass+", failed "+fail);
process.exit(fail?1:0);
