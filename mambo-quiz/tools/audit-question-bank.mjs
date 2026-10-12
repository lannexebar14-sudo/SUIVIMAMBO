/** BUZZQUIZ: vérification structurelle et dédoublonnage avant import.
 * node mambo-quiz/tools/audit-question-bank.mjs questions.json
 * Ne certifie pas la véracité des réponses.
 */
import fs from 'node:fs';
const file=process.argv[2];
if(!file){console.error('Usage: node audit-question-bank.mjs questions.json');process.exit(2)}
const qs=JSON.parse(fs.readFileSync(file,'utf8'));
const norm=s=>String(s||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('fr').replace(/\s+/g,' ').trim();
const byCat={},seenQ=new Set(),seenFacts=new Set(),issues=[];
for(let i=0;i<qs.length;i++){
 const q=qs[i],p='ligne '+(i+1);
 byCat[q.category]=(byCat[q.category]||0)+1;
 if(!q.question||!q.category)issues.push(p+': question/catégorie absente');
 if(!Array.isArray(q.choices)||q.choices.length!==4||new Set(q.choices.map(norm)).size!==4)issues.push(p+': choix invalides');
 if(!Number.isInteger(q.correctIndex)||q.correctIndex<0||q.correctIndex>3)issues.push(p+': bonne réponse invalide');
 const key=norm(q.category)+'|'+norm(q.question);
 if(seenQ.has(key))issues.push(p+': énoncé répété');seenQ.add(key);
 if(q.factKey){const fk=norm(q.category)+'|'+q.factKey;if(seenFacts.has(fk))issues.push(p+': même fait répété');seenFacts.add(fk)}
 if(q.reviewStatus!=='verifie')issues.push(p+': validation factuelle requise');
}
console.log(JSON.stringify({total:qs.length,byCategory:byCat,issues:issues.slice(0,100),issueCount:issues.length,ready:issues.length===0},null,2));
if(issues.length)process.exitCode=1;
