import { Tabs, TabsList, TabsTrigger, TabsContent } from "ideall"

export const Basic = () => (
  <Tabs defaultValue="notes" className="w-96">
    <TabsList>
      <TabsTrigger value="notes">Notes</TabsTrigger>
      <TabsTrigger value="files">Files</TabsTrigger>
      <TabsTrigger value="sync">Sync</TabsTrigger>
    </TabsList>
    <TabsContent value="notes" className="text-sm text-muted-foreground">
      You have 1,284 notes stored locally on this device.
    </TabsContent>
    <TabsContent value="files" className="text-sm text-muted-foreground">
      No files yet.
    </TabsContent>
    <TabsContent value="sync" className="text-sm text-muted-foreground">
      Last synced 2 minutes ago.
    </TabsContent>
  </Tabs>
)
