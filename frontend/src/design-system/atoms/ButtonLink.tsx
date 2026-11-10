import type { ComponentProps } from "react";
import { Link } from "react-router";
import { buttonClassName } from "./Button";

export function ButtonLink({
  variant = "primary",
  className = "",
  ...props
}: ComponentProps<typeof Link> & {
  variant?: "primary" | "secondary" | "ghost";
}) {
  return <Link className={buttonClassName(variant, className)} {...props} />;
}
