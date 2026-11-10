import { BadgeCheck, Target } from "lucide-react";
export function Empty({ completed = false }: { completed?: boolean }) {
  return (
    <section className="empty-state">
      <span className="empty-icon">
        {completed ? (
          <BadgeCheck size={28} aria-hidden="true" />
        ) : (
          <Target size={28} aria-hidden="true" />
        )}
      </span>
      <h2>
        {completed ? "جای هدف‌های رسیده اینجاست" : "اولین قدم، یک هدف تازه است"}
      </h2>
      <p>
        {completed
          ? "وقتی مبلغ یک هدف کامل شود، اینجا می‌بینی‌اش."
          : "برای چیزی که دوست داری، یک هدف پس‌انداز بساز."}
      </p>
    </section>
  );
}
