import {task} from '@trigger.dev/sdk';
import {verifySanityStorage} from '../../lib/sanity/verify-storage.js';
import {getRunReceipt} from '../../lib/run-receipts.js';

export const sanityStorageProbe = task({
  id:'sanity-storage-probe',maxDuration:180,retry:{maxAttempts:1},
  run:async(payload:{configurationOnly?:boolean;receiptRunId?:string;renderCv?:boolean}={})=>{
    const configuration={
      redis:!!process.env.KV_REST_API_URL && !!process.env.KV_REST_API_TOKEN,
      openai:!!process.env.OPENAI_API_KEY,anthropic:!!process.env.ANTHROPIC_API_KEY,
      typesafe:!!process.env.TYPESAFE_API_KEY,namespace:process.env.KV_NAMESPACE || '',
      sanity:process.env.SANITY_CONTENT_ENABLED==='1',analysis:process.env.SANITY_ANALYSIS_ENABLED==='1',
    };
    const receiptVisible=payload.receiptRunId?!!await getRunReceipt(payload.receiptRunId):undefined;
    let cv;
    if(payload.renderCv){
      const {loadApplicationCvSource}=await import('../../lib/application-cv-source.js');
      const {buildGeneralApplicationCv}=await import('../../lib/application-cv-general.js');
      const {renderApplicationCvPdf}=await import('../../lib/application-cv-render.js');
      const {GENERAL_CV_PUBLIC_URL}=await import('../../lib/general-cv-availability.js');
      const source=await loadApplicationCvSource();
      const {content}=buildGeneralApplicationCv(source,{publicUrl:GENERAL_CV_PUBLIC_URL});
      const rendered=await renderApplicationCvPdf(content,{minBodyPx:source.settings.minBodyPx});
      cv={bytes:rendered.pdfBytes.length,pdfSha256:rendered.pdfSha256,layout:rendered.layout};
    }
    return payload.configurationOnly?{configuration,receiptVisible,cv}:{...await verifySanityStorage(),configuration,receiptVisible,cv};
  },
});
