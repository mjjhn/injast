import { LoaderCircle } from "lucide-react";
export function Loading({
  label = "در حال دریافت اطلاعات…",
}: {
  label?: string;
}) {
  return (
    <div className="loading-state" role="status">
      <LoaderCircle className="spin" size={22} aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}
