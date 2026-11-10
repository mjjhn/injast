import { formatNumber } from "../../lib/money";
export function Money({
  value,
  className = "",
}: {
  value: number;
  className?: string;
}) {
  return (
    <span className={`money ${className}`}>
      <bdi>{formatNumber(value)}</bdi>
      <span className="currency">ریال</span>
    </span>
  );
}
