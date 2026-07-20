import { Link } from "react-router-dom";
import { BrandLink } from "./BrandLink";

const destinations = [
  {
    path: "/account",
    label: "Account",
    description: "Your athlete profile and connected services.",
  },
  {
    path: "/analyse",
    label: "Analyse",
    description: "Explore activities, routes, elevation, and heart rate.",
  },
  {
    path: "/plan",
    label: "Plan",
    description: "Shape upcoming training and recovery.",
  },
  {
    path: "/settings",
    label: "Settings",
    description: "Configure vatove for the way you train.",
  },
] as const;

export function HomePanel() {
  return (
    <main className="route-page route-page--home">
      <section
        className="home-panel"
        data-map-overlay
        aria-labelledby="home-panel-title"
      >
        <header className="home-panel__header">
          <BrandLink subtitle="Training, mapped" />
          <p className="home-panel__eyebrow">Your training workspace</p>
          <h1 id="home-panel-title">Where do you want to go?</h1>
          <p>
            Review your activity data today, with planning and account tools ready to grow
            alongside it.
          </p>
        </header>

        <nav className="home-navigation" aria-label="Main navigation">
          {destinations.map((destination) => (
            <Link
              key={destination.path}
              className={`home-navigation__link home-navigation__link--${destination.label.toLowerCase()}`}
              to={destination.path}
            >
              <span className="home-navigation__label">{destination.label}</span>
              <span className="home-navigation__description">{destination.description}</span>
              <span className="home-navigation__arrow" aria-hidden="true">
                →
              </span>
            </Link>
          ))}
        </nav>
      </section>
    </main>
  );
}
