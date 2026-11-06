# Observer follow-up

The retained run returned one genuine Lace API `openVoting` proof (2,933 bytes), but its observer matched zero targets and captured no prover WASM response. The run remains failed at that strict resource-observation gate. The change below does not revise its result or establish its historical root cause.

Chromium 156.0.8078.4 source exposes a concrete metadata-ordering gap in the original observer:

- [`WorkerDevToolsManager::WorkerCreated`, lines 64–68](https://github.com/chromium/chromium/blob/156.0.8078.4/content/browser/devtools/worker_devtools_manager.cc#L64) constructs a dedicated-worker target with an empty URL.
- [`DedicatedWorkerDevToolsAgentHost`, lines 26–43](https://github.com/chromium/chromium/blob/156.0.8078.4/content/browser/devtools/dedicated_worker_devtools_agent_host.cc#L26) reports target creation.
- [`WorkerOrWorkletDevToolsAgentHost::ChildWorkerCreated`, lines 55–62](https://github.com/chromium/chromium/blob/156.0.8078.4/content/browser/devtools/worker_or_worklet_devtools_agent_host.cc#L55) later assigns its URL/name without a navigation notification.
- [`TargetHandler::TargetInfoChanged`, lines 939–945](https://github.com/chromium/chromium/blob/156.0.8078.4/content/browser/devtools/protocol/target_handler.cc#L939) reports changes only for previously reported or attached targets. A type filter can therefore also miss a target whose initial classification was excluded.

The unchanged signed Lace 2.5.1 package creates `offscreen.html`, which creates the absolute worker `js/4352.js`; its public worker loads the pinned prover WASM. Its foreground fallback does not provide a separate configured local worker. These are source findings, not observations of the failed run's target URLs.

The follow-up observer refreshes public target metadata every 500 ms, with one refresh in flight and limits of 3,600 snapshots, 30 minutes and 256 classified target IDs. It retains only finite category counts. It additionally enables child-worker auto-attachment on its own session attached to the exact signed offscreen page, with `waitForDebuggerOnStart:false` and no browser-wide auto-attachment change. Only the exact signed worker is accepted; other related children are detached and cause failure.

No Runtime, Debugger, storage, interception, pause, private request-body inspection or static-file substitution is used. Nested unrelated network events are discarded before parsing their envelopes. The observer still requires an actual successful response for the exact prover WASM path, byte length and SHA-256. A capture race or unavailable response body remains a failure; complete network coverage is not claimed.

Five focused Node boundary tests passed after this change. They include late worker-URL assignment, nested session replies and rejection of unrelated request events. These transport fixtures do not generate a cryptographic proof or fabricate a successful resource observation. A fresh real CI diagnostic remains necessary.
