"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Info } from "../model"

export default function InfoBasicView({ info }: { info: Info }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base sm:text-lg">基本信息</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <div>
          <div className="text-xs text-muted-foreground">标题</div>
          <div className="mt-1 font-medium break-all">{info.title}</div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">命名实体</div>
          <div className="mt-1 flex flex-wrap gap-2">
            {info.labels?.length ? (
              info.labels.map((entity, index) => (
                <Button
                  key={`${entity.label}-${entity.name}-${index}`}
                  variant="secondary"
                  size="sm"
                  className="h-7"
                  onClick={() =>
                    window.open(
                      `/info/entity/${encodeURIComponent(entity.label)}/${encodeURIComponent(entity.name)}`,
                    )
                  }
                >
                  {entity.label}.{entity.name}
                </Button>
              ))
            ) : (
              <span className="text-muted-foreground">-</span>
            )}
          </div>
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
