import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router";
import { Plus } from "lucide-react";
import { errorMessage, type Status } from "../api";
import { Empty } from "./components/EmptyGoals";
import { GoalRow } from "./components/GoalRow";
import { WalletCard } from "./components/WalletCard";
import { Button, ButtonLink, Loading } from "../design-system/atoms";
import { ErrorState } from "../design-system/molecules/ErrorState";
import { Shell } from "../design-system/layout";

import { goalsQuery, walletQuery } from "./queries";

export function GoalsList() {
  const [params, setParams] = useSearchParams();
  const status: Status =
    params.get("status") === "completed" ? "completed" : "active";
  const goals = useQuery(goalsQuery(status));
  const wallet = useQuery(walletQuery());
  return (
    <Shell
      title="هدف‌های من"
      eyebrow="برای فردایی که می‌خواهی"
      footer={
        <ButtonLink to="/goals/new" state={{ returnTo: `/?status=${status}` }}>
          <Plus size={20} aria-hidden="true" />
          هدف جدید
        </ButtonLink>
      }
    >
      {wallet.isPending && <Loading label="در حال دریافت موجودی…" />}
      {wallet.isSuccess && <WalletCard amount={wallet.data.availableAmount} />}
      {wallet.isError && (
        <ErrorState
          message={errorMessage(wallet.error)}
          retry={() => {
            void wallet.refetch();
          }}
        />
      )}
      <div className="section-intro">
        <h2>هر هدف، یک قدم نزدیک‌تر</h2>
        <p>پس‌اندازهای کوچک، خواسته‌های بزرگ.</p>
      </div>
      <div role="tablist" aria-label="وضعیت هدف‌ها" className="tabs">
        {(["active", "completed"] as const).map((tab) => (
          <Button
            variant="ghost"
            key={tab}
            role="tab"
            id={`tab-${tab}`}
            aria-selected={status === tab}
            aria-controls="goals-panel"
            tabIndex={status === tab ? 0 : -1}
            onKeyDown={(event) => {
              if (
                event.key === "ArrowLeft" ||
                event.key === "ArrowRight" ||
                event.key === "Home" ||
                event.key === "End"
              ) {
                event.preventDefault();
                const next =
                  event.key === "Home"
                    ? "active"
                    : event.key === "End"
                      ? "completed"
                      : status === "active"
                        ? "completed"
                        : "active";
                setParams({ status: next });
                document.getElementById(`tab-${next}`)?.focus();
              }
            }}
            onClick={() => setParams({ status: tab })}
          >
            {tab === "active" ? "فعال" : "تمام‌شده"}
          </Button>
        ))}
      </div>
      <section
        id="goals-panel"
        role="tabpanel"
        aria-labelledby={`tab-${status}`}
        className="goals-list"
      >
        {goals.isPending ? (
          <Loading />
        ) : goals.isError ? (
          <ErrorState
            message={errorMessage(goals.error)}
            retry={() => {
              void goals.refetch();
            }}
          />
        ) : goals.data.goals.length ? (
          goals.data.goals.map((goal) => <GoalRow key={goal.id} goal={goal} />)
        ) : (
          <Empty completed={status === "completed"} />
        )}
      </section>
      <p className="bottom-note">
        هر مبلغی که کنار می‌گذاری، یک قدم رو به جلوست.
      </p>
    </Shell>
  );
}
