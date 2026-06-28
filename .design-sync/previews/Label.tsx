import { Label, Input, Checkbox } from "ideall"

export const WithInput = () => (
  <div className="grid w-72 gap-2">
    <Label htmlFor="name">Display name</Label>
    <Input id="name" placeholder="Ada Lovelace" />
  </div>
)

export const WithCheckbox = () => (
  <div className="flex items-center gap-2">
    <Checkbox id="terms" defaultChecked />
    <Label htmlFor="terms">I agree to the terms of service</Label>
  </div>
)
