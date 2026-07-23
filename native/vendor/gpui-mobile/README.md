# gpui-mobile source snapshot

This directory vendors [`itsbalamurali/gpui-mobile`](https://github.com/itsbalamurali/gpui-mobile)
at revision `1d3ec2a1d14a63b74d1f4269340441d4eeada27a`.

The snapshot is kept local because ideall needs a small iOS runtime hardening patch that has not
landed upstream, plus workspace compatibility cleanup:

- serialize FFI frame pumps at the `IosWindow` boundary;
- avoid panicking when momentum or frame callback state is already borrowed;
- release the momentum borrow before dispatching GPUI input.
- keep vendored code warning-free under ideall's host-target Clippy gate;
- let the parent workspace own dependency patches and build profiles;
- pin the single direct/transitive wgpu `v29` source in `native/Cargo.lock` to revision
  `357a0c56e0070480ad9daea5d2eaa83150b79e88`, with the vendor verifier rejecting drift.

The machine-readable source is in `upstream.env`; `PATCHED_FILES.sha256` locks every locally
modified file. The upstream Apache, GPL, and AGPL license files are retained unchanged.

Run `bash native/scripts/verify-gpui-mobile-vendor.sh` for an offline integrity check. Add
`--upstream` to fetch the exact revision and prove that no unrecorded source files differ. When
upgrading, replace `src/` and `Cargo.toml`, reapply the documented compatibility changes, update
`upstream.env` and `PATCHED_FILES.sha256`, then run the native host plus Android/iOS smoke tests.
