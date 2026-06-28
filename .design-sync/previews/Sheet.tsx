import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
  Button,
  Label,
  Input,
} from "ideall"

export const RightPanel = () => (
  <Sheet open>
    <SheetContent side="right">
      <SheetHeader>
        <SheetTitle>Settings</SheetTitle>
        <SheetDescription>Manage how this device syncs and stores your data.</SheetDescription>
      </SheetHeader>
      <div className="grid gap-2 py-4">
        <Label htmlFor="device">Device name</Label>
        <Input id="device" defaultValue="my-device-01" />
      </div>
      <SheetFooter>
        <Button>Save changes</Button>
      </SheetFooter>
    </SheetContent>
  </Sheet>
)
