// join-fix.mjs — rerun the join WITHOUT the 36-byte guard: odd state=2 accounts
// are included (pointer still at [4:36]). Prediction from odd-probe: 0 orphans,
// matchedPrograms 23252 -> 23257, matching the 13:19Z "0 orphan PD" claim.
import fs from 'node:fs';
const RPC = 'https://api.mainnet-beta.solana.com';
const LOADER = 'BPFLoaderUpgradeab1e11111111111111111111111';
const b58chars='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function b58enc(buf){let d=[0];for(const byte of buf){let c=byte;for(let j=0;j<d.length;j++){c+=d[j]<<8;d[j]=c%58;c=(c/58)|0}while(c){d.push(c%58);c=(c/58)|0}}let o='';for(const byte of buf){if(byte!==0)break;o+='1'}for(let i=d.length-1;i>=0;i--)o+=b58chars[d[i]];return o}
const tagB58=(n)=>b58enc(Buffer.from([n,0,0,0]));
let calls=0;
async function rpc(m,p){for(let a=0;a<10;a++){calls++;try{const r=await fetch(RPC,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:m,params:p})});const j=JSON.parse(await r.text());if(j.error&&j.error.code===429){await new Promise(z=>setTimeout(z,5000*(a+1)));continue}if(j.error)throw new Error(m+': '+JSON.stringify(j.error));return j.result}catch(e){if(e instanceof Error&&e.message.startsWith(m+':'))throw e;await new Promise(z=>setTimeout(z,4000*(a+1)))}}throw new Error(m+' network exhausted')}
const progs = await rpc('getProgramAccounts',[LOADER,{encoding:'base64',dataSlice:{offset:0,length:4},filters:[{memcmp:{offset:0,bytes:tagB58(2)}}]}]);
const pkeys = progs.map(r=>r.pubkey);
const pdRows = await rpc('getProgramAccounts',[LOADER,{encoding:'base64',dataSlice:{offset:0,length:4},filters:[{memcmp:{offset:0,bytes:tagB58(3)}}]}]);
const pd = new Set(pdRows.map(r=>r.pubkey));
const ptrBy = new Map();
for (let i=0;i<pkeys.length;i+=100){
  const res = await rpc('getMultipleAccounts',[pkeys.slice(i,i+100),{encoding:'base64'}]);
  pkeys.slice(i,i+100).forEach((pk,k)=>{ const a=res.value[k]; if(!a) throw new Error('missing program '+pk);
    const d=Buffer.from(a.data[0],'base64');
    if (d.length < 36) throw new Error(`short program ${pk} len=${d.length}`); // guard stays, but only for <36
    ptrBy.set(pk, b58enc(d.subarray(4,36))); });
  if (i % 20000 === 0) process.stdout.write('.'+i);
}
const pointers = new Set([...ptrBy.values()]);
const matched = [...ptrBy.values()].filter(x=>pd.has(x)).length;
const orphans = [...pd].filter(x=>!pointers.has(x));
console.log('\nprograms',pkeys.length,'PD',pd.size,'matched',matched,'orphans',orphans.length, orphans.slice(0,5));
console.log('ratio', (100*matched/pkeys.length).toFixed(2)+'%');
fs.writeFileSync('/tmp/pop1408/join-fixed.json', JSON.stringify({at:new Date().toISOString(),programs:pkeys.length,pd:pd.size,matched,orphans:orphans.length,ratio:matched/pkeys.length,calls},null,2));
