# LE MAMBO — Suivi vacances

Application Next.js prête pour Vercel.

## Pages
- `/` : accueil
- `/cloture` : accès Franck sans code
- `/admin` : accès Valentin avec le code `1803`

## Fonctionnement
- Franck saisit la fin de service : espèces, CB, produits manquants, commentaire.
- Date et heure automatiques.
- Franck peut aussi déclarer une remise d'espèces.
- L'admin voit les totaux : CA, CB, espèces encaissées, espèces remises, espèces disponibles.

## Variables à mettre dans Vercel
Dans Vercel > Project > Settings > Environment Variables :

```env
SUPABASE_URL=https://TON-PROJET.supabase.co
SUPABASE_SERVICE_ROLE_KEY=TA_CLE_SERVICE_ROLE_SUPABASE
ADMIN_PIN=1803
```

## Base de données Supabase
Dans Supabase > SQL Editor, colle ce SQL :

```sql
create table if not exists closings (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  employee text not null default 'Franck',
  cash numeric not null default 0,
  card numeric not null default 0,
  missing_products text,
  comment text
);

create table if not exists cash_movements (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  amount numeric not null,
  reason text,
  created_by text not null default 'Franck'
);
```

## Déploiement Vercel depuis GitHub
1. Décompresse le ZIP.
2. Envoie tous les fichiers dans ton dépôt GitHub, pas le ZIP.
3. Dans Vercel : New Project > Import Git Repository.
4. Ajoute les variables d'environnement.
5. Deploy.
