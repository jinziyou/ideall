import BookmarkManager from "./bookmark-manager"

export const metadata = {
  title: "书签管理 | wonita",
  description: "存在本机浏览器的链接 —— 收藏夹分组、导入浏览器书签，本地恒在。",
}

export default function BookmarksPage() {
  return <BookmarkManager />
}
