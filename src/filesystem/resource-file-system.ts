// ideall.core 兼容入口。Place/Panel 与 Ref 投影、访问策略、provider 编排分别位于同名目录；
// 现有消费方继续从本文件导入，内部辅助函数不扩大为公共 API。

export {
  CORE_FILE_SYSTEM_ID,
  CORE_PLACE_IDS,
  CORE_ROOT_FILE_ID,
  aiTasksPanelFileRef,
  corePlaceRef,
  coreRootRef,
  panelFileRef,
  panelForFile,
  resourceFileRef,
  resourceRefForFile,
  type CorePlaceId,
} from "./resource-file-system/catalog"

export { createResourceFileSystem, resourceFileSystem } from "./resource-file-system/provider"
