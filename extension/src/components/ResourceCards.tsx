import type { Lane, ResolveResponse, ResourceCard } from "../lib/types.js";

const LANE_TITLES: Record<Lane, string> = {
  vote: "Vote",
  issues: "Issues",
  volunteer: "Volunteer",
  act: "Act",
};

const LANE_ORDER: Lane[] = ["vote", "issues", "volunteer", "act"];

function Card({ card }: { card: ResourceCard }) {
  return (
    <div className="card">
      <span className="src">{card.source}</span>
      <h3>{card.title}</h3>
      <p>{card.body}</p>
      {card.ctaUrl ? (
        <a
          className="cta-link"
          href={card.ctaUrl}
          target="_blank"
          rel="noreferrer noopener"
        >
          {card.ctaLabel ?? "Open"}
        </a>
      ) : null}
    </div>
  );
}

export function ResourceCards({ data }: { data: ResolveResponse }) {
  const byLane = (lane: Lane) => data.cards.filter((c) => c.lane === lane);

  if (data.cards.length === 0) {
    return (
      <div className="empty">
        No actions for your role in this phase yet. Try adding your address for
        exact local info.
      </div>
    );
  }

  return (
    <>
      {data.location.inDistrict === false ? (
        <div className="warn">
          This location looks outside MO-02. Voting and issue info still apply;
          district-specific actions are hidden.
        </div>
      ) : null}
      {LANE_ORDER.map((lane) => {
        const cards = byLane(lane);
        if (cards.length === 0) return null;
        return (
          <section className="lane" key={lane}>
            <h2>{LANE_TITLES[lane]}</h2>
            {cards.map((c) => (
              <Card key={c.id} card={c} />
            ))}
          </section>
        );
      })}
    </>
  );
}
