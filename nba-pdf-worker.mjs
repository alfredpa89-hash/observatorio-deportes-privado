import { parentPort,workerData } from 'node:worker_threads';
import { createRequire } from 'node:module';
const require=createRequire(new URL('./cloud/package.json',import.meta.url));
let parser;
try {
  const {PDFParse}=require('pdf-parse');
  parser=new PDFParse({data:new Uint8Array(workerData),isEvalSupported:false});
  const result=await parser.getText();
  if(result.total>20||result.text.length>300000) throw new Error('PDF demasiado grande');
  parentPort.postMessage({text:result.text});
} catch { parentPort.postMessage({error:true}); }
finally { if(parser) await parser.destroy(); }
