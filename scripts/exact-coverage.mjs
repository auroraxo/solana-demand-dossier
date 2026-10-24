// EXACT coverage (no sampling error):
//   P = all pointers stored in tag=2 program accounts (78,518)
//   D = all tag=3 ProgramData accounts (23,253)
//   |P ∩ D| = programs whose PD exists at head  -> answerable
//   |P \ D| = zombies: pointer to a closed PD   -> NOT answerable from head
//   |D \ P| = PDs with no program account pointing at them -> orphan question
// One getProgramAccounts for pointers only (dataSlice 4..36), one for PDs (0..4).
import { readFileSync, writeFileSync } from 'node:fs';
const RPC='https://api.mainnet-beta.solana.com';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function rpc(m,p,tries=6){
  for(let i=0;i<tries;i++){
    try{
      const r=await fetch(RPC,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:m,params:p})});
      if(r.status===429){await sleep(5000*(i+1));continue;}
      if(!r.ok)throw new Error('HTTP '+r.status);
      const j=await r.json();
      if(j.error){ if(/too many|exceed|node is behind|response|larger/i.test(j.error.message||'')){await sleep(5000*(i+1));continue;} throw new Error('rpc '+j.error.code+' '+j.error.message); }
      return j.result;
    }catch(e){ if(i===tries-1)throw e; await sleep(3500*(i+1)); }
  }
  throw new Error('retries exhausted');
}
const B58='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function b58enc(buf){let z=0;while(z<buf.length&&buf[z]===0)z++;let n=0n;for(const b of buf)n=n*256n+BigInt(b);let s='';while(n>0n){s=B58[Number(n%58n)]+s;n/=58n;}return '1'.repeat(z)+s;}
const UPGR='BPFLoaderUpgradeab1e11111111111111111111111';
const head=await rpc('getSlot',[{commitment:'finalized'}]);
console.log('head',head);
// pointers
const ptr=await rpc('getProgramAccounts',[UPGR,{commitment:'finalized',encoding:'base64',dataSlice:{offset:4,length:32},
  filters:[{memcmp:{offset:0,bytes:b58enc(Buffer.from([2,0,0,0]))}}]}]);
console.log('tag2 program accounts:',ptr.length);
const P=new Set(ptr.map(r=>b58enc(Buffer.from(r.account.data[0],'base64'))));
console.log('distinct pointers:',P.size);
// PDs
const rows=JSON.parse(readFileSync('/tmp/prov1234/population-rows.json','utf8'));
const D=new Set(rows.map(r=>r[0]));
console.log('tag3 PDs:',D.size);
let inter=0, pOnly=[];
for(const p of P){ if(D.has(p)) inter++; else pOnly.push(p); }
let dOnly=0; for(const d of D) if(!P.has(d)) dOnly++;
const rep={head,program_accounts:ptr.length,distinct_pointers:P.size,programdata_accounts:D.size,
  pointer_resolves_to_live_pd:inter, coverage_pct:+(100*inter/P.size).toFixed(2),
  zombies_pointer_to_absent_pd:pOnly.length, zombie_pct:+(100*pOnly.length/P.size).toFixed(2),
  orphan_pd_no_program_points_here:dOnly, zombie_examples:pOnly.slice(0,5), orphan_examples:[]};
// orphan examples: which PDs are pointed at by nobody? (cheap: iterate D minus P)
for(const d of D) if(!P.has(d)) { rep.orphan_examples.push(d); if(rep.orphan_examples.length>=5) break; }
writeFileSync('/tmp/prov1234/exact-coverage.json',JSON.stringify(rep,null,1));
console.log(JSON.stringify(rep,null,1));