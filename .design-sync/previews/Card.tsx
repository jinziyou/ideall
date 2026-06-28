import {
  Button,
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
  Badge,
} from "ideall"

export const Basic = () => (
  <Card className="w-80">
    <CardHeader>
      <CardTitle>Local-first sync</CardTitle>
      <CardDescription>
        Your notes stay on this device and sync end-to-end encrypted.
      </CardDescription>
    </CardHeader>
    <CardContent className="text-sm text-muted-foreground">
      Changes merge automatically across devices using a last-writer-wins log — no account
      required to get started.
    </CardContent>
    <CardFooter className="gap-2">
      <Button>Enable sync</Button>
      <Button variant="ghost">Maybe later</Button>
    </CardFooter>
  </Card>
)

export const Stat = () => (
  <Card className="w-64">
    <CardHeader className="pb-2">
      <CardDescription>Saved this week</CardDescription>
      <CardTitle className="text-3xl">1,284</CardTitle>
    </CardHeader>
    <CardContent className="flex items-center gap-2">
      <Badge>+12.5%</Badge>
      <span className="text-xs text-muted-foreground">vs last week</span>
    </CardContent>
  </Card>
)
