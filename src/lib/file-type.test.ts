import { test } from "node:test"
import assert from "node:assert/strict"
import { fileExtension, fileTypeInfo } from "./file-type"

test("fileExtension: 支持普通扩展名、点文件与特殊无扩展文件", () => {
  assert.equal(fileExtension("src/app/page.tsx"), "tsx")
  assert.equal(fileExtension(".gitignore"), "gitignore")
  assert.equal(fileExtension("Dockerfile"), "dockerfile")
  assert.equal(fileExtension("Makefile"), "makefile")
  assert.equal(fileExtension("archive.tar.gz"), "gz")
})

test("fileTypeInfo: 主流可编辑文本/代码/数据格式", () => {
  const cases = [
    ["app.tsx", "code", "code", "TypeScript React"],
    ["README.md", "markdown", "document", "Markdown"],
    ["config.yaml", "code", "data", "YAML"],
    ["data.json", "json", "data", "JSON"],
    ["report.csv", "csv", "data", "CSV"],
    ["vector.svg", "svg", "image", "SVG"],
  ] as const

  for (const [name, preview, group, language] of cases) {
    const type = fileTypeInfo(name)
    assert.equal(type.preview, preview, name)
    assert.equal(type.group, group, name)
    assert.equal(type.editable, true, name)
    assert.equal(type.language, language, name)
  }
})

test("fileTypeInfo: 主流媒体、文档、压缩包与二进制数据格式", () => {
  const cases = [
    ["photo.heic", "image", "image", "HEIC"],
    ["movie.mp4", "video", "media", "MP4"],
    ["track.flac", "audio", "media", "FLAC"],
    ["paper.pdf", "pdf", "document", "PDF"],
    ["sheet.xlsx", "spreadsheet", "document", "XLSX"],
    ["slides.pptx", "presentation", "document", "PPTX"],
    ["backup.zip", "archive", "archive", "ZIP"],
    ["font.woff2", "font", "binary", "WOFF2"],
    ["local.sqlite", "binary", "data", "SQLITE"],
  ] as const

  for (const [name, preview, group, label] of cases) {
    const type = fileTypeInfo(name)
    assert.equal(type.preview, preview, name)
    assert.equal(type.group, group, name)
    assert.equal(type.editable, false, name)
    assert.equal(type.label, label, name)
  }
})

test("fileTypeInfo: MIME 可补足无扩展文件识别", () => {
  assert.equal(fileTypeInfo("download", "application/json").preview, "json")
  assert.equal(fileTypeInfo("download", "image/png").preview, "image")
  assert.equal(fileTypeInfo("download", "application/pdf").preview, "pdf")
  assert.equal(fileTypeInfo("download", "application/vnd.ms-excel").preview, "spreadsheet")
})
