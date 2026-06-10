"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Info } from "../model"
import { EntityEntryLinks, partitionEntities } from "../cells"
import { entityLabelText } from "@/lib/ner-labels"

export default function InfoBasicView({ info }: { info: Info }) {
  const { withEntry, others } = partitionEntities(info.labels)
  const openEntity = (label: string, name: string) =>
    window.open(`/info/entity/${encodeURIComponent(label)}/${encodeURIComponent(name)}`)
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base sm:text-lg">这篇报道</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <div>
          <div className="text-xs text-muted-foreground">标题</div>
          <div className="mt-1 font-medium break-all">{info.title}</div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">相关实体</div>
          {withEntry.length === 0 && others.length === 0 ? (
            <div className="mt-1">
              <span className="text-muted-foreground">-</span>
            </div>
          ) : (
            <div className="mt-1 space-y-2">
              {withEntry.length > 0 && (
                <div className="space-y-1">
                  <div className="text-xs text-muted-foreground">有词条实体</div>
                  <div className="flex flex-wrap gap-2">
                    {withEntry.map((entity, index) => (
                      <div
                        key={`${entity.label}-${entity.name}-${index}`}
                        className="flex items-center gap-1"
                      >
                        <Button
                          variant="secondary"
                          size="sm"
                          className="h-auto min-h-7 max-w-full whitespace-normal break-all py-1"
                          onClick={() => openEntity(entity.label, entity.name)}
                        >
                          {entityLabelText(entity.label)} · {entity.name}
                        </Button>
                        <span className="text-xs">
                          <EntityEntryLinks entity={entity} />
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {others.length > 0 && (
                <details>
                  <summary className="cursor-pointer select-none text-xs text-muted-foreground">
                    次要实体 ({others.length})
                  </summary>
                  <div className="mt-1 flex flex-wrap gap-2">
                    {others.map((entity, index) => (
                      <Button
                        key={`${entity.label}-${entity.name}-${index}`}
                        variant="ghost"
                        size="sm"
                        className="h-auto min-h-7 max-w-full whitespace-normal break-all py-1 text-muted-foreground"
                        onClick={() => openEntity(entity.label, entity.name)}
                      >
                        {entityLabelText(entity.label)} · {entity.name}
                      </Button>
                    ))}
                  </div>
                </details>
              )}
            </div>
          )}
        </div>
        <div>
          <div className="text-xs text-muted-foreground">发布者</div>
          <Button
            variant="link"
            className="h-auto p-0"
            onClick={() =>
              window.open(`/info/publisher/${encodeURIComponent(info.publisher.domain)}`)
            }
          >
            {info.publisher.domain}
            {info.publisher.name ? ` · ${info.publisher.name}` : ""}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
