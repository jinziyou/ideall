import { HoverCard, HoverCardTrigger, HoverCardContent, Button } from "ideall"

export const Open = () => (
  <HoverCard open>
    <HoverCardTrigger asChild>
      <Button variant="link">@ideall</Button>
    </HoverCardTrigger>
    <HoverCardContent>
      <div className="space-y-1">
        <h4 className="text-sm font-semibold">ideall</h4>
        <p className="text-sm text-muted-foreground">
          Open-source, local-first personal information terminal.
        </p>
        <p className="text-xs text-muted-foreground">Joined June 2026</p>
      </div>
    </HoverCardContent>
  </HoverCard>
)
