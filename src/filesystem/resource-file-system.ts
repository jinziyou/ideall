// ideall.core 兼容入口。Place/Panel 与 Ref 投影、访问策略、provider 编排分别位于同名目录；
// 现有消费方继续从本文件导入，内部辅助函数不扩大为公共 API。

export {
  aiTasksPanelFileRef,
  corePlaceRef,
  panelFileRef,
  panelForFile,
  placeForFile,
  resourceFileRef,
  resourceRefForFile,
  type CorePlaceId,
} from "./resource-file-system/catalog"

export { createResourceFileSystem, resourceFileSystem } from "./resource-file-system/provider"
