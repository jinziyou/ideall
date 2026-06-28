import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
  Button,
  Label,
  Input,
} from "ideall"

export const Confirm = () => (
  <Dialog open>
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Delete this note?</DialogTitle>
        <DialogDescription>
          This permanently removes the note from all your synced devices. This can&apos;t be undone.
        </DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <Button variant="ghost">Cancel</Button>
        <Button variant="destructive">Delete</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
)

export const WithForm = () => (
  <Dialog open>
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Pair a new device</DialogTitle>
        <DialogDescription>
          Enter the 6-word pairing code shown on your other device.
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-2">
        <Label htmlFor="code">Pairing code</Label>
        <Input id="code" placeholder="ocean-maple-river-…" />
      </div>
      <DialogFooter>
        <Button variant="ghost">Cancel</Button>
        <Button>Pair device</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
)
