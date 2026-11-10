import { Wallet } from "lucide-react";
import { Money } from "../../design-system/atoms";
export function WalletCard({ amount }: { amount: number }) {
  return (
    <section className="wallet-card" aria-label="موجودی قابل استفاده">
      <div className="wallet-label">
        <Wallet size={18} aria-hidden="true" />
        <span>موجودی قابل استفاده</span>
      </div>
      <Money value={amount} />
      <p>برای نزدیک‌تر شدن به هدف‌هایت</p>
    </section>
  );
}
