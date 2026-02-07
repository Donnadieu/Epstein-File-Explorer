export function Kbd({ keys }: { keys: string }) {
  const parts = keys.split(/([+ ])/);
  return (
    <span className="flex items-center gap-0.5">
      {parts.map((part, i) => {
        if (part === "+" || part === " ") {
          return (
            <span key={i} className="text-[10px] text-muted-foreground/60 mx-0.5">
              {part === " " ? "then" : "+"}
            </span>
          );
        }
        return (
          <kbd
            key={i}
            className="inline-flex items-center justify-center min-w-[1.5rem] h-6 px-1.5 text-[11px] font-mono font-medium rounded border bg-muted text-muted-foreground"
          >
            {part === "Cmd" ? "\u2318" : part === "Esc" ? "\u238b" : part}
          </kbd>
        );
      })}
    </span>
  );
}
