import { cloneElement, type ReactElement, type ReactNode } from "react";
import { FieldError } from "../atoms/FieldError";

type ControlProps = {
  id?: string;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
};

/** One owner for label/control/error associations; custom controls forward ARIA. */
export function FormField({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string;
  label: ReactNode;
  hint?: ReactNode;
  error?: string;
  children: ReactElement<ControlProps>;
}) {
  const description = [error && `${id}-error`, hint && `${id}-hint`]
    .filter(Boolean)
    .join(" ");
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {cloneElement(children, {
        id,
        "aria-invalid": !!error,
        "aria-describedby": description || undefined,
      })}
      <FieldError id={`${id}-error`}>{error}</FieldError>
      {hint && (
        <p className="hint" id={`${id}-hint`}>
          {hint}
        </p>
      )}
    </div>
  );
}
