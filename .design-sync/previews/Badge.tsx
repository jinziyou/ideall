import { Badge } from "ideall"

export const Variants = () => (
  <div className="flex flex-wrap items-center gap-2">
    <Badge>Default</Badge>
    <Badge variant="secondary">Secondary</Badge>
    <Badge variant="destructive">Destructive</Badge>
    <Badge variant="outline">Outline</Badge>
  </div>
)

export const InContext = () => (
  <div className="flex flex-wrap items-center gap-2">
    <Badge variant="secondary">v0.1.0</Badge>
    <Badge>Synced</Badge>
    <Badge variant="outline">Local only</Badge>
    <Badge variant="destructive">3 conflicts</Badge>
  </div>
)
