import type { ReactNode } from "react";
import { ArrowRight, Target } from "lucide-react";
import { ButtonLink } from "../atoms/ButtonLink";
export function Shell({
  title,
  back,
  children,
  footer,
  eyebrow,
}: {
  title: string;
  back?: string;
  children: ReactNode;
  footer?: ReactNode;
  eyebrow?: string;
}) {
  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          {eyebrow && <span className="eyebrow">{eyebrow}</span>}
          <h1>{title}</h1>
        </div>
        {back ? (
          <ButtonLink
            variant="ghost"
            className="icon-button"
            to={back}
            aria-label="بازگشت"
          >
            <ArrowRight size={22} aria-hidden="true" />
          </ButtonLink>
        ) : (
          <span className="brand-mark" aria-hidden="true">
            <Target size={22} aria-hidden="true" />
          </span>
        )}
      </header>
      <main id="main-content" tabIndex={-1} className="page-content">
        {children}
      </main>
      {footer && <footer className="action-footer">{footer}</footer>}
    </div>
  );
}
