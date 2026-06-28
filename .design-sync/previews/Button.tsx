import { Button } from "ideall"
import { Plus, Download, Trash2, Loader2 } from "lucide-react"

export const Variants = () => (
  <div className="flex flex-wrap items-center gap-3">
    <Button>Save changes</Button>
    <Button variant="secondary">Cancel</Button>
    <Button variant="outline">Preview</Button>
    <Button variant="ghost">Skip</Button>
    <Button variant="destructive">Delete</Button>
    <Button variant="link">Learn more</Button>
  </div>
)

export const Sizes = () => (
  <div className="flex flex-wrap items-center gap-3">
    <Button size="sm">Small</Button>
    <Button size="default">Default</Button>
    <Button size="lg">Large</Button>
    <Button size="icon" aria-label="Add">
      <Plus className="h-4 w-4" />
    </Button>
  </div>
)

export const WithIcons = () => (
  <div className="flex flex-wrap items-center gap-3">
    <Button>
      <Plus className="mr-2 h-4 w-4" /> New note
    </Button>
    <Button variant="outline">
      <Download className="mr-2 h-4 w-4" /> Export
    </Button>
    <Button variant="destructive">
      <Trash2 className="mr-2 h-4 w-4" /> Remove
    </Button>
  </div>
)

export const States = () => (
  <div className="flex flex-wrap items-center gap-3">
    <Button disabled>Disabled</Button>
    <Button disabled>
      <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Saving…
    </Button>
    <Button variant="secondary" disabled>
      Unavailable
    </Button>
  </div>
)
