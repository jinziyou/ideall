// 浏览器书签导入 —— 解析 Netscape Bookmark File Format (.html)。
// Chrome / Edge / Firefox / Safari 导出的书签都遵循该格式:
//   <DL><p>
//     <DT><H3>文件夹名</H3>
//     <DL><p>
//       <DT><A HREF="https://..." ADD_DATE="..." ICON="data:...">标题</A>
//     </DL><p>
//   </DL><p>
import { NewBookmark } from "@/files/stores/bookmarks-store"

export type ParsedBookmark = NewBookmark & {
  /** 该书签在导出文件中所属的文件夹路径 (顶层在前), 用于重建收藏夹 */
  folderPath: string[]
}

/**
 * 解析书签 HTML, 返回扁平书签列表 (附带文件夹路径)。
 * 使用浏览器 DOMParser, 仅在客户端调用。
 */
export function parseBookmarksHtml(html: string): ParsedBookmark[] {
  const doc = new DOMParser().parseFromString(html, "text/html")
  const result: ParsedBookmark[] = []

  // 从顶层 DL 递归向下, 维护当前文件夹路径
  function walk(node: Element, path: string[]) {
    // DL 的直接子节点是若干 DT (有些导出会包一层); 遍历所有 DT
    const dts = Array.from(node.children).filter((el) => el.tagName === "DT")
    for (const dt of dts) {
      const h3 = dt.querySelector(":scope > h3")
      const anchor = dt.querySelector(":scope > a")
      if (h3) {
        // 文件夹: 紧随其后的 DL 是其内容
        const name = (h3.textContent ?? "").trim() || "未命名"
        const childDl = dt.querySelector(":scope > dl")
        if (childDl) walk(childDl, [...path, name])
      } else if (anchor) {
        const url = anchor.getAttribute("href") ?? ""
        if (!url || !/^https?:|^ftp:|^file:/i.test(url)) continue
        const icon = anchor.getAttribute("icon") ?? ""
        result.push({
          title: (anchor.textContent ?? "").trim() || url,
          url,
          favicon: icon.startsWith("data:") || icon.startsWith("http") ? icon : "",
          folderPath: path,
        })
      }
    }
  }

  // 顶层可能有多个 DL, 也可能书签直接挂在 body 下
  const topDls = doc.querySelectorAll("body > dl, body > h1 + dl")
  if (topDls.length) {
    topDls.forEach((dl) => walk(dl, []))
  } else {
    doc.querySelectorAll("dl").forEach((dl) => {
      // 仅处理最外层 DL, 避免重复递归
      if (!dl.parentElement?.closest("dl")) walk(dl, [])
    })
  }

  return result
}
