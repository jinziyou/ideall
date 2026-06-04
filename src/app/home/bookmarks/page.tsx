import BookmarkManager from "./bookmark-manager"

export const metadata = {
  title: "书签管理 | wonita",
  description: "本地书签 —— 收藏夹分组、导入浏览器书签。",
}

export default function BookmarksPage() {
  return <BookmarkManager />
}
