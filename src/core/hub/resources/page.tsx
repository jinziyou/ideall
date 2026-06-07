import FileManager from "./file-manager"

export const metadata = {
  title: "资源管理 | wonita",
  description: "存在本机浏览器的文件 —— 上传、预览、按类型管理，本地恒在。",
}

export default function ResourcesPage() {
  return <FileManager />
}
