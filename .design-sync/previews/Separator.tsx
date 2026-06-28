import { Separator } from "ideall"

export const HorizontalAndVertical = () => (
  <div className="w-72">
    <div className="space-y-1">
      <h4 className="text-sm font-medium leading-none">ideall</h4>
      <p className="text-sm text-muted-foreground">Local-first personal terminal</p>
    </div>
    <Separator className="my-4" />
    <div className="flex h-5 items-center gap-4 text-sm">
      <span>Notes</span>
      <Separator orientation="vertical" />
      <span>Files</span>
      <Separator orientation="vertical" />
      <span>Sync</span>
    </div>
  </div>
)
