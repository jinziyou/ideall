import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
  Badge,
} from "ideall"

export const SyncActivity = () => (
  <Table className="w-[560px]">
    <TableCaption>Recent sync activity across your devices</TableCaption>
    <TableHeader>
      <TableRow>
        <TableHead>Device</TableHead>
        <TableHead>Last sync</TableHead>
        <TableHead>Status</TableHead>
        <TableHead className="text-right">Notes</TableHead>
      </TableRow>
    </TableHeader>
    <TableBody>
      <TableRow>
        <TableCell className="font-medium">MacBook Pro</TableCell>
        <TableCell>2 min ago</TableCell>
        <TableCell>
          <Badge>Synced</Badge>
        </TableCell>
        <TableCell className="text-right">1,284</TableCell>
      </TableRow>
      <TableRow>
        <TableCell className="font-medium">iPhone 15</TableCell>
        <TableCell>1 hour ago</TableCell>
        <TableCell>
          <Badge variant="secondary">Idle</Badge>
        </TableCell>
        <TableCell className="text-right">1,284</TableCell>
      </TableRow>
      <TableRow>
        <TableCell className="font-medium">Linux desktop</TableCell>
        <TableCell>3 days ago</TableCell>
        <TableCell>
          <Badge variant="destructive">Conflict</Badge>
        </TableCell>
        <TableCell className="text-right">1,279</TableCell>
      </TableRow>
    </TableBody>
  </Table>
)
