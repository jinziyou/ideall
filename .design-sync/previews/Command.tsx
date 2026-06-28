import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandSeparator,
  CommandShortcut,
} from "ideall"
import { Plus, Search, FileText, Settings } from "lucide-react"

// Command renders inline (cmdk, no portal) — show the full palette.
export const Palette = () => (
  <Command className="w-[460px] rounded-lg border shadow-md">
    <CommandInput placeholder="Type a command or search…" />
    <CommandList>
      <CommandEmpty>No results found.</CommandEmpty>
      <CommandGroup heading="Suggestions">
        <CommandItem>
          <Plus className="mr-2 h-4 w-4" /> New note
        </CommandItem>
        <CommandItem>
          <Search className="mr-2 h-4 w-4" /> Search notes
        </CommandItem>
        <CommandItem>
          <FileText className="mr-2 h-4 w-4" /> Open file…
        </CommandItem>
      </CommandGroup>
      <CommandSeparator />
      <CommandGroup heading="Settings">
        <CommandItem>
          <Settings className="mr-2 h-4 w-4" /> Preferences
          <CommandShortcut>⌘,</CommandShortcut>
        </CommandItem>
      </CommandGroup>
    </CommandList>
  </Command>
)
