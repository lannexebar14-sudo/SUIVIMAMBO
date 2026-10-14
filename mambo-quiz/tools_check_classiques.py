import json,collections,re,unicodedata
from pathlib import Path
p=Path(__file__).parent
rows=json.load(open(p/'data/questions-classiques-200-20261014.json'))
def norm(s):return re.sub('[^a-z0-9]','',unicodedata.normalize('NFKD',s.lower()).encode('ascii','ignore').decode())
assert len(rows)==985
assert len({norm(x['question']) for x in rows})==985
for x in rows:
 assert len(x['answers'])==4 and len(set(x['answers']))==4
 assert 0<=x['correct_index']<4
 assert x['correct_indices']==[x['correct_index']]
 assert x['active'] and not x['is_bonus']
 assert len(x['question'])<300 and all(len(a)<160 for a in x['answers'])
 assert '<sup>' not in x['question']
print('Validé : 985 questions, 4 réponses distinctes et indices corrects.')
print(dict(collections.Counter(x['category'] for x in rows)))
