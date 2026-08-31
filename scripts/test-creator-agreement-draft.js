const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const file=path.resolve(__dirname,'../docs/CREATOR-AGREEMENT-BUSINESS-DRAFT.md'),text=fs.readFileSync(file,'utf8'),headings=[...text.matchAll(/^## (\d+)\. (.+)$/gm)];
assert.equal(headings.length,36,'Agreement must contain 36 numbered substantive sections.');
assert.deepEqual(headings.map(match=>Number(match[1])),Array.from({length:36},(_,index)=>index+1),'Agreement sections must be sequential.');
for(const phrase of ['Business draft for counsel review','not final legal advice','expressly nonexclusive','first 30 days','Creator receives 90%','Standard Creator receives 80%','$20 per month','$200 prepaid','20 active products','22 active products','one full calendar month','Pay What You Want','verified email','Duplicate digital purchase prevention','30 days to submit an acceptable correction','ordinary payment fraud','negative balance','ordinary minimum withdrawal is $10','entire remaining positive eligible balance','Attorney review required'])assert.match(text,new RegExp(escape(phrase),'i'),`Missing agreement term: ${phrase}`);
assert.match(text,/provides a 30-day warning and grace period/i);
assert.match(text,/If no qualifying activity is recorded by the end of the 30-day period, Tobacco Road Games will delist the product/i);
assert.match(text,/customer may not purchase it again through the ordinary digital purchase flow/i);
assert.match(text,/customer who elected to wait will be refunded/i);
assert.doesNotMatch(text,/substantial unresolved (negative )?balance/i);
assert.match(text,/operational audit on a six-month cycle/i);
for(const subject of ['worldwide scope','unresolved negative balance','entitlement preservation','post-termination operational license'])assert.match(text,new RegExp(`Attorney review required:[\\s\\S]{0,300}${escape(subject)}`,'i'),`Missing counsel flag: ${subject}`);
const quote='“If someone wants to sell a perfectly legal RPG supplement encoded in semaphore, smoke signals, Morse code, interpretive dance, or a stack of punched cards, that is their problem to market and the buyer’s problem to understand.”';assert.ok(text.includes(quote),'Marketplace philosophy quote must remain exact.');assert.match(text,/— RV Sawyer/);assert.match(text,/Agreement ID:.*trg-creator-marketplace-agreement/);assert.match(text,/Agreement version:.*2026-08-27/);assert.doesNotMatch(text,/\bTRG\b/,'Use the full company name in the agreement.');assert.doesNotMatch(text,/\bAI\b|artificial intelligence/i,'Do not add an AI-specific provision.');console.log('Creator Agreement draft checks passed.');
function escape(value){return value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');}
