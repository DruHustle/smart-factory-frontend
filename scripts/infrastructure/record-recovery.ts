/** Owner-operated receipt import. Never mounted as a browser control. */
import { storeRecoveryEvidence } from "../../server/infrastructure/store";
import { recoveryReceipt } from "../../shared/infrastructure";
import { closeDatabase } from "../../server/db";
if(process.env.INFRASTRUCTURE_RECEIPT_WRITE_APPROVED!=="owner-verified-receipt"){
  console.error("Explicit operator intent is required to record verified recovery metadata.");
  process.exitCode=1;
}else try{
  let bytes=0,input="";
  for await(const chunk of process.stdin){bytes+=Buffer.byteLength(chunk);if(bytes>8192)throw Error("Receipt exceeds budget");input+=chunk;}
  const receipt=recoveryReceipt.parse(JSON.parse(input));
  await storeRecoveryEvidence(receipt);
  console.log(JSON.stringify({recorded:true,kind:receipt.kind,receiptId:receipt.receiptId,observedAt:receipt.observedAt,scope:receipt.scope}));
}catch{
  console.error("Recovery metadata was rejected or storage was unavailable. Sensitive input was not logged.");process.exitCode=1;
}finally{await closeDatabase();}
