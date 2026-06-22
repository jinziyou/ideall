import NotesManager from "./notes-manager"

export const metadata = {
  title: "笔记 | ideall",
  description: "类 Notion 的块编辑笔记，只存本机。",
}

export default function NotesPage() {
  return <NotesManager />
}
