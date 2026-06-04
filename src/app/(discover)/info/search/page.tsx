import { InfoTable } from "./info-table"

export default function InfoSearchPage() {
  return (
    <main className="m-2 grid items-start gap-4 rounded-lg border bg-card p-4 text-card-foreground shadow-sm sm:mx-4 sm:px-6 md:gap-8">
      <InfoTable />
    </main>
  )
}
