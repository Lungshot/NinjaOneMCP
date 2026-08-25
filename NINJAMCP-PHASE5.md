Ja, das lässt sich ziemlich sauber ergänzen. Nach Durchsicht der aktuellen API würde ich **nicht nur "List Scripts" und "Run Script" implementieren**, sondern gleich eine kleine Script-API im MCP daraus machen.

# Implementation Specification

## Goal

Extend the existing NinjaOne MCP server with support for Automation Scripts.

The implementation shall support:

* List available automation scripts
* Retrieve scripting options for a specific device
* Execute an automation script
* Execute built-in actions
* Return execution metadata to the AI
* Future support for polling Activities/Jobs

The implementation shall integrate into the existing MCP architecture and reuse the existing OAuth client.

This phase intentionally avoids architectural refactoring. The goal is to extend the existing codebase with the minimum amount of new code required to support reliable script execution and execution tracking. Existing tool names, API client methods and project structure are considered canonical unless they are technically incorrect.

Priority:

1. Bug fixes
2. Missing NinjaOne endpoints
3. Missing MCP functionality
4. Documentation
5. Refactoring (out of scope)

---

# New API Client Methods

The MCP shall expose user-centric capabilities, not REST API endpoints. Every public tool should represent a complete user operation. Low-level NinjaOne API calls (scripting options, polling, job tracking, ID resolution, activity lookup) shall remain internal implementation details unless they are independently useful for troubleshooting.

All listed HTTP endpoints SHALL be implemented in the NinjaOne client layer. However, they SHALL NOT automatically become public MCP tools. The MCP should expose higher-level capabilities wherever possible and use the lower-level client methods internally.



## 1. List Automation Scripts

Endpoint

```http
GET /api/v2/automation/scripts
```

Purpose

Returns every Automation Script visible to the authenticated API user. ([app.ninjarmm.com][1])

Implementation

```text
async fn listAutomationScripts()
```

Return

```rust
AutomationScript {
    id: i64,
    uid: String,
    name: String,
    description: Option<String>,
    language: Option<String>,
    operatingSystem: Option<String>,
    architecture: Option<String>,
    category: Option<String>,
}
```

Cache results for approximately 5 minutes.

---

## 2. Device Scripting Options

Endpoint

```http
GET /api/v2/device/{deviceId}/scripting/options
```

Purpose

Determine which scripting options are available for the target device before execution. ([app.ninjarmm.com][1])

Implementation

```text
async fn getDeviceScriptingOptions(deviceId)
```

This should be called automatically before presenting scripts to the AI.

---

## 3. Execute Script

Endpoint

```http
POST /api/v2/device/{deviceId}/script/run
```

Body

```json
{
  "type": "SCRIPT",
  "id": 1234,
  "parameters": "...",
  "runAs": "SYSTEM"
}
```

or

```json
{
  "type": "ACTION",
  "id": 42,
  "parameters": "",
  "runAs": "SYSTEM"
}
```

`uid` is optional depending on object type. ([postman.com][2])

Implementation

```text
async fn runScript(
    deviceId,
    scriptId,
    parameters,
    runAs
)
```

---

# Request Object

```rust
RunScriptRequest {
    type_: ScriptType,

    id: i64,

    uid: Option<String>,

    parameters: String,

    runAs: String,
}
```

---

# ScriptType

```rust
enum ScriptType {

    Script,

    Action,
}
```

Serializes as

```text
SCRIPT

ACTION
```

---

# runAs

Expose exactly what the API supports.

Likely values include

```text
SYSTEM

CURRENT_USER
```

Do **not** hardcode assumptions—treat this as an enum only if the API definitively documents the values. Otherwise keep it as a string.

---

# Parameters

The API expects **one string**.

This string contains all script parameters exactly as if entered in the GUI.

Example

```text
"hello 123 true"
```

Quoted parameters are preserved.

Example

```text
"\"My User\" password123"
```

Maximum:

* 50 parameters
* 30,000 characters total ([NinjaOne][3])

---

# MCP Tools

## list_scripts

Returns

```json
[
    {
        "id":1234,
        "name":"Deploy Odoo Module",
        "os":"Linux"
    }
]
```

---

## get_device_scripting_options

Input

```json
{
    "device_id":12345
}
```

---

## run_script

Input

```json
{
    "device_id":12345,

    "script_id":678,

    "parameters":"abc def",

    "run_as":"SYSTEM"
}
```

Returns

```json
{
    "accepted":true
}
```

---

# Strong Recommendation

The AI should **never** remember numeric script IDs.

Instead:

```
Deploy Odoo Module
```

↓

MCP

↓

calls

```
list_scripts()
```

↓

finds

```
Deploy Odoo Module

ID = 4711
```

↓

calls

```
run_script()
```

That makes prompts much more natural.

---

# Future Enhancement

Add another MCP tool:

```
run_script_by_name()
```

Implementation

1. call `list_scripts()`
2. fuzzy match script name
3. if exactly one match

execute

4. otherwise

return list of candidates

Example

```
run_script_by_name(

device,

"Deploy Odoo Module"

)
```

This is the tool your AI will use almost all the time.

---

# Execution Tracking

Immediately after `run_script()` returns, the API call only indicates that execution has been accepted—it does **not** stream stdout/stderr. ([postman.com][2])

Plan a follow-up implementation:

1. `GET /api/v2/device/{id}/activities`
2. Poll every 2–3 seconds.
3. Detect the newly created script activity.
4. Return:

   * running
   * completed
   * failed
   * execution output (if exposed via Activities)

This will give the AI end-to-end visibility into script execution instead of just "fire-and-forget", and it's exactly the capability you'll need later for workflows like `deployOdooModule`, certificate renewal, or other maintenance automations.

[1]: https://app.ninjarmm.com/apidocs/ "Public API"
[2]: https://www.postman.com/ninjaone/ninjaone-api-workspace/request/sbd41l0/run-script-or-built-in-action "Run script or built-in action | NinjaOne Public API 2.0"
[3]: https://www.ninjaone.com/docs/scripting-and-automation/automation-parameters/ "NinjaOne Endpoint Management: Automation Parameters"


----------------------------------------------


# Phase 5A Addendum — Public MCP Surface Refinement

**Status:** Proposed

**Extends:** NINJAMCP-PHASE5.md

## Purpose

During implementation it became clear that the NinjaOne MCP Server should expose **AI-oriented capabilities**, not individual REST API operations.

The NinjaOne REST API and the internal API client SHALL remain comprehensive.

The public MCP interface SHALL remain intentionally compact.

This document refines the Phase 5 design without changing the underlying implementation.

---

# Design Principle

The NinjaOne API Client and the MCP Server have different responsibilities.

## NinjaOne Client

The client SHALL implement the REST API as faithfully as possible.

Examples:

* listAutomationScripts()
* getDeviceScriptingOptions()
* runDeviceScript()
* getDeviceActivities()
* getActiveJobs()
* waitForScriptResult()
* findScriptByName()

These methods are implementation details.

---

## MCP Server

The MCP Server SHALL expose user-centric capabilities.

The AI should request operations such as

> Execute the "Deploy AREP Agent" script

instead of manually orchestrating REST API calls.

The MCP SHALL therefore compose multiple NinjaOne API calls into a single user operation whenever practical.

---

# Public Tool Surface

The following tools SHALL remain public.

## list_scripts

Purpose

List all available automation scripts.

The returned information should include at least

* script id
* script name
* operating system
* category (if available)

This tool is primarily intended for discovery.

---

## execute_script

This SHALL become the primary script execution tool.

Input

```json
{
    "device_id":12345,
    "script":"Deploy AREP Agent",
    "parameters":"...",
    "confirm":false
}
```

Behavior

The MCP SHALL internally perform

1.

Resolve script name

↓

2.

Obtain scripting options if required

↓

3.

Execute script

↓

4.

Track execution

↓

5.

Return final result

The AI SHALL NOT need to manually call multiple tools.

---

## get_active_jobs

Expose active jobs for diagnostics and troubleshooting.

This tool is intentionally low-level.

Typical use cases

* debugging
* monitoring
* manual investigation
* advanced workflows

---

## get_device_activities

Expose device activities for diagnostics.

This tool is also intended primarily for troubleshooting.

---

# Internal Methods

The following methods SHALL remain internal implementation details.

They SHALL NOT normally be exposed as MCP tools.

* getDeviceScriptingOptions()
* runDeviceScript()
* getScriptResult()
* waitForScriptResult()
* findScriptByName()

These methods are composed internally by execute_script().

---

# Confirmation Pattern

execute_script SHALL follow the standard confirmation pattern used throughout the MCP server.

Example

```json
{
    "confirm":false
}
```

Response

```
DRY RUN

Would execute

Deploy AREP Agent

on

SERVER01

using

SYSTEM

Parameters

...

Re-call with confirm=true to execute.
```

Only

```json
{
    "confirm":true
}
```

may execute the script.

---

# Script Resolution

The AI SHALL never be required to remember numeric script identifiers.

execute_script SHALL accept script names.

The MCP SHALL internally

* list scripts
* perform matching
* resolve the numeric identifier
* execute the correct script

If multiple candidates exist

the MCP SHALL return the candidate list instead of executing.

---

# Job Tracking

execute_script SHALL automatically monitor the execution it initiated.

The AI SHALL receive a completed result whenever practical.

The AI SHALL NOT be required to manually invoke polling operations.

---

# Job Correlation

The implementation SHALL NOT wait for all active jobs on a device.

Production devices frequently execute unrelated jobs simultaneously.

Examples

* Windows Update
* Patch Deployment
* Backup
* Antivirus Scan
* Software Deployment
* Reboot

These jobs SHALL NOT block execute_script().

Instead

the implementation SHALL correlate only the job created by the current execution.

Preferred order

1.

Use a Job ID returned by NinjaOne.

2.

Otherwise

compare the active-job snapshot before and after execution.

3.

Only monitor the newly created matching job.

Waiting until the active job list becomes empty is explicitly prohibited.

---

# Long-Term Design

The public MCP interface should continue evolving toward user capabilities rather than REST wrappers.

Preferred examples

* execute_script
* reboot_device
* apply_os_patches
* assign_policy

Avoid exposing implementation primitives unless they are independently useful for diagnostics.

The MCP Server should remain a semantic interface optimized for AI agents rather than a direct mirror of the NinjaOne REST API.


-----------------------------------------

# Phase 5B Addendum — Implementation Alignment with Existing Codebase

**Status:** Proposed

**Extends:** NINJAMCP-PHASE5.md

---

# Purpose

This addendum aligns the Phase 5 implementation with the existing NinjaOne MCP Server codebase.

The objective is to complete missing functionality while **preserving the existing architecture, naming, and public MCP interface wherever practical.**

The implementation SHALL prefer extending existing code over introducing new abstractions.

---

# Rule 1 — Existing Public MCP Tools Are Canonical

If an equivalent public MCP tool already exists in the repository, it SHALL be extended instead of creating a new tool with a different name.

Examples:

* Keep existing public tool names.
* Do not rename tools solely for architectural preference.
* Do not introduce duplicate tools exposing the same capability.

Backward compatibility is preferred over cosmetic improvements.

---

# Rule 2 — Existing API Client Methods Are Canonical

If the NinjaOne API client already contains a method implementing an API endpoint, that method SHALL be reused.

The implementation SHALL NOT create wrappers that merely rename existing methods.

Examples:

Reuse existing methods such as:

* listAutomationScripts()
* runDeviceScript()
* getScriptResult()
* waitForScriptResult()
* getDeviceScriptingOptions()

Do not create equivalent methods with different names unless the existing implementation is technically insufficient.

---

# Rule 3 — Preserve Existing Layering

The current project structure SHALL remain.

REST API Client

↓

MCP Tool

↓

MCP Response

The implementation SHALL avoid introducing additional service layers unless they solve an actual technical problem.

---

# Rule 4 — Extend, Do Not Rewrite

When adding functionality:

* extend existing files
* extend existing switch statements
* extend existing API classes
* extend existing interfaces

Avoid moving large amounts of code.

Avoid large-scale refactoring.

Avoid renaming methods solely for consistency.

---

# Rule 5 — Jobs Support

Jobs support SHALL be added.

Purpose:

Provide reliable tracking that a script has actually started and completed.

The implementation SHALL support

GET /api/v2/device/{deviceId}/jobs

using the existing API client architecture.

The implementation SHALL expose job information as an MCP capability.

If a public tool named get_active_jobs does not already exist, it MAY be added.

Otherwise the existing tool SHALL simply be extended.

---

# Rule 6 — Script Execution Tracking

The current script execution flow SHALL remain.

Jobs SHALL augment—not replace—the existing activity polling.

Preferred flow

run script

↓

observe Jobs endpoint

↓

detect execution

↓

observe Activities endpoint

↓

return final result

Jobs answer

"Did the script actually start?"

Activities answer

"What happened?"

Both are useful and SHALL coexist.

---

# Rule 7 — Job Correlation

The implementation SHALL correlate only the job started by the current execution.

It SHALL NOT wait for unrelated jobs.

Examples of unrelated jobs

* Windows Update
* Patch Management
* Backup
* Antivirus
* Reboot
* Software Deployment

These SHALL NOT block script execution tracking.

Preferred correlation order

1. Job identifier returned by NinjaOne.

2. Otherwise compare active jobs before and after execution.

3. Otherwise correlate using the best available metadata (script, description, timestamps, activity).

---

# Rule 8 — Preserve Existing Tool Names

The implementation SHALL NOT rename existing MCP tools merely to match the documentation.

The repository is the source of truth.

Documentation SHALL adapt to the implementation—not vice versa.

---

# Rule 9 — Avoid Duplicate Logic

Before implementing any feature, the Coding AI SHALL search the repository for equivalent functionality.

If similar code already exists, it SHALL be extended.

It SHALL NOT create

* duplicate HTTP clients
* duplicate polling logic
* duplicate authentication
* duplicate wrappers
* duplicate caches
* duplicate fuzzy matching

unless a technical limitation requires it.

---

# Rule 10 — Implementation Priority

Priority order:

1. Reuse existing code.

2. Extend existing code.

3. Introduce new code only where functionality is genuinely missing.

Large refactorings, API renaming, architectural cleanups and cosmetic reorganizations are explicitly out of scope for this phase.

The goal of Phase 5 is to provide reliable script execution and execution tracking for AREP deployment with the minimum necessary code changes.
