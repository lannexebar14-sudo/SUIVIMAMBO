/**
 * BUZZQUIZ — validation de lots de questions avant import.
 * Usage: node mambo-quiz/tools/validate-questions.mjs fichier.json
 * Chaque question: {id, category, question, choices:[4], correctIndex:0..3,
 * difficulty:"facile"|"moyen"|"difficile", sourceUrl, verifiedAt}
 * Ne certifie PAS la véracité des réponses : une revue éditoriale reste requise.
 */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const CATEGORIES = [
  'Musique','Culture G','APÉRO','CINÉMA & SÉRIES','TÉLÉ',
  'ANNÉES 80/90/2000','INTERNET','JEUX VIDÉO','FOOD','PEOPLE',
  'FRANCE','MONDE DE LA NUIT','MARQUES','QUI A DIT ÇA ?',
  'DEVINE LE FILM/LA SÉRIE','WTF/INSOLITE','ACTUALITÉ POP CULTURE',
  'LE MAMBO'
];
const normalize = s => String(s).normalize('NFKC').trim().replace(/\s+/g,' ').toLocaleLowerCase('fr');
export function validateQuestions(questions,{minimumPerCategory=2000}={}) {
  const errors=[], counts=Object.fromEntries(CATEGORIES.map(c=>[c,0])), seen=new Set();
  if(!Array.isArray(questions)) return {valid:false,errors:['Le fichier doit contenir un tableau JSON'],counts};
  questions.forEach((q,i)=>{
    const p='Question '+(i+1);
    if(!q || typeof q!=='object'){errors.push(p+': objet invalide');return;}
    if(!CATEGORIES.includes(q.category)) errors.push(p+': catégorie inconnue');
    else counts[q.category]++;
    if(typeof q.question!=='string'||q.question.trim().length<12) errors.push(p+': énoncé trop court');
    if(!Array.isArray(q.choices)||q.choices.length!==4||q.choices.some(x=>typeof x!=='string'||!x.trim())) errors.push(p+': exactement 4 réponses non vides requises');
    else if(new Set(q.choices.map(normalize)).size!==4) errors.push(p+': propositions identiques');
    if(!Number.isInteger(q.correctIndex)||q.correctIndex<0||q.correctIndex>3) errors.push(p+': correctIndex invalide');
    if(!['facile','moyen','difficile'].includes(q.difficulty)) errors.push(p+': difficulté invalide');
    if(typeof q.sourceUrl!=='string'||!/^https:\/\//.test(q.sourceUrl)) errors.push(p+': source HTTPS manquante');
    if(typeof q.verifiedAt!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(q.verifiedAt)) errors.push(p+': date de vérification manquante');
    const key=normalize(q.category)+'|'+normalize(q.question);
    if(seen.has(key)) errors.push(p+': doublon');
    seen.add(key);
  });
  const shortages=Object.entries(counts).filter(([,n])=>n<minimumPerCategory).map(([category,count])=>({category,count,missing:minimumPerCategory-count}));
  return {valid:errors.length===0&&shortages.length===0,errors,counts,shortages,total:questions.length};
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href){
  try{
    const file=process.argv[2];if(!file)throw new Error('Indiquer un fichier JSON');
    const result=validateQuestions(JSON.parse(readFileSync(file,'utf8')));
    console.log(JSON.stringify(result,null,2));if(!result.valid)process.exitCode=1;
  }catch(e){console.error(e.message);process.exitCode=1;}
}
