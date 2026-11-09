import test from 'node:test';
import assert from 'node:assert/strict';
import {analyzeWithLlm,validateLlmResult} from '../services/timefit-ax/receipt-llm.mjs';
import {latestReceiptLines,loadLatestReceiptLines} from '../server/domain/receipt-latest.js';
import {receiptValidation} from '../server/domain/receipt-validation.js';
import {normalizeTimefitAxExtraction,extractReceiptWithTimefitAx} from '../server/api/_timefit-ax.js';
import {processReceiptRun} from '../server/api/receipt-process.js';

const receipt={documentType:'invoice',merchantName:'테스트 공급자',merchantBusinessNumber:null,transactionDate:'2026-10-01',transactionTime:null,totalAmount:60150,approvalNumber:null,cardLast4:null,currency:'KRW',rawText:'test',confidence:0.9,warnings:[],lineItems:[
  {name:'알감자',quantity:2,unitPrice:1800,amount:3600},
  {name:'토마토',quantity:4,unitPrice:10500,amount:42000},
  {name:'양상추',quantity:2,unitPrice:2200,amount:4400},
  {name:'적근대',quantity:0.5,unitPrice:9800,amount:4900},
  {name:'치커리',quantity:0.5,unitPrice:4500,amount:2250},
  {name:'적양파',quantity:2,unitPrice:1500,amount:3000},
]};
test('images, not OCR text, are sent with a strict schema and store disabled',async()=>{
  let request;
  const result=await analyzeWithLlm([{content:Buffer.from('image-fixture'),contentType:'image/jpeg'}],{apiKey:'test',model:'configured-model',fetchImpl:async(url,opts)=>{
    assert.equal(url,'https://api.openai.com/v1/responses');request=JSON.parse(opts.body);
    return Response.json({status:'completed',model:'actual-model',output:[{content:[{type:'output_text',text:JSON.stringify(receipt)}]}]});
  }});
  assert.equal(request.input[0].content[0].type,'input_image');
  assert.match(request.input[0].content[0].image_url,/^data:image\/jpeg;base64,/);
  assert.equal(request.store,false);assert.equal(request.text.format.strict,true);
  assert.equal(result.provider,'openai_image');assert.equal(result.model,'actual-model');
});
test('missing configuration, incomplete output, refusal and malformed schema fail closed',async()=>{
  await assert.rejects(analyzeWithLlm([],{apiKey:'',model:''}),/not_configured/);
  for(const body of [{status:'incomplete'}, {status:'completed',output:[{content:[{type:'refusal'}]}]}, {status:'completed',output:[{content:[{type:'output_text',text:'{}'}]}]}]){
    await assert.rejects(analyzeWithLlm([{content:Buffer.from('x'),contentType:'image/png'}],{apiKey:'x',model:'x',fetchImpl:async()=>Response.json(body)}),/receipt_llm/);
  }
  assert.throws(()=>validateLlmResult({...receipt,totalAmount:'60150'}),/invalid_result/);
});
test('six invoice rows preserve decimals and unknown tax does not create an error',()=>{
  const n=normalizeTimefitAxExtraction(receipt,'codex_image');const v=receiptValidation(n);
  assert.equal(v.lineItemTotal,60150);assert.equal(v.validForManagerReview,true);
  assert.equal(v.issues.some(i=>i.code==='tax_total_mismatch'),false);
  assert.equal(n.lineItems[3].quantity,0.5);
});
test('actual incident pattern is blocked; unknown values are not zero',()=>{
  const n=normalizeTimefitAxExtraction({...receipt,totalAmount:7401385,lineItems:[{name:'알감자',quantity:null,unitPrice:null,amount:3},{name:'적양파',quantity:null,unitPrice:null,amount:7}]},'codex_image');
  assert.equal(n.lineItems[0].quantity,null);
  assert.equal(receiptValidation(n).validForManagerReview,false);
});
test('reanalysis selects latest rows even when latest analysis has no items',()=>{
  const extractions=[{id:'old',document_id:'doc',created_at:'2026-10-01'},{id:'new',document_id:'doc',created_at:'2026-10-02'}];
  const lines=[{document_id:'doc',extraction_id:'old'},{document_id:'doc',extraction_id:'new'}];
  assert.deepEqual(latestReceiptLines(lines,extractions),[lines[1]]);
  assert.deepEqual(latestReceiptLines([lines[0]],extractions),[]);
});
test('DB query filters by extraction ID before loading line items',async()=>{
  const queries=[];
  const rows=await loadLatestReceiptLines('doc',async q=>{queries.push(q);return queries.length===1?[{id:'latest'}]:[{extraction_id:'latest'}];});
  assert.match(queries[0],/order=created_at.desc,id.desc&limit=1/);
  assert.match(queries[1],/extraction_id=eq.latest/);assert.equal(rows.length,1);
});
function configure(t){
  const old={...process.env};
  Object.assign(process.env,{SUPABASE_URL:'https://db.test',SUPABASE_SERVICE_ROLE_KEY:'test',TIMEFIT_AX_URL:'https://ax.test',TIMEFIT_AX_ALLOWED_HOSTS:'ax.test',TIMEFIT_AX_TRANSPORT_KEY:'a'.repeat(32)});
  t.after(()=>{for(const k of ['SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','TIMEFIT_AX_URL','TIMEFIT_AX_ALLOWED_HOSTS','TIMEFIT_AX_TRANSPORT_KEY']){if(old[k]===undefined)delete process.env[k];else process.env[k]=old[k];}});
}
test('a legacy AX result is rejected even when its status is SUCCEEDED',async t=>{
  configure(t);
  t.mock.method(globalThis,'fetch',async url=>String(url).includes('/storage/')?Response.json({signedURL:'https://images.test/a.jpg'}):Response.json({state:'SUCCEEDED',model:'google-cloud-vision-document-text-detection',extraction:receipt}));
  await assert.rejects(extractReceiptWithTimefitAx({organizationId:'org',documentId:'doc',runId:'run',storagePaths:['a.jpg']}),/image_llm_required/);
});
test('AX failure records failure without calling Vision or creating expenses',async t=>{
  configure(t);const calls=[];
  t.mock.method(globalThis,'fetch',async(url,options={})=>{
    const value=String(url);calls.push({value,options});
    if(value.startsWith('https://ax.test'))throw Error('test_ax_unavailable');
    if(!value.startsWith('https://db.test'))throw Error('unexpected_external_call');
    if(value.includes('/storage/'))return Response.json({signedURL:'https://images.test/a.jpg'});
    if(value.includes('finance_documents?')&&!options.method)return Response.json([{id:'doc',organization_id:'org',mime_type:'image/jpeg',storage_path:'a.jpg'}]);
    return Response.json([]);
  });
  await assert.rejects(processReceiptRun({organizationId:'org',documentId:'doc',runId:'run'}),/test_ax_unavailable/);
  assert.equal(calls.some(c=>c.value.includes('vision.googleapis.com')),false);
  assert.equal(calls.some(c=>c.options.method==='POST'&&c.value.endsWith('/timefit_user_expenses')),false);
  assert.ok(calls.some(c=>c.options.method==='PATCH'&&c.options.body.includes('"status":"failed"')));
});
