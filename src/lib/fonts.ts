import { Noto_Sans_SC } from "next/font/google"

/** 思源黑体 (Source Han Sans SC) — Google Noto Sans SC, SIL OFL, 免费商用。 */
export const sourceHanSans = Noto_Sans_SC({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-source-han-sans",
  display: "swap",
})
