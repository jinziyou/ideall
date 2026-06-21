import BookmarkManager from "./bookmark-manager"

export const metadata = {
  title: "书签 | ideall",
  description: "书签只存本机，支持分组与导入。",
}

export default function BookmarksPage() {
  return <BookmarkManager />
}
