// Environment-only workarounds for building aws-sdk-js-v3 on Windows. Preloaded via
//   NODE_OPTIONS=--require D:/ToptalAssessment/aws-sdk-js-v3/assessment/phase1/tooling/win-spawn-shim.cjs
// so no file in the pinned checkout is modified. No effect on non-Windows platforms.
//
// 1. scripts/compilation/Inliner.js calls spawn("yarn", ...) without a shell; on Windows libuv
//    cannot resolve yarn.cmd that way (spawn ENOENT). -> add shell:true for "yarn" only.
// 2. Inliner's rollup `external` predicate classifies ids with /^\.?\.?\//, i.e. it assumes POSIX
//    absolute paths. A resolved Windows id ("D:\...\dist-es\index.js") is therefore misread as a
//    bare package name and marked external (even the entry module). -> present resolved Windows
//    ids to the predicate as "/D:/.../dist-es/index.js"; the predicate then makes exactly the
//    decision it makes on POSIX. The id rollup itself uses is unchanged.
if (process.platform === "win32") {
  const cp = require("node:child_process");
  const originalSpawn = cp.spawn;
  cp.spawn = function patchedSpawn(command, args, options) {
    if (command === "yarn") {
      if (!Array.isArray(args)) {
        options = args;
        args = [];
      }
      options = { ...(options || {}), shell: true };
    }
    return originalSpawn.call(this, command, args, options);
  };

  const Module = require("node:module");
  const originalLoad = Module._load;
  let patched = false;
  Module._load = function patchedLoad(request, parent, isMain) {
    const exported = originalLoad.apply(this, arguments);
    if (request === "rollup" && !patched && exported && typeof exported.rollup === "function") {
      patched = true;
      const originalRollup = exported.rollup;
      const toPosix = (id) => (/^[A-Za-z]:[\\/]/.test(id) ? "/" + id.replace(/\\/g, "/") : id);
      exported.rollup = function patchedRollup(inputOptions, ...rest) {
        if (inputOptions && typeof inputOptions.external === "function") {
          const external = inputOptions.external;
          inputOptions = { ...inputOptions, external: (id, ...more) => external(toPosix(id), ...more) };
        }
        return originalRollup.call(this, inputOptions, ...rest);
      };
    }
    return exported;
  };
}
