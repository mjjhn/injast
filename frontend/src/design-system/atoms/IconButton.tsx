import type { ComponentProps } from "react";
import { Button } from "./Button";

type Props = ComponentProps<typeof Button> & { "aria-label": string };

export function IconButton({ className = "", ...props }: Props) {
  return (
    <Button
      variant="ghost"
      className={`icon-button ${className}`.trim()}
      {...props}
    />
  );
}
