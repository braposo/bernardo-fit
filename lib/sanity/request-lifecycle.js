// Seed/offline policy. Hosted workers require the published Sanity snapshot.
const retries = {maxAttempts:3,minTimeoutInMs:2000,maxTimeoutInMs:60000,factor:2,randomize:true};
export const DEFAULT_REQUEST_LIFECYCLE = {
  jev:{timeoutSeconds:30,retry:{...retries}},
  openai:{timeoutSeconds:120,retry:{...retries}},
  anthropic:{timeoutSeconds:120,retry:{...retries}},
  storage:{timeoutSeconds:10,retry:{...retries,minTimeoutInMs:1000,maxTimeoutInMs:30000}},
};
export function validateRequestLifecycle(value) {
  const fail=()=>{throw Object.assign(new Error('Publish valid request lifecycle settings in Sanity.'),{abort:true,code:'SANITY_SETTINGS_INVALID'});};
  const result={};
  for(const name of Object.keys(DEFAULT_REQUEST_LIFECYCLE)) {
    const policy=value?.[name], r=policy?.retry;
    if(!Number.isInteger(policy?.timeoutSeconds)||policy.timeoutSeconds<(name==='storage'?5:1)||policy.timeoutSeconds>240||
      !r||!Number.isInteger(r.maxAttempts)||r.maxAttempts<1||r.maxAttempts>5||
      !Number.isInteger(r.minTimeoutInMs)||r.minTimeoutInMs<100||r.minTimeoutInMs>3600000||
      !Number.isInteger(r.maxTimeoutInMs)||r.maxTimeoutInMs<r.minTimeoutInMs||r.maxTimeoutInMs>3600000||
      !Number.isFinite(r.factor)||r.factor<1||r.factor>5||typeof r.randomize!=='boolean')fail();
    result[name]={timeoutSeconds:policy.timeoutSeconds,retry:{maxAttempts:r.maxAttempts,minTimeoutInMs:r.minTimeoutInMs,
      maxTimeoutInMs:r.maxTimeoutInMs,factor:r.factor,randomize:r.randomize}};
  }
  return result;
}
