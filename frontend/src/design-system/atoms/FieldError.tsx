export function FieldError({
  id,
  children,
}: {
  id: string;
  children?: string;
}) {
  return children ? (
    <p className="field-error" id={id} role="alert">
      {children}
    </p>
  ) : null;
}
