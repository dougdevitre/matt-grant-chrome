import { useEffect, useState } from "react";
import type { PhaseConfig } from "../lib/types.js";
import { timeRemaining } from "../lib/phase.js";

export function Countdown({ config }: { config: PhaseConfig }) {
  const [remaining, setRemaining] = useState(() =>
    timeRemaining(config.nextDeadline)
  );

  useEffect(() => {
    const id = setInterval(
      () => setRemaining(timeRemaining(config.nextDeadline)),
      60_000
    );
    return () => clearInterval(id);
  }, [config.nextDeadline]);

  return (
    <div className="countdown" role="status">
      <div className="label">{config.label}</div>
      <p className="cta">{config.primaryCta}</p>
      <div className="clock">{remaining} until next deadline</div>
    </div>
  );
}
