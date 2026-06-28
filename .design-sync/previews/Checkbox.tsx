import { Checkbox, Label } from "ideall"

export const States = () => (
  <div className="flex items-center gap-6">
    <Checkbox aria-label="Unchecked" />
    <Checkbox defaultChecked aria-label="Checked" />
    <Checkbox disabled aria-label="Disabled" />
    <Checkbox defaultChecked disabled aria-label="Checked and disabled" />
  </div>
)

export const WithLabels = () => (
  <div className="flex flex-col gap-3">
    <div className="flex items-center gap-2">
      <Checkbox id="sync" defaultChecked />
      <Label htmlFor="sync">Enable end-to-end encrypted sync</Label>
    </div>
    <div className="flex items-center gap-2">
      <Checkbox id="analytics" />
      <Label htmlFor="analytics">Share anonymous usage analytics</Label>
    </div>
  </div>
)
