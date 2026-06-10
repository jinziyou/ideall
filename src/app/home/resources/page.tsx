import FileManager from "./file-manager"

export const metadata = {
  title: "资源 | wonita",
  description: "文件只存本机，支持上传、预览与分类。",
}

export default function ResourcesPage() {
  return <FileManager />
}
