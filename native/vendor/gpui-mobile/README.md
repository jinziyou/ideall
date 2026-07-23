# gpui-mobile source snapshot

This directory vendors [`itsbalamurali/gpui-mobile`](https://github.com/itsbalamurali/gpui-mobile)
at revision `1d3ec2a1d14a63b74d1f4269340441d4eeada27a`.

The snapshot is kept local because ideall needs a small iOS runtime hardening patch that has not
landed upstream:

- serialize FFI frame pumps at the `IosWindow` boundary;
- avoid panicking when momentum or frame callback state is already borrowed;
- release the momentum borrow before dispatching GPUI input.

The upstream Apache, GPL, and AGPL license files are retained unchanged. When upgrading the
snapshot, replace `src/` and `Cargo.toml` from the selected upstream revision, reapply the iOS
frame-pump patch, update the revision above, and run the native host plus Android/iOS smoke tests.
