import type { ComponentProps } from "react";
type ButtonVariant =
  "primary" | "secondary" | "danger" | "danger-soft" | "ghost";

export function buttonClassName(variant: ButtonVariant, className = "") {
  return `button ${variant} ${className}`.trim();
}
export function Button({
  variant = "secondary",
  className = "",
  type = "button",
  ...props
}: ComponentProps<"button"> & { variant?: ButtonVariant }) {
  return (
    <button
      className={buttonClassName(variant, className)}
      type={type}
      {...props}
    />
  );
}
