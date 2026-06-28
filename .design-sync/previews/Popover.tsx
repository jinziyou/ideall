import { Popover, PopoverTrigger, PopoverContent, Button, Label, Input } from "ideall"

export const Open = () => (
  <Popover open>
    <PopoverTrigger asChild>
      <Button variant="outline">Display settings</Button>
    </PopoverTrigger>
    <PopoverContent>
      <div className="grid gap-3">
        <p className="text-sm font-medium leading-none">Dimensions</p>
        <div className="grid gap-2">
          <Label htmlFor="width">Width</Label>
          <Input id="width" defaultValue="320px" />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="height">Height</Label>
          <Input id="height" defaultValue="480px" />
        </div>
      </div>
    </PopoverContent>
  </Popover>
)
