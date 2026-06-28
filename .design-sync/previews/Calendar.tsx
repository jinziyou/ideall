import { Calendar } from "ideall"

// Fixed dates keep the render deterministic (no new Date() drift → stable grades).
export const SingleDate = () => (
  <Calendar
    mode="single"
    defaultMonth={new Date(2026, 5, 1)}
    selected={new Date(2026, 5, 15)}
    className="rounded-md border"
  />
)

export const DateRange = () => (
  <Calendar
    mode="range"
    defaultMonth={new Date(2026, 5, 1)}
    selected={{ from: new Date(2026, 5, 10), to: new Date(2026, 5, 16) }}
    className="rounded-md border"
  />
)
