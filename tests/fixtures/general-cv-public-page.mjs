const block = text => ({_type:'block',style:'normal',children:[{_type:'span',text,marks:[]}],markDefs:[]});

export const generalCvContent = {
  variant:'general',
  publicUrl:'https://fit.bernardoraposo.com/',
  identity:{
    name:'Alex Morgan',
    headline:'Engineering leader building dependable product platforms',
    contacts:[
      {label:'alex@example.test',href:'mailto:alex@example.test'},
      {label:'020 7946 0018',href:'tel:+442079460018'},
      {label:'Private contact',href:'javascript:alert(1)'},
    ],
    internalIdentityId:'private-identity-842',
  },
  summary:'',
  experience:[{
    title:'Engineering Manager',company:'Atlas Systems',dates:'2021–2025',location:'Remote',
    roleId:'private-role-711',evidenceIds:['private-evidence-91'],
    bullets:[
      {text:'Led a small team delivering shared platform tools for product and support teams.',evidenceIds:['private-evidence-92']},
      {text:'Set technical direction and coached engineers through project delivery.',evidenceIds:['private-evidence-93']},
    ],
    versionInstructions:'Never render this private instruction.',
  }],
  education:[{
    title:'BSc Computer Science',company:'Northbridge University',dates:'2006–2009',location:'',
    bullets:[{text:'Studied software systems and computing.'}],
  }],
  projects:[{
    title:'Open-source accessibility toolkit',company:'Community project',dates:'2024',location:'',
    bullets:[{text:'Created reusable interface checks for product teams.'}],
    sourceSnapshot:{secret:'private-source-snapshot-41'},
  }],
  skills:['Platform engineering','Team leadership'],
  validation:{status:'valid',issues:['private validation note']},
  usage:{estimatedCostMicros:777},
  sourceSnapshot:{private:'candidate profile'},
};

export const generalCvPage = {
  title:'CV',
  description:'Synthetic profile for public route verification.',
  cv:{
    name:generalCvContent.identity.name,
    headline:generalCvContent.identity.headline,
    contacts:generalCvContent.identity.contacts.slice(0,2),
    sections:[
      {label:'Experience',items:[{
        kind:'role',title:'Engineering Manager · Atlas Systems',dates:'2021–2025',location:'Remote',
        body:generalCvContent.experience[0].bullets.map(bullet=>block(bullet.text)),
      }]},
      {label:'Education',items:[{
        kind:'role',title:'BSc Computer Science · Northbridge University',dates:'2006–2009',location:'',
        body:generalCvContent.education[0].bullets.map(bullet=>block(bullet.text)),
      }]},
      {label:'Other contributions',items:[{
        kind:'role',title:'Open-source accessibility toolkit · Community project',dates:'2024',location:'',
        body:generalCvContent.projects[0].bullets.map(bullet=>block(bullet.text)),
      }]},
    ],
  },
  download:{asset:{_ref:'file-general-cv-pdf'}},
  downloadUrl:'https://cdn.sanity.io/files/quli96gc/production/synthetic-general-cv.pdf',
  generalCv:{
    pdfAssetId:'file-general-cv-pdf',
    content:{_type:'applicationCvJson',payload:JSON.stringify(generalCvContent)},
    pdfSha256:'a'.repeat(64),
    sourceFingerprint:'b'.repeat(64),
    rendererVersion:'general-a4-one-column-test',
    templateVersion:'general-cv-test',
    versionInstructions:'private metadata outside public content',
  },
};
