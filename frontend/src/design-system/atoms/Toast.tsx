import type { ReactNode } from "react";
import { Check, TriangleAlert, CircleAlert } from "lucide-react";
type ToastStatus = "success" | "warning" | "danger";
export function Toast({
  status,
  children,
}: {
  status: ToastStatus;
  children: ReactNode;
}) {
  const Icon =
    status === "success"
      ? Check
      : status === "warning"
        ? TriangleAlert
        : CircleAlert;
  return (
    <div
      className={`toast toast-${status}`}
      role={status === "danger" ? "alert" : "status"}
      aria-live={status === "danger" ? "assertive" : "polite"}
    >
      <Icon size={17} aria-hidden="true" />
      <span>{children}</span>
    </div>
  );
}
