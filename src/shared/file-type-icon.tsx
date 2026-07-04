import {
  Box,
  Braces,
  File,
  FileArchive,
  FileAudio,
  FileCode2,
  FileImage,
  FileJson,
  FileSpreadsheet,
  FileText,
  FileType,
  FileVideo,
  Presentation,
  Table2,
} from "lucide-react"
import type { ComponentType } from "react"
import { cn } from "@/lib/utils"
import { fileTypeInfo, type FilePreviewKind, type FileTypeTone } from "@/lib/file-type"

type Icon = ComponentType<{ className?: string }>

const PREVIEW_ICON: Record<FilePreviewKind, Icon> = {
  image: FileImage,
  svg: FileImage,
  video: FileVideo,
  audio: FileAudio,
  pdf: FileText,
  markdown: FileText,
  code: FileCode2,
  json: FileJson,
  csv: Table2,
  text: FileText,
  spreadsheet: FileSpreadsheet,
  document: FileText,
  presentation: Presentation,
  archive: FileArchive,
  font: FileType,
  model: Box,
  binary: Braces,
  other: File,
}

const TONE_CLASS: Record<FileTypeTone, { text: string; bg: string; border: string; soft: string }> =
  {
    sky: {
      text: "text-sky-600",
      bg: "bg-sky-600",
      border: "border-sky-500/30",
      soft: "bg-sky-500/10",
    },
    violet: {
      text: "text-violet-600",
      bg: "bg-violet-600",
      border: "border-violet-500/30",
      soft: "bg-violet-500/10",
    },
    emerald: {
      text: "text-emerald-600",
      bg: "bg-emerald-600",
      border: "border-emerald-500/30",
      soft: "bg-emerald-500/10",
    },
    amber: {
      text: "text-amber-600",
      bg: "bg-amber-600",
      border: "border-amber-500/30",
      soft: "bg-amber-500/10",
    },
    rose: {
      text: "text-rose-600",
      bg: "bg-rose-600",
      border: "border-rose-500/30",
      soft: "bg-rose-500/10",
    },
    cyan: {
      text: "text-cyan-600",
      bg: "bg-cyan-600",
      border: "border-cyan-500/30",
      soft: "bg-cyan-500/10",
    },
    slate: {
      text: "text-slate-600",
      bg: "bg-slate-600",
      border: "border-slate-500/30",
      soft: "bg-slate-500/10",
    },
    zinc: {
      text: "text-zinc-600",
      bg: "bg-zinc-600",
      border: "border-zinc-500/30",
      soft: "bg-zinc-500/10",
    },
  }

export function fileTypeClasses(name: string, type = "") {
  return TONE_CLASS[fileTypeInfo(name, type).tone]
}

export function FileTypeIcon({
  name,
  type,
  className,
}: {
  name: string
  type?: string
  className?: string
}) {
  const info = fileTypeInfo(name, type)
  const Icon = PREVIEW_ICON[info.preview]
  return <Icon className={cn(TONE_CLASS[info.tone].text, className)} />
}

export function FileTypeBadge({
  name,
  type,
  className,
}: {
  name: string
  type?: string
  className?: string
}) {
  const info = fileTypeInfo(name, type)
  const tone = TONE_CLASS[info.tone]
  return (
    <span
      className={cn(
        "inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-medium",
        tone.border,
        tone.soft,
        tone.text,
        className,
      )}
    >
      {info.label}
    </span>
  )
}

export function fileTypeDotClass(name: string, type = ""): string {
  return TONE_CLASS[fileTypeInfo(name, type).tone].bg
}
