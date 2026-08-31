const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),crosswalk=fs.readFileSync(path.join(root,'docs/CREATOR-AGREEMENT-POLICY-CROSSWALK.md'),'utf8'),canon=fs.readFileSync(path.join(root,'docs/MARKETPLACE-POLICY-CANON.md'),'utf8'),inactivity=fs.readFileSync(path.join(root,'functions/_lib/product-inactivity.mjs'),'utf8');
const rows=[...crosswalk.matchAll(/^\| (\d+) \|/gm)].map(match=>Number(match[1]));assert.deepEqual(rows,Array.from({length:36},(_,index)=>index+1),'Crosswalk must audit all 36 Agreement sections exactly once.');
for(const status of ['Aligned','Legal-only','Operator procedure','Compatibility boundary','Counsel required','Implementation gap'])assert.match(crosswalk,new RegExp(status,'i'));
for(const gap of ['remediation UI','provider refund/dispute fees','fraud blocks','payout-request','audit scheduling'])assert.match(crosswalk,new RegExp(gap,'i'));
assert.match(canon,/must remain off sale for at least one full calendar month/i);assert.doesNotMatch(canon,/Exact reactivation workflow details remain unsettled/i);
assert.match(inactivity,/oneCalendarMonthAfter\(listing\.inactivity_transitioned_at\)/);assert.match(inactivity,/must remain off sale until/);
assert.match(crosswalk,/marketplace_status='approved'.*legacy internal compatibility/s);assert.doesNotMatch(crosswalk,/\bAI\b|artificial intelligence/i);
console.log('Creator Agreement policy crosswalk checks passed.');
