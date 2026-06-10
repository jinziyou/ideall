import { notFound } from "next/navigation"
import { getInfo, getRelatedInfo } from "../action"
import InfoAnalysisView from "./analysis"
import InfoBasicView from "./basic"

export default async function InfoAnalysisPage({
  searchParams,
}: {
  searchParams: Promise<{ url: string }>
}) {
  const { url } = await searchParams
  if (!url) {
    notFound()
  }

  const [infoList, info] = await Promise.all([getRelatedInfo(url), getInfo(url)])
  if (!info) {
    notFound()
  }

  return (
    <main className="grid min-h-screen w-full gap-4 p-3 sm:p-4 md:grid-cols-5">
      <section className="md:col-span-2">
        <InfoBasicView info={info} />
      </section>
      <section className="md:col-span-3">
        <InfoAnalysisView info={info} analysis={infoList} />
      </section>
    </main>
  )
}
