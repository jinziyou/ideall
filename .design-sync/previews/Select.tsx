import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectGroup,
  SelectLabel,
  SelectItem,
} from "ideall"

export const Open = () => (
  <Select defaultValue="lww" defaultOpen>
    <SelectTrigger className="w-64">
      <SelectValue placeholder="Choose a strategy" />
    </SelectTrigger>
    <SelectContent>
      <SelectGroup>
        <SelectLabel>Sync strategy</SelectLabel>
        <SelectItem value="lww">Last writer wins</SelectItem>
        <SelectItem value="manual">Manual merge</SelectItem>
        <SelectItem value="crdt">CRDT (experimental)</SelectItem>
      </SelectGroup>
    </SelectContent>
  </Select>
)

export const Closed = () => (
  <Select defaultValue="lww">
    <SelectTrigger className="w-64">
      <SelectValue placeholder="Choose a strategy" />
    </SelectTrigger>
    <SelectContent>
      <SelectItem value="lww">Last writer wins</SelectItem>
      <SelectItem value="manual">Manual merge</SelectItem>
      <SelectItem value="crdt">CRDT (experimental)</SelectItem>
    </SelectContent>
  </Select>
)
