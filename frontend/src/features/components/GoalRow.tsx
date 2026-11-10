import { Link, useLocation } from "react-router";
import { BadgeCheck, Target, ChevronLeft } from "lucide-react";
import type { Goal } from "../../api";
import { Money } from "../../design-system/atoms";
import { Progress } from "./GoalProgress";
import { formatMoney } from "../../lib/money";
import { formatDate } from "../../lib/dates";
export function GoalRow({ goal }: { goal: Goal }) {
  const location = useLocation();
  return (
    <Link
      to={`/goals/${goal.id}`}
      state={{ returnTo: location.pathname + location.search }}
      className="goal-row"
    >
      <div className="goal-heading">
        <span className="goal-symbol">
          {goal.status === "completed" ? (
            <BadgeCheck size={20} aria-hidden="true" />
          ) : (
            <Target size={20} aria-hidden="true" />
          )}
        </span>
        <div>
          <h2>{goal.name}</h2>
          <span className="muted">
            {goal.status === "completed"
              ? "هدف تکمیل شده"
              : "قدم‌به‌قدم تا رسیدن"}
          </span>
        </div>
        <ChevronLeft className="row-arrow" size={19} aria-hidden="true" />
      </div>
      <div className="goal-amounts">
        <Money value={goal.savedAmount} />
        <span className="muted">از {formatMoney(goal.targetAmount)}</span>
      </div>
      <Progress goal={goal} />
      <div className="goal-deadline">
        <span>مهلت هدف</span>
        <span>{formatDate(goal.deadline)}</span>
      </div>
    </Link>
  );
}
