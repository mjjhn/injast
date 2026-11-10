import { CircleAlert, RotateCcw } from "lucide-react";
import { Button } from "../atoms/Button";
export function ErrorState({
  message,
  retry,
}: {
  message: string;
  retry?: () => void;
}) {
  return (
    <section className="error-state" role="alert">
      <CircleAlert size={22} aria-hidden="true" />
      <p>{message}</p>
      {retry && (
        <Button variant="ghost" className="text-button" onClick={retry}>
          <RotateCcw size={16} aria-hidden="true" />
          تلاش دوباره
        </Button>
      )}
    </section>
  );
}
