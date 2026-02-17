# MCP Agent Manager - Logical Data Flow

## Module Dependency Graph

```mermaid
%%{init: {"flowchart": {"defaultRenderer": "elk"}} }%%
graph LR
  subgraph "Entry Point"
    SI["server/index.ts<br/>main()"]
  end

  subgraph "Services"
    AR[agentRegistry<br/>singleton]
    SS[skillStore<br/>singleton]
    TR["taskRouter<br/>routeTask()"]
    AE[automationEngine<br/>singleton]
    EB[eventBus<br/>singleton]
    EL["eventLog<br/>initializeEventLog()"]
    DB["dashboard<br/>startDashboard()"]
    WM[workspaceMonitor<br/>singleton]
    WH[workspaceHistory<br/>singleton]
    LG[logger<br/>singleton]
  end

  subgraph "Providers"
    PI["providers/index<br/>registerProvider()"]
    CP["providers/copilot<br/>createCopilotProvider()"]
    AP["providers/anthropic<br/>createAnthropicProvider()"]
  end

  subgraph "Types"
    TI[types/index.ts]
    TA[types/automation.ts]
  end

  SI --> AR & SS & TR & AE & EB & EL & DB & WM
  SI --> PI --> CP & AP
  TR --> AR & SS & PI
  AE --> EB & TR & SS & AR
  EL --> EB
  DB --> AR & SS & AE & WM & WH & EB
  WM --> EB & WH

  AR -.-> TI
  SS -.-> TI
  AE -.-> TA
```

## Data Entity Relationships

```mermaid
erDiagram
  AGENT ||--o{ TASK : "executes"
  SKILL ||--o{ TASK : "defines"
  SKILL ||--o{ AUTOMATION_RULE : "triggered-by"
  AUTOMATION_RULE ||--o{ EXECUTION : "produces"
  EVENT_BUS ||--o{ EVENT : "delivers"
  EVENT ||--o{ AUTOMATION_RULE : "matches"
  WORKSPACE ||--o{ EVENT : "emits"

  AGENT {
    string id PK
    string name
    string provider
    string model
    string[] tags
    int maxConcurrency
    float costMultiplier
    string state
    int activeTasks
    int tasksCompleted
    int tasksFailed
  }

  SKILL {
    string id PK
    string name
    string promptTemplate
    string strategy
    string[] targetTags
    string[] categories
    int maxTokens
  }

  TASK {
    string taskId PK
    string skillId FK
    json params
    int priority
    string strategy
    boolean success
    int totalTokens
    float totalCost
  }

  AUTOMATION_RULE {
    string id PK
    string skillId FK
    string[] events
    json filters
    json conditions
    json throttle
    json retry
    boolean enabled
  }

  EXECUTION {
    string executionId PK
    string ruleId FK
    string status
    string triggerEvent
    json resolvedParams
    string resultSummary
    int durationMs
  }

  EVENT {
    string type
    json data
    datetime timestamp
  }

  WORKSPACE {
    string path PK
    string wsId
    int sessionCount
    string[] watchers
  }
```

## Request Processing Pipeline

```mermaid
sequenceDiagram
  participant C as MCP Client
  participant S as MCP Server
  participant SK as SkillStore
  participant TR as TaskRouter
  participant AR as AgentRegistry
  participant P as Provider
  participant EB as EventBus
  participant AE as AutomationEngine

  C->>S: mgr_assign_task(skillId, params)
  S->>SK: get(skillId)
  SK-->>S: SkillDefinition
  S->>TR: routeTask(request)

  TR->>SK: resolvePrompt(skill, params)
  SK-->>TR: resolved prompt string

  TR->>AR: resolveCandidateAgents()
  AR-->>TR: AgentInstance[]

  TR->>EB: emit task:started

  alt single strategy
    TR->>AR: recordTaskStart(agent)
    TR->>P: sendToAgent(agent, prompt)
    P-->>TR: AgentResponse
    TR->>AR: recordTaskComplete(agent)
  else fan-out strategy
    par Send to all agents
      TR->>P: sendToAgent(agent1, prompt)
      TR->>P: sendToAgent(agent2, prompt)
    end
    P-->>TR: AgentResponse[]
  end

  TR->>EB: emit task:completed
  EB->>AE: handleEvent(task:completed)
  Note over AE: Match rules, check conditions,<br/>apply throttle, maybe trigger skill

  TR-->>S: TaskResult
  S-->>C: Tool response
```

## Workspace Event Pipeline

```mermaid
sequenceDiagram
  participant FS as Filesystem
  participant GIT as Git Remote
  participant WM as WorkspaceMonitor
  participant EB as EventBus
  participant EL as EventLog
  participant AE as AutomationEngine
  participant TR as TaskRouter
  participant Agent as AI Agent

  Note over WM: fs.watch() active
  FS->>WM: File changed
  WM->>EB: workspace:file-changed

  par Log to JSONL
    EB->>EL: Append to events.jsonl
  and Match automation rules
    EB->>AE: handleEvent()
    AE->>AE: findMatchingRules()
    AE->>AE: evaluateConditions()
    AE->>AE: applyThrottle()
    AE->>TR: routeTask(security-audit)
    TR->>Agent: sendToAgent(prompt)
    Agent-->>TR: result
  end

  Note over WM: git fetch --all (periodic)
  GIT->>WM: New commits detected
  WM->>EB: workspace:git-event

  par Log to JSONL
    EB->>EL: Append to events.jsonl
  and Match automation rules
    EB->>AE: handleEvent()
    AE->>TR: routeTask(code-review)
    TR->>Agent: sendToAgent(prompt)
    Agent-->>TR: result
  end
```

## State Machine - Agent Lifecycle

```mermaid
stateDiagram-v2
  [*] --> idle : register()
  idle --> running : recordTaskStart()<br/>[tasks < maxConcurrency]
  running --> busy : recordTaskStart()<br/>[tasks >= maxConcurrency]
  busy --> running : recordTaskComplete()<br/>[tasks below maxConcurrency]
  running --> idle : recordTaskComplete()<br/>[no active tasks]
  idle --> error : setState(error)
  running --> error : setState(error)
  busy --> error : setState(error)
  error --> idle : setState(idle)
  error --> running : setState(running)
  idle --> [*] : unregister()
  running --> [*] : unregister()
  busy --> [*] : unregister()
  error --> [*] : unregister()
```

## Graceful Shutdown Sequence

```mermaid
sequenceDiagram
  participant OS as SIGINT/SIGTERM
  participant Main as main()
  participant DB as Dashboard
  participant WM as WorkspaceMonitor
  participant SRV as MCP Server

  OS->>Main: Signal received
  Main->>DB: stopDashboard()
  Main->>WM: stopAll(skipPersist=true)
  Note over WM: Stop watchers, intervals<br/>DO NOT save empty monitors
  Main->>SRV: server.close()
  Main->>Main: process.exit(0)
```

## Dashboard REST API Architecture

```mermaid
%%{init: {"flowchart": {"defaultRenderer": "elk"}} }%%
graph LR
  subgraph "Dashboard SPA :3900"
    Browser[Browser Client]
  end

  subgraph "HTTP Server"
    GET_HTML["GET /"]
    SSE_STREAM["GET /events (SSE)"]
    GET_SNAP["GET /api/snapshot"]
  end

  subgraph "REST Endpoints"
    direction TB
    SK_POST["POST /api/skills"]
    SK_PUT["PUT /api/skills/:id"]
    SK_DEL["DELETE /api/skills/:id"]
    AU_POST["POST /api/automation"]
    AU_GET["GET /api/automation/:id"]
    AU_PUT["PUT /api/automation/:id"]
    AU_DEL["DELETE /api/automation/:id"]
    AU_TOG["POST /api/automation/:id/toggle"]
    AU_TRIG["POST /api/automation/:id/trigger"]
    WS_POST["POST /api/workspaces"]
    WS_MINE["POST /api/workspaces/mine"]
    WS_DEL["DELETE /api/workspaces/:path"]
    WS_HIST["GET /api/workspaces/history"]
    EV_CLR["DELETE /api/events"]
  end

  subgraph "Backend Services"
    SS[SkillStore]
    WM[WorkspaceMonitor]
    AE[AutomationEngine]
    WH[WorkspaceHistory]
  end

  Browser --> GET_HTML & SSE_STREAM & GET_SNAP
  Browser --> SK_POST & SK_PUT & SK_DEL
  Browser --> AU_POST & AU_GET & AU_PUT & AU_DEL & AU_TOG & AU_TRIG
  Browser --> WS_POST & WS_MINE & WS_DEL & WS_HIST
  Browser --> EV_CLR

  SK_POST & SK_PUT & SK_DEL --> SS
  AU_POST & AU_GET & AU_PUT & AU_DEL & AU_TOG & AU_TRIG --> AE
  WS_POST & WS_MINE & WS_DEL --> WM
  WS_HIST --> WH
  EV_CLR --> SS
```

## Dashboard CRUD Sequence

```mermaid
sequenceDiagram
  participant B as Browser
  participant D as Dashboard API
  participant SS as SkillStore
  participant AE as AutomationEngine
  participant WM as WorkspaceMonitor
  participant WH as WorkspaceHistory

  rect rgb(40, 40, 80)
  Note over B,SS: Skills CRUD
  B->>D: POST /api/skills {id, name, prompt, strategy}
  D->>SS: register(skill)
  SS-->>D: SkillDefinition
  D-->>B: 200 {skill}

  B->>D: PUT /api/skills/:id {updates}
  D->>SS: update(id, updates)
  SS-->>D: updated SkillDefinition
  D-->>B: 200 {skill}

  B->>D: DELETE /api/skills/:id
  D->>SS: remove(id)
  D-->>B: 200 {removed: true}
  end

  rect rgb(40, 80, 40)
  Note over B,AE: Automation CRUD
  B->>D: POST /api/automation {rule}
  D->>AE: registerRule(rule)
  AE-->>D: AutomationRule
  D-->>B: 200 {rule}

  B->>D: POST /api/automation/:id/toggle {enabled}
  D->>AE: toggleRule(id, enabled)
  D-->>B: 200 {toggled: true}

  B->>D: POST /api/automation/:id/trigger {testData}
  D->>AE: triggerRule(id, testData)
  D-->>B: 200 {result}
  end

  rect rgb(80, 40, 40)
  Note over B,WH: Workspace Operations
  B->>D: POST /api/workspaces {path}
  D->>WM: startMonitoring(path)
  D-->>B: 200 {monitoring: true}

  B->>D: POST /api/workspaces/mine {path}
  D->>WM: mineSessions(path)
  D-->>B: 200 {mined: true}

  B->>D: DELETE /api/workspaces/:path
  D->>WM: stopMonitoring(path)
  D-->>B: 200 {stopped: true}

  B->>D: GET /api/workspaces/history
  D->>WH: getHistory()
  WH-->>D: WorkspaceEntry[]
  D-->>B: 200 {history}
  end
```

## Dashboard SPA Component Architecture

```mermaid
%%{init: {"flowchart": {"defaultRenderer": "elk"}} }%%
flowchart TB
  subgraph SPA["Dashboard SPA :3900"]
    direction TB
    CSS[htmlStyles.ts<br/>Dark Theme CSS]
    RENDER[htmlRenderScript.ts<br/>Client Rendering]
    ACTION[htmlActionScript.ts<br/>Client Actions]
  end

  subgraph UI["UI Sections"]
    AGENTS[Agents Panel]
    SKILLS[Skills Table + CRUD]
    TASKS[Task Results + Review]
    RULES[Automation Rules + CRUD]
    WORKSP[Workspace Monitor + CRUD]
    EVENTS[Event Log + Search + Clear]
    DEBUG[Debug Panel]
  end

  subgraph Modal["Modal System"]
    SMODAL[Skill Add/Edit Modal]
    RMODAL[Rule Add/Edit Modal]
    WMODAL[Workspace Add Modal]
  end

  subgraph Realtime["Real-time Updates"]
    SSE_C[SSE Connection]
    POLL[2s Polling Fallback]
    SNAP["GET /api/snapshot"]
  end

  SPA --> UI
  SPA --> Modal
  RENDER --> SNAP
  SSE_C & POLL --> SNAP --> RENDER
  ACTION -->|form submit| SKILLS & RULES & WORKSP
  ACTION -->|modal open| Modal
```

## Workspace History Lifecycle

```mermaid
sequenceDiagram
  participant WM as WorkspaceMonitor
  participant WH as WorkspaceHistory
  participant FS as Filesystem

  Note over WM,WH: Start Monitoring
  WM->>WH: recordStart(path, wsId)
  WH->>WH: Create entry {path, wsId, startedAt, status: active}
  WH->>FS: save workspace-history.json

  Note over WM,WH: Stop Monitoring
  alt Manual Stop
    WM->>WH: recordStop(path, reason: manual)
  else Graceful Shutdown
    WM->>WH: recordStop(path, reason: shutdown)
  else Error
    WM->>WH: recordStop(path, reason: error, detail)
  end
  WH->>WH: Update entry {stoppedAt, reason, status: stopped}
  WH->>FS: save workspace-history.json

  Note over WM,WH: Query History
  WM->>WH: getHistory(limit, status)
  WH-->>WM: WorkspaceEntry[]
```

## CDP Regression Test Suite Flow

```mermaid
%%{init: {"flowchart": {"defaultRenderer": "elk"}} }%%
flowchart TB
  subgraph Launch["Test Setup"]
    L[Launch puppeteer-core<br/>Chrome CDP]
    N[Navigate to :3900]
    O[Override fetch + EventSource]
  end

  subgraph Tests["Test Groups"]
    T1[Dashboard Load<br/>title + panels]
    T2[Skills CRUD<br/>add + edit + delete]
    T3[Rules CRUD<br/>add + edit + toggle + trigger + delete]
    T4[Workspace Ops<br/>add + mine + stop + history]
    T5[Event Log<br/>search + clear + count]
  end

  subgraph Assert["Assertions"]
    A1[API Response Checks]
    A2[DOM Element Checks]
    A3[Screenshot Capture]
    A4[Console Error Monitor]
  end

  L --> N --> O --> Tests
  T1 & T2 & T3 & T4 & T5 --> Assert
```
