import { Textarea, Label } from "ideall"

export const Default = () => (
  <div className="grid w-80 gap-2">
    <Label htmlFor="note">Note</Label>
    <Textarea id="note" placeholder="Write a quick note…" />
  </div>
)

export const Filled = () => (
  <Textarea
    className="w-80"
    rows={4}
    defaultValue={
      "Local-first means your data lives on this device first.\nSync is optional and end-to-end encrypted."
    }
  />
)
