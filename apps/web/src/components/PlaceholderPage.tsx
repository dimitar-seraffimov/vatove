import { Link } from "react-router-dom";
import { BrandLink } from "./BrandLink";

interface PlaceholderPageProps {
  title: "Account" | "Plan" | "Settings";
  description: string;
}

export function PlaceholderPage({ title, description }: PlaceholderPageProps) {
  const titleId = `${title.toLowerCase()}-page-title`;

  return (
    <main className={`route-page route-page--${title.toLowerCase()}`}>
      <section
        className="placeholder-panel"
        data-map-overlay
        aria-labelledby={titleId}
      >
        <BrandLink subtitle={title} />
        <div className="placeholder-panel__content">
          <p className="placeholder-panel__status">Coming soon</p>
          <h1 id={titleId}>{title}</h1>
          <p>{description}</p>
        </div>
        <nav className="placeholder-navigation" aria-label={`${title} page navigation`}>
          <Link to="/">Back to home</Link>
          <Link className="placeholder-navigation__primary" to="/analyse">
            Open Analyse
          </Link>
        </nav>
      </section>
    </main>
  );
}
