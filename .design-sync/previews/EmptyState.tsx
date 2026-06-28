import { EmptyState, Button } from "ideall"
import { Inbox, Search } from "lucide-react"

export const WithAction = () => (
  <div className="w-96">
    <EmptyState
      icon={Inbox}
      title="No notes yet"
      description="Create your first note to get started — everything stays on this device."
      action={<Button>New note</Button>}
    />
  </div>
)

export const NoResults = () => (
  <div className="w-96">
    <EmptyState
      icon={Search}
      title="No matches"
      description="Try a different search term."
      bordered={false}
    />
  </div>
)
