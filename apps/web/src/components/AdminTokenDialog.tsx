import { useState } from "react";
import { Button, Input } from "./ui";

// Accessible replacement for window.prompt(): a real modal with keyboard
// support (Enter submits, Escape cancels) and screen-reader semantics.
export function AdminTokenDialog({
  onClose,
  onSubmit,
}: {
  onClose: () => void;
  onSubmit: (token: string) => void;
}) {
  const [value, setValue] = useState("");

  function confirm() {
    const token = value.trim();
    if (token !== "") onSubmit(token);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Admin token required"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-border bg-card p-5 shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <h3 className="text-sm font-semibold">Admin token required</h3>
        <p className="mt-1 text-xs text-muted">
          This action is protected. Enter the ADMIN_TOKEN configured on the server.
        </p>
        <Input
          autoFocus
          type="password"
          className="mt-3"
          aria-label="admin token"
          placeholder="admin token"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") confirm();
            if (event.key === "Escape") onClose();
          }}
        />
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={confirm} disabled={value.trim() === ""}>
            Continue
          </Button>
        </div>
      </div>
    </div>
  );
}
