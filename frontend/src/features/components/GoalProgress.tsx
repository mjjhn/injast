import type { Goal } from "../../api";
import { formatNumber } from "../../lib/money";
export function Progress({ goal }: { goal: Goal }) {
  const percent = Math.min(
    100,
    Math.round((goal.savedAmount / goal.targetAmount) * 100),
  );
  return (
    <div className="progress-block">
      <div className="progress-caption">
        <span>پیشرفت هدف</span>
        <strong>{formatNumber(percent)}٪</strong>
      </div>
      <div
        role="progressbar"
        aria-label={`پیشرفت ${goal.name}`}
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        className="progress-track"
      >
        <span style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}
