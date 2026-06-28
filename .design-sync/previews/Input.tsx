import { Input, Label } from "ideall"

export const Default = () => (
  <div className="flex w-72 flex-col gap-2">
    <Input placeholder="Search notes…" />
    <Input defaultValue="my-device-01" />
    <Input disabled placeholder="Disabled" />
  </div>
)

export const WithLabel = () => (
  <div className="grid w-72 gap-2">
    <Label htmlFor="email">Email</Label>
    <Input id="email" type="email" placeholder="you@example.com" />
  </div>
)
