import { Link } from "react-router-dom";

interface BrandLinkProps {
  subtitle?: string;
  className?: string;
}

export function BrandLink({
  subtitle = "Activity explorer",
  className = "",
}: BrandLinkProps) {
  const classes = ["brand", className].filter(Boolean).join(" ");

  return (
    <Link className={classes} to="/" aria-label="Go to the vatove home page">
      <span className="brand-mark" aria-hidden="true">
        <i />
      </span>
      <span className="brand-copy">
        <strong>vatove</strong>
        <small>{subtitle}</small>
      </span>
    </Link>
  );
}
