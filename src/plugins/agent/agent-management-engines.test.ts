import assert from "node:assert/strict"
import { test } from "node:test"
import { isValidElement, type ReactElement } from "react"
import type { FileRef, IdeallFile } from "@protocol/file-system"
import { matchEngineDescriptor } from "@/engines/matcher"
import {
  AGENT_AUDIT_FILE_REF,
  AGENT_AUDIT_MEDIA_TYPE,
  AGENT_SETTINGS_FILE_REF,
  AGENT_SETTINGS_MEDIA_TYPE,
  AGENT_TASKS_FILE_REF,
  AGENT_TASKS_MEDIA_TYPE,
  AGENT_WORKSPACES_FILE_REF,
  AGENT_WORKSPACES_MEDIA_TYPE,
} from "@/filesystem/builtin-app-roots"
import { agentManifest } from "./manifest"
import {
  agentManagementEngineContributions,
  agentAuditEngineContribution,
  agentSettingsEngineContribution,
  agentSpacesEngineContribution,
  agentTasksEngineContribution,
  type AgentEngineContribution,
} from "./agent-management-engines"

type Surface = "settings" | "spaces" | "tasks" | "audit"

function managementFile(ref: IdeallFile["ref"], mediaType: string, surface: Surface): IdeallFile {
  return {
    ref,
    kind: "file",
    name: `${surface}.json`,
    mediaType,
    capabilities: ["read", "write"],
    source: { kind: "app", id: "agent", label: "AI 智能体" },
    properties: { agentManagementSurface: surface },
  }
}

const cases = [
  {
    contribution: agentAuditEngineContribution,
    ref: AGENT_AUDIT_FILE_REF,
    mediaType: AGENT_AUDIT_MEDIA_TYPE,
    surface: "audit",
  },
  {
    contribution: agentSettingsEngineContribution,
    ref: AGENT_SETTINGS_FILE_REF,
    mediaType: AGENT_SETTINGS_MEDIA_TYPE,
    surface: "settings",
  },
  {
    contribution: agentSpacesEngineContribution,
    ref: AGENT_WORKSPACES_FILE_REF,
    mediaType: AGENT_WORKSPACES_MEDIA_TYPE,
    surface: "spaces",
  },
  {
    contribution: agentTasksEngineContribution,
    ref: AGENT_TASKS_FILE_REF,
    mediaType: AGENT_TASKS_MEDIA_TYPE,
    surface: "tasks",
  },
] as const satisfies readonly {
  contribution: AgentEngineContribution
  ref: IdeallFile["ref"]
  mediaType: string
  surface: Surface
}[]

test("agent management Engines require their semantic media type and marker", () => {
  for (const { contribution, ref, mediaType, surface } of cases) {
    const file = managementFile(ref, mediaType, surface)
    assert.ok(matchEngineDescriptor(contribution.descriptor, file))
    assert.equal(
      matchEngineDescriptor(contribution.descriptor, {
        ...file,
        mediaType: "application/json",
      }),
      null,
    )
    assert.equal(
      matchEngineDescriptor(contribution.descriptor, {
        ...file,
        properties: { agentManagementSurface: "lookalike" },
      }),
      null,
    )
  }
})

test("agent management Displays guard the exact canonical FileRef", () => {
  for (const { contribution, ref, mediaType, surface } of cases) {
    const file = managementFile(ref, mediaType, surface)
    const display = contribution.renderer({ file, descriptor: contribution.descriptor })
    assert.ok(isValidElement(display))
    assert.notEqual((display as ReactElement).type, "div")
    assert.deepEqual((display as ReactElement<{ fileRef: FileRef }>).props.fileRef, ref)

    const lookalike = contribution.renderer({
      file: { ...file, ref: { ...file.ref, fileId: `${file.ref.fileId}:lookalike` } },
      descriptor: contribution.descriptor,
    })
    assert.ok(isValidElement(lookalike))
    assert.equal((lookalike as ReactElement).type, "div")
  }
})

test("agent manifest declares the provider-side Engine/Display contributions together", () => {
  assert.equal(agentManifest.engineContributions, agentManagementEngineContributions)
  assert.deepEqual(agentManifest.engines, [
    "ideall.agent-settings",
    "ideall.agent-spaces",
    "ideall.agent-tasks",
    "ideall.agent-write-audit",
  ])
})
