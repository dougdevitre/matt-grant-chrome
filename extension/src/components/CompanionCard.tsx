import type { Scope } from "../lib/types.js";
import { matchCompanion } from "../lib/companionSites.js";

// The "Working here" card. Shown only when the active tab's host matches an
// allow-listed companion site the clerk's role can use. Renders nothing
// otherwise. `onDismiss` hides it for the rest of the panel session.
export function CompanionCard({
  host,
  scopes,
  onDismiss,
}: {
  host: string | null;
  scopes: Scope[];
  onDismiss: () => void;
}) {
  const site = matchCompanion(host, scopes);
  if (!site) return null;

  return (
    <div className="companion" role="note">
      <div className="companion-head">
        <span className="companion-tag">Working here</span>
        <button
          className="linklike companion-hide"
          onClick={onDismiss}
          title="Stop showing site tips (turn back on in Settings)"
        >
          Hide
        </button>
      </div>
      <h3 className="companion-title">{site.title}</h3>
      <p className="companion-body">{site.body}</p>
      {site.actions.length > 0 ? (
        <div className="companion-actions">
          {site.actions.map((a) => (
            <a
              key={a.url}
              className="companion-action"
              href={a.url}
              target="_blank"
              rel="noopener noreferrer"
            >
              {a.label}
            </a>
          ))}
        </div>
      ) : null}
    </div>
  );
}
