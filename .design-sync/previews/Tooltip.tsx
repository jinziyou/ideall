import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider, Button } from "ideall"
import { Info } from "lucide-react"

export const Open = () => (
  <TooltipProvider>
    <Tooltip open>
      <TooltipTrigger asChild>
        <Button variant="outline" size="icon" aria-label="More info">
          <Info className="h-4 w-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>End-to-end encrypted</TooltipContent>
    </Tooltip>
  </TooltipProvider>
)
