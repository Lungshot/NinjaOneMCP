# Changelog


## v1.3.1 (2026-07-04)

### Fixed

- Fixed default `runAs` value for script execution.
- Changed default execution context from `SYSTEM` to the NinjaOne API compatible value `system`.
- Prevented `Node credential access denied` errors during script execution.
- Improved documentation and troubleshooting guidance for `runAs`.


## v1.3.0 (2026-07-04)

* Added Automation Scripts API support
* Added device Jobs API support
* Added device scripting options support
* Added high-level execute_script MCP tool
* Added ```get_active_jobs``` diagnostics tool
* Added script name resolution and fuzzy matching
* Added automatic job correlation for reliable execution tracking
* Added 5-minute automation script cache
* Improved script execution documentation
* Preserved backwards compatibility with existing script tools
