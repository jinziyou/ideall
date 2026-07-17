import type { RuntimeExtensionDescriptor, RuntimeExtensionVerifier } from "./types"

export type RuntimeExtensionTrustHost = Readonly<{
  verifier: RuntimeExtensionVerifier
}>

/** 固定 delegate 允许组合根延迟注入 verifier，但同一进程只能绑定一次信任根。 */
export function createRuntimeExtensionTrustBoundary(): Readonly<{
  verifier: RuntimeExtensionVerifier
  configure(host: RuntimeExtensionTrustHost): void
}> {
  let verify:
    | ((descriptor: RuntimeExtensionDescriptor) => ReturnType<RuntimeExtensionVerifier["verify"]>)
    | undefined
  return Object.freeze({
    verifier: Object.freeze({
      verify(descriptor: RuntimeExtensionDescriptor) {
        if (!verify) throw new Error(`No runtime extension trust host configured: ${descriptor.id}`)
        return verify(descriptor)
      },
    }),
    configure(host) {
      if (verify) throw new Error("Runtime extension trust host is already configured")
      const candidate = host?.verifier?.verify
      if (typeof candidate !== "function") {
        throw new TypeError("Invalid runtime extension verifier")
      }
      verify = (descriptor) => Reflect.apply(candidate, host.verifier, [descriptor])
    },
  })
}
