const Arrow = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
);
const Pin = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z" /><circle cx="12" cy="10" r="2.5" /></svg>
);
const Clock = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
);

export default function Home() {
  return (
    <main>
      <header className="topbar">
        <a className="brand" href="#top" aria-label="LE MAMBO accueil">
          <span className="brand-mark">M</span>
          <span><strong>LE MAMBO</strong><small>ORIGINAL NIGHT BAR</small></span>
        </a>
        <nav aria-label="Navigation principale"><a href="#experience">Le Mambo</a><a href="#events">Événements</a><a href="#infos">Infos</a></nav>
        <a className="nav-cta" href="#events">Voir les soirées</a>
      </header>

      <section className="hero" id="top">
        <div className="hero-grid" /><div className="orb orb-one" /><div className="orb orb-two" />
        <div className="hero-copy">
          <div className="eyebrow"><span /> CONDÉ-EN-NORMANDIE · BAR DE NUIT</div>
          <h1>La nuit commence<br /><em>au Mambo.</em></h1>
          <p className="hero-lead">Un lieu vivant, des soirées qui changent, des animations qui surprennent et une ambiance pensée pour sortir autrement.</p>
          <div className="hero-actions"><a className="button primary" href="#events">Découvrir la programmation <Arrow /></a><a className="button ghost" href="#infos">Infos pratiques</a></div>
          <div className="hero-meta">
            <div><Clock /><span><b>Vendredi & samedi</b><small>18h — 01h</small></span></div>
            <div><Pin /><span><b>Place du Marché</b><small>Condé-en-Normandie</small></span></div>
          </div>
        </div>
        <div className="hero-visual" aria-hidden="true"><div className="visual-noise" /><div className="visual-stamp">ORIGINAL<br />NIGHT BAR</div><div className="big-m">M</div><div className="visual-bottom"><span>VIBREZ<br />AUTREMENT</span><i>14</i></div></div>
      </section>

      <section className="ticker"><div><span>COCKTAILS</span><i>✦</i><span>DJ SETS</span><i>✦</i><span>SHOOTERS</span><i>✦</i><span>SOIRÉES À THÈME</span><i>✦</i><span>ANIMATIONS</span><i>✦</i><span>ORIGINAL NIGHT BAR</span></div></section>

      <section className="section experience" id="experience">
        <div className="section-heading"><span className="kicker">01 — L’EXPÉRIENCE</span><h2>Pas juste un verre.<br /><em>Une vraie soirée.</em></h2><p>LE MAMBO mélange bar de nuit, animations et programmation musicale dans un format convivial au cœur de Condé-en-Normandie.</p></div>
        <div className="feature-grid">
          <article className="feature-card large"><span className="card-index">01</span><div className="feature-icon">♫</div><h3>Une ambiance qui change</h3><p>Rap, Shatta, années 80/90/2000, soirées estivales et concepts maison : chaque date a sa propre identité.</p><div className="card-line" /></article>
          <article className="feature-card"><span className="card-index">02</span><div className="feature-icon">↻</div><h3>Des animations</h3><p>Roue du Mambo, défis, jeux, lots et surprises rythment les soirées.</p><div className="card-line" /></article>
          <article className="feature-card red-card"><span className="card-index">03</span><div className="feature-icon">★</div><h3>Un bar vivant</h3><p>Une équipe proche de ses clients, une terrasse et une atmosphère sans chichi.</p><div className="card-line" /></article>
        </div>
      </section>

      <section className="section events" id="events">
        <div className="events-head"><div><span className="kicker">02 — AU PROGRAMME</span><h2>Ce week-end<br /><em>au Mambo.</em></h2></div><p>Deux ambiances, deux soirées. Retrouve les annonces et offres du moment directement sur nos réseaux sociaux.</p></div>
        <div className="event-list">
          <article className="event-row"><div className="date-block"><b>07</b><span>AOÛT<br />VEN.</span></div><div className="event-copy"><span className="event-tag">ANIMATION · LOTS</span><h3>L’INFERNALE ROUE</h3><p>Une commande, une chance de jouer. Shooter, conso, cadeau, Banco… la roue décide.</p></div><div className="event-time">18:00 <span>→</span> 01:00</div></article>
          <article className="event-row featured"><div className="date-block"><b>08</b><span>AOÛT<br />SAM.</span></div><div className="event-copy"><span className="event-tag">80'S · 90'S · 2000'S</span><h3>WE ARE THE KITSCH</h3><p>Les classiques qu’on connaît tous, les refrains qu’on assume et une soirée 100% nostalgie festive.</p></div><div className="event-time">18:00 <span>→</span> 01:00</div></article>
        </div>
      </section>

      <section className="manifesto"><div className="manifesto-word">MAMBO</div><div className="manifesto-content"><span className="kicker">NOTRE SIGNATURE</span><blockquote>« Une soirée doit laisser un souvenir, pas juste une addition. »</blockquote><p>ORIGINAL NIGHT BAR — VIBREZ AUTREMENT.</p></div></section>

      <section className="section practical" id="infos">
        <div className="section-heading compact"><span className="kicker">03 — INFOS PRATIQUES</span><h2>On se retrouve<br /><em>ce soir ?</em></h2></div>
        <div className="info-grid">
          <article><span className="info-label">ADRESSE</span><h3>Place du Marché<br />Condé-en-Normandie</h3><p>Au cœur du centre-ville.</p></article>
          <article><span className="info-label">HORAIRES</span><div className="hours"><div><span>Mardi — Jeudi</span><b>19h — 00h</b></div><div><span>Vendredi — Samedi</span><b>18h — 01h</b></div></div></article>
          <article className="follow-card"><span className="info-label">PROGRAMMATION</span><h3>La prochaine soirée se prépare déjà.</h3><p>Nos événements, offres et changements de programme sont annoncés sur nos réseaux.</p><a href="#events">Voir les événements <Arrow /></a></article>
        </div>
      </section>

      <footer><div className="footer-brand"><span className="brand-mark">M</span><div><strong>LE MAMBO</strong><small>ORIGINAL NIGHT BAR</small></div></div><div className="footer-center">PLACE DU MARCHÉ · CONDÉ-EN-NORMANDIE</div><div className="footer-legal">L’abus d’alcool est dangereux pour la santé. À consommer avec modération. Vente d’alcool interdite aux mineurs.</div></footer>
    </main>
  );
}
