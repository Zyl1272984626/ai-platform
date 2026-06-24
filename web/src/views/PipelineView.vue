<template>
  <div class="pipeline-page page-container">
    <PageHeader title="开发流水线" description="多平台接力工作台：生成提示词、约定产物目录、检测阶段结果，平台本身不调用模型。">
      <button class="btn-ghost" @click="refreshAll" :disabled="refreshing">{{ refreshing ? '刷新中...' : '刷新' }}</button>
      <button class="btn-primary compact" :disabled="!canCopyCodexPrompt" @click="copyCodexPrompt">
        {{ codexCopied ? '已复制' : (baseEngine === 'claudecode' ? '复制 ClaudeCode 总控提示词' : '复制总控提示词') }}
      </button>
    </PageHeader>

    <section class="ops-strip">
      <div class="ops-item">
        <span class="ops-label">接力阶段</span>
        <strong>{{ relayPlan?.stages.length || 0 }}</strong>
      </div>
      <div class="ops-item">
        <span class="ops-label">已检测产物</span>
        <strong>{{ artifactDoneCount }}</strong>
      </div>
      <div class="ops-item">
        <span class="ops-label">运行 ID</span>
        <strong class="ops-code">{{ relayRunId || '-' }}</strong>
      </div>
      <div class="ops-item">
        <span class="ops-label">兼容历史</span>
        <strong>{{ runs.length }}</strong>
      </div>
    </section>

    <nav class="tabs">
      <button class="tab" :class="{ active: tab === 'overview' }" @click="tab = 'overview'">总览</button>
      <button class="tab" :class="{ active: tab === 'new' }" @click="tab = 'new'">新建</button>
      <button class="tab" :class="{ active: tab === 'artifacts' }" @click="tab = 'artifacts'">
        产物<span v-if="artifactRuns.length" class="pill">{{ artifactRuns.length }}</span>
      </button>
      <button v-if="runs.length" class="tab" :class="{ active: tab === 'history' }" @click="tab = 'history'">
        兼容历史<span class="pill">{{ runs.length }}</span>
      </button>
      <button class="tab" :class="{ active: tab === 'knowledge' }" @click="tab = 'knowledge'">知识图谱</button>
      <button class="tab" :class="{ active: tab === 'models' }" @click="tab = 'models'">模型</button>
      <button class="tab" :class="{ active: tab === 'trace' }" @click="tab = 'trace'">
        审计<span v-if="traceRuns.length" class="pill">{{ traceRuns.length }}</span>
      </button>
    </nav>

    <section v-if="tab === 'overview'" class="overview-grid">
      <div class="flow-console">
        <div class="console-main">
          <span class="console-kicker">当前接力状态</span>
          <h2>{{ currentStage ? currentStage.name : '等待创建接力任务' }}</h2>
          <p>{{ flowStatusText }}</p>
          <div class="flow-progress">
            <div class="flow-progress-bar" :style="{ width: flowProgressPercent + '%' }"></div>
          </div>
          <div class="flow-metrics">
            <span>{{ artifactDoneCount }}/{{ relayPlan?.stages.length || 0 }} 已生成</span>
            <span>{{ artifactQualifiedCount }}/{{ relayPlan?.stages.length || 0 }} 合格</span>
            <span>{{ flowProgressPercent }}%</span>
          </div>
        </div>
        <div class="console-action">
          <span class="next-label">下一步动作</span>
          <strong>{{ nextActionTitle }}</strong>
          <p>{{ nextActionDesc }}</p>
          <div class="console-buttons">
            <button class="btn-primary compact" :disabled="!currentStage || !activeRequirement.trim()" @click="copyCurrentStagePrompt">
              {{ copiedStageId === currentStage?.id ? '已复制当前阶段' : '复制当前阶段提示词' }}
            </button>
            <button class="btn-ghost compact" :disabled="!currentStage" @click="markCurrentStage('working')">标记执行中</button>
            <button class="btn-ghost compact" :disabled="!currentStage" @click="markCurrentStage('rework')">打回补齐</button>
            <button class="btn-ghost compact success" :disabled="!currentStage || !currentStage.exists" @click="markCurrentStage('accepted')">通过质量门</button>
            <button class="btn-ghost compact" :disabled="!relayRunId" @click="refreshArtifacts">重新扫描</button>
            <button class="btn-ghost compact" @click="tab = 'artifacts'">打开任务档案</button>
          </div>
        </div>
      </div>

      <div class="driver-panel panel wide">
        <div class="panel-head">
          <h2>阶段驾驶舱</h2>
          <span class="muted">把“复制出去执行”和“产物回写”变成可跟踪的流程态</span>
        </div>
        <div class="driver-steps">
          <div v-for="step in driverSteps" :key="step.id" class="driver-step" :class="{ active: step.active, done: step.done }">
            <span>{{ step.index }}</span>
            <div>
              <strong>{{ step.title }}</strong>
              <p>{{ step.desc }}</p>
            </div>
          </div>
        </div>
      </div>

      <div class="flow-lane panel wide">
        <div class="panel-head">
          <h2>流水线状态</h2>
          <span class="muted">按质量门推进，而不只是看文件是否存在</span>
        </div>
        <div class="lane-track">
          <div
            v-for="(stage, index) in relayStagesWithArtifacts"
            :key="stage.id"
            class="lane-step"
            :class="[laneStepClass(stage, index)]"
          >
            <span class="lane-index">{{ index + 1 }}</span>
            <strong>{{ stage.name }}</strong>
            <small>{{ laneStepText(stage, index) }}</small>
          </div>
        </div>
      </div>

      <div class="panel wide">
        <div class="panel-head">
          <h2>多平台接力编排</h2>
          <span class="muted">平台只负责提示词和产物检测</span>
        </div>
        <div class="stage-roadmap">
          <div v-for="(stage, index) in relayPlan?.stages || []" :key="stage.id" class="roadmap-card">
            <span class="roadmap-index">{{ index + 1 }}</span>
            <div>
              <strong>{{ stage.name }}</strong>
              <p>{{ stage.ownerLabel }} · {{ stage.artifactFile }}</p>
            </div>
            <span class="gate-tag">{{ stage.promptKind }}</span>
          </div>
        </div>
      </div>

      <div class="panel">
        <div class="panel-head">
          <h2>产物目录</h2>
          <button class="link-btn" :disabled="!relayRunId" @click="refreshArtifacts">检测产物</button>
        </div>
        <div class="artifact-path">
          <span>根目录</span>
          <code>{{ relayPlan?.artifactRoot || '-' }}</code>
        </div>
        <div class="artifact-path">
          <span>本次目录</span>
          <code>{{ relayPlan?.runDir || '-' }}</code>
        </div>
      </div>

      <div class="panel">
        <div class="panel-head">
          <h2>优化方向</h2>
        </div>
        <ul class="insight-list">
          <li>平台不调模型，不调 CLI，只生成各阶段提示词和统一产物路径。</li>
          <li>需求澄清后先做代码发现与影响分析，必须读取实际源码再进入设计。</li>
          <li>Codex/ChatGPT 作为总控与主设计者，基于代码发现产物出设计初稿，再根据审阅意见修订定稿。</li>
          <li>ClaudeCode/GLM 和 DeepSeek 在设计阶段负责审阅 Codex 初稿，不再平行另起最终方案。</li>
          <li>ClaudeCode/GLM 偏可实现性和重实现，DeepSeek 偏风险、边界和代码审查。</li>
          <li>外部平台把结果写入产物目录后，平台通过扫描文件判断阶段状态。</li>
        </ul>
      </div>
    </section>

    <section v-if="tab === 'new'" class="new-layout">
      <div class="panel">
        <div class="panel-head">
          <h2>接力配置</h2>
          <span class="muted">复制提示词到对应平台，产物统一写入指定目录</span>
        </div>
        <div class="form-grid">
          <label class="field">
            <span>目标项目 <b>*</b></span>
            <select v-model="selectedProjectId" :disabled="isRunning" @change="refreshRelayPlan">
              <option value="">请选择项目</option>
              <option value="__ai-platform__">本系统 (AI Platform)</option>
              <option v-for="project in projects" :key="project.id" :value="project.id">{{ project.name }}</option>
            </select>
          </label>
          <label class="field">
            <span>底座引擎</span>
            <div class="toggle-group">
              <button :class="['toggle-btn', { active: baseEngine === 'zcode' }]" @click="switchBaseEngine('zcode')">ZCode</button>
              <button :class="['toggle-btn', { active: baseEngine === 'codex' }]" @click="switchBaseEngine('codex')">CodeX</button>
              <button :class="['toggle-btn', { active: baseEngine === 'claudecode' }]" @click="switchBaseEngine('claudecode')">ClaudeCode</button>
            </div>
          </label>
          <label class="field">
            <span>接力运行 ID</span>
            <div class="path-row">
              <input v-model="relayRunId" :disabled="isRunning" @blur="refreshRelayPlan" />
              <button title="根据需求生成 ID" :disabled="!requirement.trim()" @click="generateRelayId" aria-label="生成 ID">
                <Icon :icon="IconAction.refresh" :size="14" />
              </button>
            </div>
          </label>
          <label class="field span-2">
            <span>需求描述 <b>*</b></span>
            <textarea
              v-model="requirement"
              :disabled="isRunning"
              rows="5"
              @blur="ensureRelayId"
              placeholder="例如：增加用户导出功能，支持按日期范围筛选，导出为 Excel。"
            />
          </label>
        </div>
      </div>

      <div class="handoff-panel">
        <div>
          <h2>{{ baseEngine === 'claudecode' ? 'ClaudeCode 总控' : 'Codex 总控' }}</h2>
          <p v-if="baseEngine === 'claudecode'">ClaudeCode/GLM 作为总控：负责追问需求、产出初版设计、直接实现代码。DeepSeek 负责独立审阅。</p>
          <p v-else>第一段复制给 Codex/ChatGPT：它负责追问需求、建立接力目录、决定 GLM/DeepSeek/Codex 各自下一步，而不是让平台主动调用模型。</p>
        </div>
        <div class="handoff-actions">
          <button class="btn-primary" :disabled="!canCopyCodexPrompt" @click="copyCodexPrompt">
            {{ codexCopied ? '已复制总控提示词' : (baseEngine === 'claudecode' ? '复制 ClaudeCode 总控' : '复制总控提示词') }}
          </button>
          <button class="btn-ghost" :disabled="!relayRunId" @click="refreshArtifacts">检测产物</button>
        </div>
        <span v-if="launchHint" class="launch-hint">{{ launchHint }}</span>
      </div>

      <div class="panel">
        <div class="panel-head">
          <h2>阶段接力提示词</h2>
          <button class="btn-ghost" :disabled="!requirement.trim() || copyingAll" @click="copyAllRelayPrompts">
            {{ copyingAll ? '复制中...' : '复制全部阶段' }}
          </button>
        </div>
        <div class="artifact-path run-dir">
          <span>本次产物目录</span>
          <code>{{ relayPlan?.runDir || '-' }}</code>
        </div>
        <div class="relay-grid">
          <div v-for="(stage, index) in relayStagesWithArtifacts" :key="stage.id" class="relay-card" :class="{ done: stage.exists }">
            <div class="relay-top">
              <span class="prompt-step">{{ index + 1 }}</span>
              <div>
                <strong>{{ stage.name }}</strong>
                <p>{{ stage.ownerLabel }}</p>
              </div>
              <span class="artifact-state" :class="{ ok: stage.exists }">{{ stage.exists ? '已检测' : '待产物' }}</span>
              <span class="quality-badge" :class="qualityClass(stage.quality)">{{ qualityText(stage.quality) }}</span>
              <span v-if="stage.stageMark" class="stage-mark" :class="stage.stageMark">{{ stageMarkText(stage.stageMark) }}</span>
            </div>
            <p class="relay-purpose">{{ stage.purpose }}</p>
            <ul v-if="stage.qualityIssues?.length && stage.quality !== 'ok'" class="quality-issues">
              <li v-for="issue in stage.qualityIssues.slice(0, 3)" :key="issue">{{ issue }}</li>
            </ul>
            <div class="artifact-file">
              <span>产物</span>
              <code>{{ stage.path || artifactPath(stage.artifactFile) }}</code>
            </div>
            <pre v-if="stage.preview" class="artifact-preview">{{ shortText(stage.preview, 420) }}</pre>
            <div class="relay-actions">
              <button class="btn-ghost compact" :disabled="!requirement.trim()" @click="copyRelayPrompt(stage.id)">
                {{ copiedStageId === stage.id ? '已复制' : '复制提示词' }}
              </button>
            </div>
          </div>
        </div>
      </div>

    </section>

    <section v-if="tab === 'artifacts'" class="artifact-layout">
      <div class="panel artifact-sidebar">
        <div class="panel-head">
          <h2>产物任务</h2>
          <button class="link-btn" @click="refreshArtifactRuns">刷新</button>
        </div>
        <div class="artifact-filters">
          <input class="filter-input" v-model="artifactSearch" placeholder="搜索 ID 或需求..." />
          <div class="filter-row">
            <select v-model="artifactEngineFilter" class="filter-select">
              <option value="all">全部引擎</option>
              <option value="zcode">ZCode</option>
              <option value="codex">CodeX</option>
              <option value="claudecode">ClaudeCode</option>
            </select>
            <select v-model="artifactStatusFilter" class="filter-select">
              <option value="all">全部状态</option>
              <option value="running">进行中</option>
              <option value="completed">已完成</option>
              <option value="blocked">有阻塞</option>
            </select>
          </div>
        </div>
        <div v-if="artifactRuns.length === 0" class="empty compact">暂无产物目录</div>
        <div v-else-if="filteredArtifactRuns.length === 0" class="empty compact">没有匹配的任务</div>
        <div
          v-for="run in filteredArtifactRuns"
          :key="run.runId"
          class="artifact-run"
          :class="{ active: artifactScan?.runId === run.runId }"
        >
          <button class="artifact-run-main" @click="openArtifactRun(run.runId)">
            <strong>{{ run.runId }}</strong>
            <span v-if="run.requirement">{{ shortText(run.requirement, 44) }}</span>
            <span>{{ runEngineText(run.baseEngine) }} · {{ run.completedStages }}/{{ run.totalStages }} 已生成 · {{ run.qualifiedStages || 0 }}/{{ run.totalStages }} 合格</span>
            <span><span class="run-status-tag" :class="runStatusClass(run)">{{ runStatusText(run) }}</span></span>
            <time>{{ run.updatedAt ? formatTime(run.updatedAt) : '未检测到产物' }}</time>
          </button>
          <button class="icon-action danger compact" title="删除整条任务" @click.stop="handleDeleteRelayRun(run.runId)">删除</button>
        </div>
      </div>

      <div class="panel artifact-detail">
        <div class="panel-head">
          <h2>任务档案</h2>
          <div class="artifact-actions">
            <button class="btn-ghost compact" :disabled="!artifactScan?.runId" @click="selectUnfinishedStages">选择待补齐</button>
            <button class="btn-primary compact" :disabled="!selectedArtifactStageIds.length" @click="copyContinuationPrompt">
              {{ continuationCopied ? '已复制总控' : '复制选中阶段总控' }}
            </button>
            <button class="btn-ghost compact" :disabled="!artifactScan?.runId" @click="artifactScan?.runId && openArtifactRun(artifactScan.runId)">重新检测</button>
          </div>
        </div>
        <div v-if="!artifactScan" class="empty">请选择左侧任务查看产物</div>
        <template v-else>
          <div class="artifact-path run-dir">
            <span>产物目录</span>
            <code>{{ artifactScan.runDir }}</code>
          </div>
          <div class="task-dossier">
            <div class="dossier-summary">
              <span class="console-kicker">{{ runEngineText(artifactScan.baseEngine) }} 接力任务</span>
              <h3>{{ currentArtifactRun()?.requirement ? shortText(currentArtifactRun()?.requirement, 110) : artifactScan.runId }}</h3>
              <p>{{ flowStatusText }}</p>
            </div>
            <div class="dossier-grid">
              <div>
                <span>当前阶段</span>
                <strong>{{ currentStage?.name || '未开始' }}</strong>
              </div>
              <div>
                <span>产物进度</span>
                <strong>{{ artifactDoneCount }}/{{ artifactScan.stages.length }}</strong>
              </div>
              <div>
                <span>质量门</span>
                <strong>{{ artifactQualifiedCount }}/{{ artifactScan.stages.length }}</strong>
              </div>
              <div>
                <span>待补齐</span>
                <strong>{{ blockedStageCount }}</strong>
              </div>
            </div>
          </div>
          <div v-if="currentStage" class="next-stage-card">
            <div>
              <span class="next-label">下一步</span>
              <strong>{{ nextActionTitle }}</strong>
              <p>{{ nextActionDesc }}</p>
            </div>
            <button class="btn-primary compact" @click="copyCurrentStagePrompt">
              {{ copiedStageId === currentStage.id ? '已复制' : '复制下一步提示词' }}
            </button>
          </div>
          <!-- 接力上下文：生成 CONTEXT.md（兜底）+ MCP 配置（主通道） -->
          <div class="context-sync-card" :class="{ synced: relayContextSynced }">
            <div class="context-sync-info">
              <span class="next-label">接力上下文</span>
              <p>
                {{ relayContextSynced ? '已生成 CONTEXT.md（兜底文件）。配了 MCP 后，ZCode/ClaudeCode 可自动获取本任务。' : '生成当前任务的 CONTEXT.md 到产物目录，作为 MCP 不可用时的兜底。多任务互不干扰。' }}
              </p>
              <code v-if="relayContextPath">{{ relayContextPath }}</code>
            </div>
            <div class="context-sync-actions">
              <button class="btn-primary compact" :disabled="syncingContext || !artifactScan?.runId" @click="handleSyncRelayContext">
                {{ syncingContext ? '生成中...' : (relayContextSynced ? '更新 CONTEXT.md' : '生成 CONTEXT.md') }}
              </button>
              <button class="btn-ghost compact" @click="showMcpGuide = !showMcpGuide">{{ showMcpGuide ? '收起' : 'MCP 配置' }}</button>
              <span v-if="contextSyncMsg" class="context-sync-msg">{{ contextSyncMsg }}</span>
            </div>
          </div>
          <div v-if="showMcpGuide" class="mcp-guide-card">
            <span class="next-label">MCP 配置（一次性，配完 ZCode 自动获取任务）</span>
            <p>在 <code>~/.zcode/cli/config.json</code> 的 <code>mcp.servers</code> 里加：</p>
            <pre class="mcp-config-block">"ai-platform-relay": {
  "type": "stdio",
  "command": "node",
  "args": ["C:/FengSuKeJi/ai-platform/server/dist/mcp/relay-server.js"],
  "env": { "AI_PLATFORM_BASE": "http://localhost:3100" }
}</pre>
            <p class="mcp-note">配好后 ZCode 里可直接说「读一下当前接力任务」，会自动调用 <code>get_relay_task</code>。多个任务时指定 runId 即可隔离。</p>
            <p class="mcp-note">可用工具：<code>create_relay_task</code>、<code>list_relay_tasks</code>、<code>get_relay_task</code>、<code>scan_artifacts</code>、<code>mark_stage</code>、<code>generate_stage_prompt</code>。</p>
            <div class="skill-install-row">
              <div>
                <strong>ZCode Skill（反向入口）</strong>
                <p class="mcp-note">{{ zcodeSkillInstalled ? '已安装 relay-dev Skill。重启 ZCode 后，说「启动接力任务做XX」即可触发完整流程。' : '安装后，在 ZCode 里说「启动接力任务做XX」即可反向创建任务并自动走流程，不用先来网页。' }}</p>
                <code v-if="zcodeSkillPath">{{ zcodeSkillPath }}</code>
              </div>
              <button class="btn-primary compact" :disabled="installingSkill" @click="handleInstallZcodeSkill">
                {{ installingSkill ? '安装中...' : (zcodeSkillInstalled ? '重新安装' : '安装到 ZCode') }}
              </button>
            </div>
            <span v-if="skillMsg" class="context-sync-msg">{{ skillMsg }}</span>
          </div>
          <div class="operator-strip">
            <button class="btn-ghost compact" :disabled="!currentStage" @click="markCurrentStage('working')">标记执行中</button>
            <button class="btn-ghost compact" :disabled="!currentStage" @click="markCurrentStage('rework')">打回补齐</button>
            <button class="btn-ghost compact" :disabled="!currentStage" @click="markCurrentStage('skipped')">跳过</button>
            <button class="btn-ghost compact success" :disabled="!currentStage || !currentStage.exists" @click="markCurrentStage('accepted')">通过质量门</button>
            <button class="btn-ghost compact" :disabled="!artifactScan?.runId || !currentStage" @click="selectCurrentAndCopyContinuation">当前阶段续跑总控</button>
            <button class="btn-primary compact" :disabled="!artifactScan?.runId" @click="handleGenerateReport">{{ generatingReport ? '生成中...' : '生成交付报告' }}</button>
          </div>
          <div class="relay-grid">
            <div v-for="stage in artifactScan.stages" :key="stage.id" class="relay-card" :class="{ done: stage.exists }">
              <div class="relay-top">
                <input
                  class="stage-check"
                  type="checkbox"
                  :checked="selectedArtifactStageIds.includes(stage.id)"
                  @change="toggleArtifactStage(stage.id)"
                />
                <div>
                  <strong>{{ artifactStageIndex(stage.id) }}. {{ stage.name }}</strong>
                  <p>{{ stage.ownerLabel }}</p>
                </div>
                <span class="artifact-state" :class="{ ok: stage.exists }">{{ stage.exists ? '已检测' : '待产物' }}</span>
                <span class="quality-badge" :class="qualityClass(stage.quality)">{{ qualityText(stage.quality) }}</span>
                <span v-if="stage.stageMark" class="stage-mark" :class="stage.stageMark">{{ stageMarkText(stage.stageMark) }}</span>
              </div>
              <ul v-if="stage.qualityIssues?.length && stage.quality !== 'ok'" class="quality-issues">
                <li v-for="issue in stage.qualityIssues" :key="issue">{{ issue }}</li>
              </ul>
              <div class="artifact-file">
                <span>文件</span>
                <code>{{ stage.path }}</code>
              </div>
              <pre v-if="stage.preview" class="artifact-preview">{{ shortText(stage.preview, 600) }}</pre>
              <div class="relay-actions">
                <button class="btn-ghost compact" @click="copyArtifactStagePrompt(stage.id)">
                  {{ copiedStageId === stage.id ? '已复制' : '复制本阶段提示词' }}
                </button>
                <button class="btn-ghost compact" :disabled="!stage.exists" @click="openPreviewDrawer(stage)">
                  查看产物
                </button>
                <button class="btn-ghost compact" @click="handleExportStageSkill(stage.id)">导出 SKILL</button>
                <button
                  v-if="canExecuteDeepSeek(stage)"
                  class="btn-ghost compact executor-btn"
                  :disabled="executingStageId === stage.id"
                  @click="handleExecuteDeepSeek(stage)"
                >
                  {{ executingStageId === stage.id ? '执行中...' : 'DeepSeek 执行' }}
                </button>
                <button class="btn-ghost compact danger" :disabled="!stage.exists" @click="handleDeleteRelayStage(stage.id)">删除产物</button>
              </div>
            </div>
          </div>
        </template>
      </div>
    </section>

    <section v-if="tab === 'history'" class="history-list">
      <div v-if="runs.length === 0" class="empty panel">暂无流水线执行记录</div>
      <article v-for="run in runs" :key="run.id" class="run-card">
        <div class="run-header">
          <button class="run-main" @click="toggleRun(run.id)">
            <span class="run-title">
              <StatusBadge :status="run.status" size="small" />
              <strong>{{ shortText(run.requirement, 72) || run.id }}</strong>
            </span>
            <span class="run-meta">
              <span class="run-project">{{ getProjectName(run.projectId) }}</span>
              <time>{{ formatTime(run.startedAt) }}</time>
              <span class="run-expand">{{ expandedRun === run.id ? '收起' : '展开' }}</span>
            </span>
          </button>
          <button class="icon-action danger" title="删除历史" @click.stop="deleteRun(run.id)">删除</button>
        </div>
        <div v-if="expandedRun === run.id" class="run-body">
          <StepPipeline :steps="adaptStages(run.stages)" />
          <StageDetails
            :stages="run.stages"
            :stage-defs="stageDefs"
            :expanded-index="expandedHistStage"
            @toggle="expandedHistStage = expandedHistStage === $event ? -1 : $event"
          />
          <div class="run-actions">
            <button v-if="run.status === 'paused'" class="btn-ghost success" @click.stop="confirmStage(run.id)">确认继续</button>
            <button v-if="run.status === 'failed'" class="btn-ghost" @click.stop="resumeRun(run.id)">恢复执行</button>
            <button v-if="run.status === 'paused' || run.status === 'failed' || run.status === 'running'" class="btn-ghost danger" @click.stop="abortRun(run.id)">中止</button>
            <button class="btn-ghost danger subtle" @click.stop="deleteRun(run.id)">删除历史</button>
          </div>
        </div>
      </article>
    </section>

    <section v-if="tab === 'knowledge'" class="knowledge-list">
      <div v-if="knowledge.length === 0" class="empty panel">暂无知识图谱记录</div>
      <article v-for="entry in knowledge" :key="entry.runId" class="run-card">
        <div class="run-header">
          <div class="run-title">
            <StatusBadge :status="entry.success ? 'completed' : 'failed'" size="small" />
            <strong>{{ shortText(entry.requirement, 72) || entry.runId }}</strong>
          </div>
          <time>{{ entry.completedAt ? formatTime(entry.completedAt) : '' }}</time>
        </div>
      </article>
    </section>

    <section v-if="tab === 'models'" class="models-layout">
      <div class="panel">
        <div class="panel-head">
          <h2>可用模型</h2>
          <span class="muted">{{ availableModelCount }} 个已配置</span>
        </div>
        <div class="model-grid">
          <div v-for="model in availableModels" :key="model.id" class="model-card" :class="{ off: !model.available }">
            <div class="model-top">
              <span>{{ model.provider }}</span>
              <StatusBadge :status="model.available ? 'active' : 'idle'" size="small" />
            </div>
            <strong>{{ model.name }}</strong>
            <code>{{ model.id }}</code>
          </div>
        </div>
      </div>

      <div class="panel">
        <div class="panel-head">
          <h2>DeepSeek 配置</h2>
          <span class="muted">{{ isDeepSeekReady ? '已就绪' : '未配置' }}</span>
        </div>
        <div class="form-grid">
          <label class="field">
            <span>API Key</span>
            <input v-model="deepseekForm.apiKey" type="password" placeholder="DeepSeek API Key" />
          </label>
          <label class="field">
            <span>Base URL</span>
            <input v-model="deepseekForm.baseUrl" placeholder="https://api.deepseek.com/v1" />
          </label>
          <label class="field">
            <span>模型</span>
            <input v-model="deepseekForm.model" placeholder="deepseek-chat" />
          </label>
        </div>
        <div class="config-actions">
          <button class="btn-primary compact" @click="saveModelConfig">保存配置</button>
          <span v-if="modelSaveMsg" class="save-msg" :class="modelSaveOk ? 'ok' : 'err'">{{ modelSaveMsg }}</span>
        </div>
      </div>

      <!-- 执行器开关（P2）：默认关闭，避免把平台变回伪自动化 -->
      <div class="panel">
        <div class="panel-head">
          <h2>执行器</h2>
          <span class="muted">默认关闭；开启后平台可在本机直接执行部分阶段</span>
        </div>
        <div class="executor-toggle-list">
          <label class="toggle-row">
            <div class="toggle-info">
              <strong>DeepSeek 执行器</strong>
              <p>开启后，设计审阅 / 代码审查类阶段可直接用 DeepSeek 执行，结果写入产物文件。{{ deepseekExecutorAvailable ? '' : '（需先配置上方 API Key）' }}</p>
            </div>
            <button
              class="switch"
              :class="{ on: executorConfig.deepseekEnabled }"
              :disabled="!deepseekExecutorAvailable"
              @click="toggleExecutor('deepseekEnabled', !executorConfig.deepseekEnabled)"
            >
              <span class="switch-knob"></span>
            </button>
          </label>
        </div>
        <span v-if="executorSaveMsg" class="save-msg ok">{{ executorSaveMsg }}</span>
      </div>
    </section>

    <!-- 审计 trace（P3） -->
    <section v-if="tab === 'trace'" class="trace-layout">
      <div class="panel trace-sidebar">
        <div class="panel-head">
          <h2>审计记录</h2>
          <button class="link-btn" @click="refreshTraceRuns">刷新</button>
        </div>
        <div v-if="traceRuns.length === 0" class="empty compact">暂无 trace 记录</div>
        <button
          v-for="run in traceRuns"
          :key="run.runId"
          class="trace-run-item"
          :class="{ active: traceRunId === run.runId }"
          @click="openTraceRun(run.runId)"
        >
          <strong>{{ run.runId }}</strong>
          <span>{{ run.eventCount }} 条事件 · {{ run.types.length }} 类</span>
          <span v-for="t in run.types" :key="t" class="trace-type-tag" :class="traceTypeClass(t)">{{ traceTypeText(t) }}</span>
          <time>{{ formatTime(run.lastEventAt) }}</time>
        </button>
      </div>
      <div class="panel trace-detail">
        <div class="panel-head">
          <h2>事件流</h2>
          <span class="muted">{{ traceEvents.length }} 条</span>
        </div>
        <div v-if="!traceRunId" class="empty">请选择左侧 run 查看事件</div>
        <template v-else>
          <div class="trace-decision-box">
            <span class="console-kicker">记录最终决策</span>
            <div class="trace-decision-row">
              <input v-model="finalDecisionText" placeholder="例如：已人工确认交付，准备 Pull" />
              <button class="btn-primary compact" :disabled="!finalDecisionText.trim()" @click="submitFinalDecision">记录</button>
            </div>
          </div>
          <div class="trace-timeline">
            <div v-for="evt in traceEvents" :key="evt.id" class="trace-event">
              <span class="trace-dot" :class="traceTypeClass(evt.type)"></span>
              <div class="trace-event-main">
                <div class="trace-event-head">
                  <span class="trace-type-tag" :class="traceTypeClass(evt.type)">{{ traceTypeText(evt.type) }}</span>
                  <strong>{{ evt.summary }}</strong>
                </div>
                <div class="trace-event-meta">
                  <span>{{ traceActorText(evt.actor) }}</span>
                  <time>{{ formatTime(evt.timestamp) }}</time>
                </div>
              </div>
            </div>
          </div>
        </template>
      </div>
    </section>

    <!-- 产物预览抽屉 -->
    <div v-if="previewDrawer.visible" class="preview-overlay" @click.self="closePreviewDrawer">
      <div class="preview-drawer">
        <div class="preview-head">
          <div class="preview-title">
            <span class="console-kicker">阶段产物预览</span>
            <strong>{{ previewDrawer.stageName }}</strong>
            <span class="quality-badge" :class="previewDrawer.quality || 'missing'">{{ qualityText(previewDrawer.quality as any) }}</span>
          </div>
          <div class="preview-head-actions">
            <button class="btn-ghost compact" :disabled="!previewDrawer.artifactPath" @click="copyPreviewPath">复制路径</button>
            <button class="icon-action" @click="closePreviewDrawer">关闭</button>
          </div>
        </div>
        <code class="preview-path">{{ previewDrawer.artifactPath || '-' }}</code>
        <div v-if="previewDrawer.loading" class="empty compact">加载中...</div>
        <div v-else-if="previewDrawer.error" class="empty compact">读取失败：{{ previewDrawer.error }}</div>
        <div v-else class="preview-body markdown-body" v-html="previewHtml"></div>
      </div>
    </div>

    <!-- 执行器提示 toast -->
    <div v-if="executorToast.visible" class="executor-toast" :class="executorToast.kind">
      {{ executorToast.message }}
    </div>

  </div>
</template>

<script setup lang="ts">
import { computed, defineComponent, h, onMounted, reactive, ref } from 'vue'
import StatusBadge from '../components/common/StatusBadge.vue'
import StepPipeline from '../components/workflow/StepPipeline.vue'
import PageHeader from '../components/layout/PageHeader.vue'
import Icon from '../components/ui/Icon.vue'
import { IconAction } from '../composables/icons'
import {
  abortPipeline as apiAbort,
  confirmStage as apiConfirm,
  createRelayRunId,
  deletePipelineRun as apiDeleteRun,
  deleteRelayStage,
  deleteRelayRun,
  executeDeepSeek,
  exportRelayStageSkill,
  generateDeliveryReport,
  generateContinuationPrompt,
  generatePrompt,
  generateCodexPrompt,
  generateClaudeCodePrompt,
  getExecutorConfig,
  getRelayPlan,
  getModels,
  getPipelineRun,
  getTraceEvents,
  listArtifactRuns,
  listKnowledge,
  listPipelineRuns,
  listStageDefinitions,
  listTraceRuns,
  getZcodeSkillStatus,
  installZcodeSkill,
  readRelayStageContent,
  readRelayContext,
  recordFinalDecision,
  resumePipeline as apiResume,
  runPipeline,
  scanArtifacts,
  syncRelayContext,
  updateArtifactStageMark,
  updateExecutorConfig as apiUpdateExecutorConfig,
  updateModelConfig,
} from '../api/pipelines'
import { getProjects } from '../api/projects'
import type { TestProject } from '../api/projects'
import type {
  ExecutorResult,
  ModelInfo,
  PipelineArtifactRun,
  PipelineArtifactScan,
  PipelineArtifactStage,
  PipelineRelayPlan,
  PipelineRun,
  PipelineSSEEvent,
  PipelineStageDef,
  PipelineStageRun,
  RelayExecutorConfig,
  RelayStageContent,
  RelayContextReadResult,
  StepRun,
  TraceEvent,
  TraceRun,
} from '../api/types'
import { marked } from 'marked'

const StageDetails = defineComponent({
  name: 'StageDetails',
  props: {
    stages: { type: Array as () => PipelineStageRun[], required: true },
    stageDefs: { type: Array as () => PipelineStageDef[], required: true },
    expandedIndex: { type: Number, required: true },
  },
  emits: ['toggle'],
  setup(props, { emit }) {
    function formatOutput(output: unknown) {
      if (!output) return ''
      if (typeof output === 'string') return output
      try { return JSON.stringify(output, null, 2) } catch { return String(output) }
    }

    return () => h('div', { class: 'stage-detail-list' }, props.stages.map((stage, index) => {
      const expanded = props.expandedIndex === index
      const def = props.stageDefs[index]
      return h('div', { class: ['stage-detail-item', { expanded }], key: stage.stageId }, [
        h('button', { class: 'stage-detail-header', onClick: () => emit('toggle', index) }, [
          h('span', { class: 'stage-num' }, String(index + 1)),
          h('span', { class: 'stage-name' }, def?.name || stage.stageId),
          h(StatusBadge, { status: stage.status, size: 'small' }),
          h('span', { class: 'stage-arrow' }, expanded ? '收起' : '展开'),
        ]),
        expanded ? h('div', { class: 'stage-detail-body' }, [
          stage.output && Object.keys(stage.output).length
            ? h('div', { class: 'detail-block' }, [
              h('span', { class: 'detail-label' }, '输出'),
              h('pre', formatOutput(stage.output)),
            ])
            : null,
          stage.error
            ? h('div', { class: 'detail-block error' }, [
              h('span', { class: 'detail-label' }, '错误'),
              h('pre', stage.error),
            ])
            : null,
          h('div', { class: 'detail-meta' }, [
            stage.startedAt ? h('span', `开始 ${new Date(stage.startedAt).toLocaleString('zh-CN')}`) : null,
            stage.finishedAt ? h('span', `结束 ${new Date(stage.finishedAt).toLocaleString('zh-CN')}`) : null,
          ]),
        ]) : null,
      ])
    }))
  },
})

const tab = ref<'overview' | 'new' | 'artifacts' | 'history' | 'knowledge' | 'models' | 'trace'>('overview')
const refreshing = ref(false)
const stageDefs = ref<PipelineStageDef[]>([])
const runs = ref<PipelineRun[]>([])
const knowledge = ref<any[]>([])
const projects = ref<TestProject[]>([])
const artifactRuns = ref<PipelineArtifactRun[]>([])
const expandedRun = ref<string | null>(null)
const expandedStage = ref(-1)
const expandedHistStage = ref(-1)

const selectedProjectId = ref('__ai-platform__')
const requirement = ref('')
const baseEngine = ref<'codex' | 'claudecode' | 'zcode'>('zcode')
const relayRunId = ref('')
const relayPlan = ref<PipelineRelayPlan | null>(null)
const artifactScan = ref<PipelineArtifactScan | null>(null)

const isRunning = ref(false)
const currentRun = ref<PipelineRun | null>(null)
const liveLogs = ref<Array<{ type: string; text: string; time: string }>>([])
const copiedIndex = ref<number | null>(null)
const copiedStageId = ref<string | null>(null)
const copyingAll = ref(false)
const codexCopied = ref(false)
const continuationCopied = ref(false)
const selectedArtifactStageIds = ref<string[]>([])
// 产物侧栏搜索 + 筛选
const artifactSearch = ref('')
const artifactEngineFilter = ref<'all' | 'codex' | 'claudecode' | 'zcode'>('all')
const artifactStatusFilter = ref<'all' | 'running' | 'completed' | 'blocked'>('all')
// 产物预览抽屉
const previewDrawer = reactive({
  visible: false,
  loading: false,
  error: '',
  runId: '',
  stageId: '',
  stageName: '',
  quality: '' as '' | 'missing' | 'weak' | 'ok',
  artifactPath: '',
  content: '',
})
type StageMark = 'working' | 'rework' | 'accepted' | 'skipped'
const availableModels = ref<ModelInfo[]>([])
const isDeepSeekReady = ref(false)
const deepseekForm = reactive({ apiKey: '', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' })
const modelSaveMsg = ref('')
const modelSaveOk = ref(false)
const relaySessionStorageKey = 'pipeline:last-relay-session'
// 执行器（P2）
const executorConfig = ref<RelayExecutorConfig>({ deepseekEnabled: false, deepseekMaxTokens: 4096 })
const deepseekExecutorAvailable = ref(false)
const executorSaveMsg = ref('')
const executorSaveOk = ref(false)
const executingStageId = ref<string | null>(null)
const executorToast = reactive({ visible: false, kind: '' as 'ok' | 'err', message: '' })
// Trace（P3）
const traceRuns = ref<TraceRun[]>([])
const traceEvents = ref<TraceEvent[]>([])
const traceRunId = ref('')
const finalDecisionText = ref('')
// 接力上下文：生成产物目录 CONTEXT.md（多任务隔离，MCP 是主通道，CONTEXT.md 是兜底）
const relayContextSynced = ref(false)
const relayContextPath = ref('')
const syncingContext = ref(false)
const contextSyncMsg = ref('')
const showMcpGuide = ref(false)
const generatingReport = ref(false)
const zcodeSkillInstalled = ref(false)
const zcodeSkillPath = ref('')
const installingSkill = ref(false)
const skillMsg = ref('')

let pollTimer: ReturnType<typeof setInterval> | null = null

const canLaunch = computed(() => !!selectedProjectId.value && !!requirement.value.trim() && !isRunning.value)
const canCopyCodexPrompt = computed(() => !!selectedProjectId.value && !!requirement.value.trim())
const artifactDoneCount = computed(() => artifactScan.value?.stages.filter(stage => stage.exists).length || 0)
const artifactQualifiedCount = computed(() => artifactScan.value?.stages.filter(stage => isStagePassed(stage)).length || 0)
const blockedStageCount = computed(() => artifactScan.value?.stages.filter(stage => !isStagePassed(stage)).length || relayPlan.value?.stages.length || 0)
const currentStage = computed(() => {
  const stages = relayStagesWithArtifacts.value
  return stages.find(stage => !isStagePassed(stage)) || stages[stages.length - 1] || null
})
const currentStageIndex = computed(() => {
  if (!currentStage.value) return -1
  return relayStagesWithArtifacts.value.findIndex(stage => stage.id === currentStage.value?.id)
})
const activeRequirement = computed(() => currentArtifactRun()?.requirement || requirement.value || '')
const flowProgressPercent = computed(() => {
  const total = relayPlan.value?.stages.length || artifactScan.value?.stages.length || 0
  if (!total) return 0
  return Math.round((artifactQualifiedCount.value / total) * 100)
})
const flowStatusText = computed(() => {
  const total = relayPlan.value?.stages.length || artifactScan.value?.stages.length || 0
  if (!total) return '先输入需求并生成接力运行 ID，流水线会围绕统一产物目录推进。'
  if (artifactQualifiedCount.value === total) return '全部阶段已通过质量门，可以进入最终审阅、Pull 和交付确认。'
  if (!currentStage.value) return '等待扫描产物目录，确认当前阶段。'
  if (!currentStage.value.exists) return `当前卡在第 ${currentStageIndex.value + 1} 阶段：还没有检测到 ${currentStage.value.artifactFile}。`
  return `当前卡在第 ${currentStageIndex.value + 1} 阶段：产物已生成，但质量门仍需补强。`
})
const nextActionTitle = computed(() => {
  if (!currentStage.value) return '创建接力任务'
  if (!currentStage.value.exists) return `执行 ${currentStage.value.name}`
  if (currentStage.value.quality !== 'ok') return `补强 ${currentStage.value.name}`
  return '准备最终交付'
})
const nextActionDesc = computed(() => {
  if (!currentStage.value) return '输入需求后复制总控提示词，让执行平台开始追问和建立产物目录。'
  if (!currentStage.value.exists) return `复制本阶段提示词到 ${currentStage.value.ownerLabel}，并要求它写入 ${currentStage.value.artifactFile}。`
  if (currentStage.value.quality !== 'ok') return `根据质量门提示补齐：${(currentStage.value.qualityIssues || []).slice(0, 2).join('；') || '补充证据和下一步建议'}。`
  return '所有关键阶段已合格，检查最终交付摘要并准备 Pull。'
})
const driverSteps = computed(() => {
  const stage = currentStage.value
  const mark = stage ? currentStageMark(stage.id) : undefined
  return [
    {
      id: 'prompt',
      index: 1,
      title: '生成提示词',
      desc: stage ? `复制给 ${stage.ownerLabel}` : '先创建接力任务',
      done: !!stage && !!activeRequirement.value.trim(),
      active: !!stage && !mark && !stage.exists,
    },
    {
      id: 'external',
      index: 2,
      title: '外部执行',
      desc: mark === 'working' ? '执行中' : '等待复制到执行平台',
      done: !!stage && stage.exists,
      active: mark === 'working',
    },
    {
      id: 'artifact',
      index: 3,
      title: '产物回写',
      desc: stage?.artifactFile || '等待产物路径',
      done: !!stage?.exists,
      active: !!stage && !stage.exists && mark === 'working',
    },
    {
      id: 'gate',
      index: 4,
      title: '质量门',
      desc: stage?.quality === 'ok' ? '已合格' : '等待补齐证据',
      done: stage?.quality === 'ok' || mark === 'accepted',
      active: !!stage?.exists && stage.quality !== 'ok',
    },
  ]
})
const availableModelCount = computed(() => availableModels.value.filter(model => model.available).length)
const relayStagesWithArtifacts = computed(() => {
  const scanned = new Map((artifactScan.value?.stages || []).map(stage => [stage.id, stage]))
  return (relayPlan.value?.stages || []).map(stage => scanned.get(stage.id) || {
    ...stage,
    path: artifactPath(stage.artifactFile),
    exists: false,
    size: 0,
    quality: 'missing' as const,
    qualityIssues: ['未检测到阶段产物'],
  })
})
const launchHint = computed(() => {
  if (!selectedProjectId.value) return '请选择目标项目'
  if (!requirement.value.trim()) return '请输入需求描述'
  return ''
})

onMounted(async () => {
  await refreshAll()
  restoreRelaySession()
  await refreshRelayPlan()
})

function saveRelaySession() {
  if (!relayRunId.value) return
  const run = artifactRuns.value.find(item => item.runId === relayRunId.value)
  localStorage.setItem(relaySessionStorageKey, JSON.stringify({
    runId: relayRunId.value,
    requirement: run?.requirement || requirement.value,
    projectId: run?.projectId || selectedProjectId.value,
    baseEngine: run?.baseEngine || baseEngine.value,
  }))
}

function restoreRelaySession() {
  let saved: { runId?: string; requirement?: string; projectId?: string; baseEngine?: 'codex' | 'claudecode' } | null = null
  try {
    saved = JSON.parse(localStorage.getItem(relaySessionStorageKey) || 'null')
  } catch {
    saved = null
  }
  const run = artifactRuns.value.find(item => item.runId === saved?.runId) || artifactRuns.value[0]
  if (!run && !saved?.runId) return
  relayRunId.value = run?.runId || saved?.runId || ''
  requirement.value = run?.requirement || saved?.requirement || requirement.value
  if (run?.projectId || saved?.projectId) selectedProjectId.value = run?.projectId || saved?.projectId || selectedProjectId.value
  if (run?.baseEngine || saved?.baseEngine) baseEngine.value = run?.baseEngine || saved?.baseEngine || baseEngine.value
}

async function refreshAll() {
  refreshing.value = true
  try {
    const [stages, runList, knowledgeList, models, projectList, artifactRunList, executorCfg, traceRunList] = await Promise.all([
      listStageDefinitions(),
      listPipelineRuns(),
      listKnowledge(),
      getModels(),
      getProjects(),
      listArtifactRuns(),
      getExecutorConfig(),
      listTraceRuns(),
    ])
    stageDefs.value = stages
    runs.value = runList
    knowledge.value = knowledgeList
    availableModels.value = models.models
    isDeepSeekReady.value = models.models.find((model: ModelInfo) => model.id === 'deepseek-chat')?.available || false
    if (models.config?.deepseek) {
      deepseekForm.baseUrl = models.config.deepseek.baseUrl
      deepseekForm.model = models.config.deepseek.model
    }
    projects.value = (projectList as any)?.data || projectList
    artifactRuns.value = artifactRunList
    executorConfig.value = executorCfg.config
    deepseekExecutorAvailable.value = executorCfg.deepseekAvailable
    traceRuns.value = traceRunList
    await refreshZcodeSkillStatus()
  } finally {
    refreshing.value = false
  }
}

async function refreshArtifactRuns() {
  artifactRuns.value = await listArtifactRuns()
}

async function openArtifactRun(runId: string) {
  relayRunId.value = runId
  artifactScan.value = await scanArtifacts(runId)
  if (artifactScan.value.baseEngine) baseEngine.value = artifactScan.value.baseEngine
  relayPlan.value = await getRelayPlan(runId, artifactScan.value.baseEngine || baseEngine.value)
  selectUnfinishedStages()
  await refreshArtifactRuns()
  await refreshRelayContextStatus()
  saveRelaySession()
}

async function refreshRelayPlan() {
  relayPlan.value = await getRelayPlan(relayRunId.value || undefined, baseEngine.value)
  if (!relayRunId.value) relayRunId.value = relayPlan.value.runId
  if (relayRunId.value) await refreshArtifacts()
}

async function refreshArtifacts() {
  if (!relayRunId.value) return
  artifactScan.value = await scanArtifacts(relayRunId.value)
  if (relayPlan.value) {
    relayPlan.value = {
      ...relayPlan.value,
      artifactRoot: artifactScan.value.artifactRoot,
      runDir: artifactScan.value.runDir,
      runId: artifactScan.value.runId,
    }
  }
  await refreshArtifactRuns()
}

async function ensureRelayId() {
  if (!relayRunId.value && requirement.value.trim()) {
    await generateRelayId()
  }
}

async function generateRelayId() {
  if (!requirement.value.trim()) return
  const result = await createRelayRunId(requirement.value, selectedProjectId.value === '__ai-platform__' ? undefined : selectedProjectId.value, baseEngine.value)
  relayRunId.value = result.runId
  await refreshRelayPlan()
  await refreshArtifactRuns()
  saveRelaySession()
}

function artifactPath(file: string) {
  const base = relayPlan.value?.runDir || ''
  return base ? `${base}/${file}` : file
}

function artifactStageIndex(stageId: string) {
  const index = relayPlan.value?.stages.findIndex(stage => stage.id === stageId) ?? -1
  return index >= 0 ? index + 1 : ''
}

function selectUnfinishedStages() {
  selectedArtifactStageIds.value = artifactScan.value?.stages
    .filter(stage => !stage.exists || stage.quality !== 'ok')
    .map(stage => stage.id) || []
}

function toggleArtifactStage(stageId: string) {
  selectedArtifactStageIds.value = selectedArtifactStageIds.value.includes(stageId)
    ? selectedArtifactStageIds.value.filter(id => id !== stageId)
    : [...selectedArtifactStageIds.value, stageId]
}

/** 侧栏筛选后的运行列表（搜索 + 引擎 + 状态，AND 叠加） */
const filteredArtifactRuns = computed(() => {
  const keyword = artifactSearch.value.trim().toLowerCase()
  return artifactRuns.value.filter(run => {
    if (keyword) {
      const haystack = `${run.runId} ${run.requirement || ''}`.toLowerCase()
      if (!haystack.includes(keyword)) return false
    }
    if (artifactEngineFilter.value !== 'all') {
      if ((run.baseEngine || 'codex') !== artifactEngineFilter.value) return false
    }
    if (artifactStatusFilter.value !== 'all') {
      const total = run.totalStages || 0
      const qualified = run.qualifiedStages || 0
      const completed = run.completedStages || 0
      const rework = run.reworkStages || 0
      const isCompleted = total > 0 && qualified >= total
      const isBlocked = rework > 0 || completed < total
      if (artifactStatusFilter.value === 'completed' && !isCompleted) return false
      if (artifactStatusFilter.value === 'blocked' && !isBlocked) return false
      if (artifactStatusFilter.value === 'running' && (isCompleted || completed === 0)) return false
    }
    return true
  })
})

function runStatusText(run: PipelineArtifactRun) {
  const total = run.totalStages || 0
  const qualified = run.qualifiedStages || 0
  const completed = run.completedStages || 0
  if (total > 0 && qualified >= total) return '已完成'
  if (completed === 0) return '未开始'
  if ((run.reworkStages || 0) > 0) return '有阻塞'
  return '进行中'
}

function runStatusClass(run: PipelineArtifactRun) {
  const text = runStatusText(run)
  if (text === '已完成') return 'completed'
  if (text === '有阻塞') return 'blocked'
  if (text === '未开始') return 'idle'
  return 'running'
}

async function handleDeleteRelayRun(runId: string) {
  if (!window.confirm(`确定删除整条接力任务「${runId}」？\n这将删除该目录下所有阶段产物和 manifest，无法恢复。`)) return
  try {
    await deleteRelayRun(runId)
    if (artifactScan.value?.runId === runId) artifactScan.value = null
    if (relayRunId.value === runId) {
      relayRunId.value = ''
      localStorage.removeItem(relaySessionStorageKey)
    }
    await refreshArtifactRuns()
  } catch (e: any) {
    window.alert('删除任务失败: ' + e.message)
  }
}

async function handleDeleteRelayStage(stageId: string) {
  const runId = artifactScan.value?.runId
  if (!runId) return
  if (!window.confirm('确定删除该阶段产物？删除后可重新生成，但已写入的内容会丢失。')) return
  try {
    await deleteRelayStage(runId, stageId)
    if (previewDrawer.visible && previewDrawer.stageId === stageId) closePreviewDrawer()
    await refreshArtifacts()
    await refreshArtifactRuns()
  } catch (e: any) {
    window.alert('删除阶段产物失败: ' + e.message)
  }
}

async function openPreviewDrawer(stage: PipelineArtifactStage) {
  const runId = artifactScan.value?.runId
  if (!runId) return
  previewDrawer.visible = true
  previewDrawer.loading = true
  previewDrawer.error = ''
  previewDrawer.runId = runId
  previewDrawer.stageId = stage.id
  previewDrawer.stageName = stage.name
  previewDrawer.quality = stage.quality
  previewDrawer.artifactPath = stage.path
  previewDrawer.content = ''
  try {
    const result: RelayStageContent = await readRelayStageContent(runId, stage.id)
    previewDrawer.content = result.content
  } catch (e: any) {
    previewDrawer.error = e.message || '读取产物失败'
  } finally {
    previewDrawer.loading = false
  }
}

function closePreviewDrawer() {
  previewDrawer.visible = false
  previewDrawer.content = ''
  previewDrawer.error = ''
}

const previewHtml = computed(() => {
  if (!previewDrawer.content) return ''
  try {
    return marked.parse(previewDrawer.content, { async: false }) as string
  } catch {
    return `<pre>${escapeHtml(previewDrawer.content)}</pre>`
  }
})

function escapeHtml(text: string) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

async function copyPreviewPath() {
  if (!previewDrawer.artifactPath) return
  try {
    await navigator.clipboard.writeText(previewDrawer.artifactPath)
  } catch {
    // 复制失败静默处理
  }
}

async function handleExportStageSkill(stageId: string) {
  try {
    const result = await exportRelayStageSkill(stageId, artifactScan.value?.baseEngine || baseEngine.value)
    const blob = new Blob([result.content], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = result.filename
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  } catch (e: any) {
    window.alert('导出 SKILL 失败: ' + e.message)
  }
}

function currentArtifactRun() {
  return artifactRuns.value.find(run => run.runId === artifactScan.value?.runId)
}

function currentStageMark(stageId: string) {
  return relayStagesWithArtifacts.value.find(stage => stage.id === stageId)?.stageMark
}

function isStagePassed(stage: { quality: 'missing' | 'weak' | 'ok'; stageMark?: StageMark }) {
  return stage.quality === 'ok' || stage.stageMark === 'accepted' || stage.stageMark === 'skipped'
}

async function markCurrentStage(mark: StageMark) {
  if (!currentStage.value) return
  if (!relayRunId.value && !artifactScan.value?.runId) return
  try {
    const runId = artifactScan.value?.runId || relayRunId.value
    await updateArtifactStageMark(runId, currentStage.value.id, mark)
    await refreshArtifacts()
    await refreshArtifactRuns()
    saveRelaySession()
  } catch (e: any) {
    window.alert('更新阶段状态失败: ' + e.message)
  }
}

async function copyCurrentStagePrompt() {
  if (!currentStage.value) return
  if (artifactScan.value?.runId) {
    await copyArtifactStagePrompt(currentStage.value.id)
  } else {
    await copyRelayPrompt(currentStage.value.id)
  }
}

async function selectCurrentAndCopyContinuation() {
  if (!currentStage.value) return
  selectedArtifactStageIds.value = [currentStage.value.id]
  await copyContinuationPrompt()
}

function qualityText(quality?: 'missing' | 'weak' | 'ok') {
  const map = {
    missing: '缺失',
    weak: '需补强',
    ok: '合格',
  }
  return map[quality || 'missing']
}

function qualityClass(quality?: 'missing' | 'weak' | 'ok') {
  return quality || 'missing'
}

function stageMarkText(mark?: StageMark) {
  const map: Record<StageMark, string> = {
    working: '执行中',
    rework: '已打回',
    accepted: '人工通过',
    skipped: '已跳过',
  }
  return mark ? map[mark] : ''
}

function runEngineText(engine?: 'codex' | 'claudecode' | 'zcode') {
  if (engine === 'zcode') return 'ZCode'
  return engine === 'claudecode' ? 'ClaudeCode' : 'CodeX'
}

function laneStepClass(stage: { exists: boolean; quality: 'missing' | 'weak' | 'ok'; stageMark?: StageMark }, index: number) {
  if (isStagePassed(stage)) return 'passed'
  if (index === currentStageIndex.value) return 'current'
  if (stage.exists) return 'weak'
  return 'pending'
}

function laneStepText(stage: { exists: boolean; quality: 'missing' | 'weak' | 'ok'; stageMark?: StageMark }, index: number) {
  if (stage.stageMark === 'accepted') return '人工通过'
  if (stage.stageMark === 'working') return '执行中'
  if (stage.stageMark === 'rework') return '已打回'
  if (stage.quality === 'ok') return '已通过'
  if (index === currentStageIndex.value && !stage.exists) return '当前待执行'
  if (index === currentStageIndex.value) return '当前待补强'
  if (stage.exists) return '需补强'
  return '未开始'
}

function adaptStages(stages: PipelineStageRun[]): StepRun[] {
  return stages.map(stage => ({
    stepId: stageDefs.value.find(def => def.id === stage.stageId)?.name || stage.stageId,
    status: stage.status,
    output: stage.output,
    error: stage.error,
    attempts: 0,
  }))
}

function formatTime(iso?: string) {
  if (!iso) return ''
  return new Date(iso).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

function shortText(text = '', length = 60) {
  return text.length > length ? `${text.slice(0, length)}...` : text
}

function getProjectName(id?: string) {
  if (!id || id === '__ai-platform__') return '本系统'
  return projects.value.find(project => project.id === id)?.name || id
}

function openHistoryRun(id: string) {
  expandedRun.value = id
  expandedHistStage.value = -1
  tab.value = 'history'
}

function toggleRun(id: string) {
  expandedRun.value = expandedRun.value === id ? null : id
  expandedHistStage.value = -1
}

function pushLog(type: string, text: string) {
  liveLogs.value.push({
    type,
    text,
    time: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
  })
}

async function copyStagePrompt(index: number) {
  const stage = stageDefs.value[index]
  if (!stage || !requirement.value.trim()) return
  try {
    const result = await generatePrompt(stage.id, requirement.value, selectedProjectId.value || undefined)
    await navigator.clipboard.writeText(result.prompt)
    copiedIndex.value = index
    setTimeout(() => { copiedIndex.value = null }, 1600)
  } catch (e: any) {
    window.alert('生成提示词失败: ' + e.message)
  }
}

async function copyRelayPrompt(stageId: string) {
  if (!requirement.value.trim()) return
  await ensureRelayId()
  try {
    const result = await generatePrompt(
      stageId,
      requirement.value,
      selectedProjectId.value === '__ai-platform__' ? undefined : selectedProjectId.value,
      relayRunId.value,
      'relay',
      baseEngine.value,
    )
    if (result.runId && result.runId !== relayRunId.value) relayRunId.value = result.runId
    await navigator.clipboard.writeText(result.prompt)
    copiedStageId.value = stageId
    setTimeout(() => { copiedStageId.value = null }, 1600)
    await refreshRelayPlan()
  } catch (e: any) {
    window.alert('生成接力提示词失败: ' + e.message)
  }
}

async function copyArtifactStagePrompt(stageId: string) {
  if (!artifactScan.value?.runId) return
  const run = currentArtifactRun()
  const req = run?.requirement || requirement.value || '请先读取已有产物，恢复本次需求上下文。'
  try {
    const result = await generatePrompt(
      stageId,
      req,
      run?.projectId,
      artifactScan.value.runId,
      'relay',
      artifactScan.value.baseEngine || run?.baseEngine || baseEngine.value,
    )
    await navigator.clipboard.writeText(result.prompt)
    copiedStageId.value = stageId
    setTimeout(() => { copiedStageId.value = null }, 1600)
  } catch (e: any) {
    window.alert('生成阶段提示词失败: ' + e.message)
  }
}

async function copyContinuationPrompt() {
  if (!artifactScan.value?.runId || !selectedArtifactStageIds.value.length) return
  const run = currentArtifactRun()
  try {
    const result = await generateContinuationPrompt(
      artifactScan.value.runId,
      selectedArtifactStageIds.value,
      run?.requirement || requirement.value || undefined,
      run?.projectId,
    )
    await navigator.clipboard.writeText(result.prompt)
    continuationCopied.value = true
    setTimeout(() => { continuationCopied.value = false }, 1800)
  } catch (e: any) {
    window.alert('生成继续执行总控提示词失败: ' + e.message)
  }
}

async function copyAllPrompts() {
  if (!requirement.value.trim()) return
  copyingAll.value = true
  try {
    const parts: string[] = []
    for (let index = 0; index < stageDefs.value.length; index++) {
      const stage = stageDefs.value[index]
      const result = await generatePrompt(stage.id, requirement.value, selectedProjectId.value || undefined)
      parts.push(`======== 第 ${index + 1} 阶段: ${stage.name} (${stage.id}) ========\n\n${result.prompt}`)
    }
    const fullText = `# 自动开发流水线提示词\n\n## 需求\n${requirement.value}\n\n${parts.join('\n\n')}`
    await navigator.clipboard.writeText(fullText)
  } catch (e: any) {
    window.alert('生成提示词失败: ' + e.message)
  } finally {
    copyingAll.value = false
  }
}

async function copyAllRelayPrompts() {
  if (!requirement.value.trim()) return
  await ensureRelayId()
  copyingAll.value = true
  try {
    const parts: string[] = []
    for (const stage of relayPlan.value?.stages || []) {
      const result = await generatePrompt(
        stage.id,
        requirement.value,
        selectedProjectId.value === '__ai-platform__' ? undefined : selectedProjectId.value,
        relayRunId.value,
        'relay',
        baseEngine.value,
      )
      parts.push(`======== ${stage.name} / ${stage.ownerLabel} ========\n\n${result.prompt}`)
    }
    await navigator.clipboard.writeText(parts.join('\n\n'))
  } catch (e: any) {
    window.alert('生成接力提示词失败: ' + e.message)
  } finally {
    copyingAll.value = false
  }
}

async function copyCodexPrompt() {
  if (!canCopyCodexPrompt.value) return
  await ensureRelayId()
  try {
    const projectId = selectedProjectId.value === '__ai-platform__' ? undefined : selectedProjectId.value
    const result = baseEngine.value === 'claudecode'
      ? await generateClaudeCodePrompt(requirement.value, projectId, relayRunId.value)
      : await generateCodexPrompt(requirement.value, projectId, relayRunId.value)
    await navigator.clipboard.writeText(result.prompt)
    codexCopied.value = true
    setTimeout(() => { codexCopied.value = false }, 1800)
  } catch (e: any) {
    window.alert('生成总控提示词失败: ' + e.message)
  }
}

function startNewPipeline() {
  if (!canLaunch.value) return
  isRunning.value = true
  liveLogs.value = []
  currentRun.value = null
  expandedStage.value = -1
  tab.value = 'new'

  const projectId = selectedProjectId.value === '__ai-platform__' ? undefined : selectedProjectId.value
  const { promise } = runPipeline(requirement.value, projectId, handlePipelineEvent)
  promise.catch((e: any) => {
    pushLog('error', '启动失败: ' + e.message)
    isRunning.value = false
    stopPolling()
  })
}

function handlePipelineEvent(event: PipelineSSEEvent) {
  if (event.type === 'pipeline:start') {
    currentRun.value = {
      id: event.runId || '',
      requirement: requirement.value,
      projectId: selectedProjectId.value,
      status: 'running',
      stages: stageDefs.value.map(stage => ({
        stageId: stage.id,
        status: 'pending',
        input: {},
        output: {},
      })),
      context: {},
      startedAt: new Date().toISOString(),
      currentStageIndex: 0,
    }
    pushLog('info', '流水线已启动')
    if (event.runId) startPolling(event.runId)
  }

  if (event.type === 'stage:start') {
    const index = event.index ?? 0
    if (currentRun.value?.stages[index]) {
      currentRun.value.stages[index].status = 'running'
      currentRun.value.currentStageIndex = index
    }
    pushLog('info', `阶段 ${index + 1}: ${event.name || event.stageId} 开始`)
  }

  if (event.type === 'stage:done') {
    const index = event.index ?? 0
    const status = event.status === 'success' ? 'success' : 'failed'
    if (currentRun.value?.stages[index]) {
      currentRun.value.stages[index].status = status
      if (event.output) currentRun.value.stages[index].output = event.output
      if (event.error) currentRun.value.stages[index].error = event.error
    }
    pushLog(status === 'success' ? 'success' : 'error', `阶段 ${event.stageId} ${status === 'success' ? '完成' : '失败'}`)
  }

  if (event.type === 'stage:gate') {
    const index = event.index ?? 0
    if (currentRun.value?.stages[index]) currentRun.value.stages[index].status = 'waiting_confirm'
    pushLog('warn', `阶段 ${event.stageId} 等待人工确认`)
  }

  if (event.type === 'pipeline:done') {
    if (currentRun.value) currentRun.value.status = 'completed'
    pushLog('success', '流水线已完成')
    stopPolling()
    finishPipeline()
  }

  if (event.type === 'pipeline:failed') {
    if (currentRun.value) currentRun.value.status = 'failed'
    pushLog('error', `流水线失败: ${event.error || ''}`)
    stopPolling()
    finishPipeline()
  }
}

function startPolling(runId: string) {
  stopPolling()
  pollTimer = setInterval(async () => {
    try {
      const run = await getPipelineRun(runId)
      if (!run || !currentRun.value) return
      currentRun.value.status = run.status
      currentRun.value.currentStageIndex = run.currentStageIndex
      run.stages.forEach((src, index) => {
        const dst = currentRun.value?.stages[index]
        if (!dst) return
        if (dst.status !== src.status) {
          pushLog(statusLogType(src.status), `阶段 ${stageDefs.value[index]?.name || src.stageId}: ${statusText(src.status)}`)
        }
        dst.status = src.status
        if (src.output && Object.keys(src.output).length) dst.output = src.output
        if (src.error) dst.error = src.error
      })
      if (['completed', 'failed', 'aborted'].includes(run.status)) {
        stopPolling()
        finishPipeline()
      }
    } catch {
      // Polling is a fallback channel; transient failures can be ignored.
    }
  }, 5000)
}

function statusLogType(status: string) {
  if (status === 'success') return 'success'
  if (status === 'failed') return 'error'
  if (status === 'waiting_confirm') return 'warn'
  return 'info'
}

function statusText(status: string) {
  const map: Record<string, string> = {
    pending: '待执行',
    running: '执行中',
    success: '完成',
    failed: '失败',
    waiting_confirm: '等待确认',
    skipped: '已跳过',
  }
  return map[status] || status
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}

async function finishPipeline() {
  isRunning.value = false
  await refreshAll()
}

async function confirmStage(runId: string) {
  try {
    await apiConfirm(runId)
    runs.value = await listPipelineRuns()
  } catch (e: any) {
    window.alert('操作失败: ' + e.message)
  }
}

async function abortRun(runId: string) {
  if (!window.confirm('确定中止此流水线？')) return
  try {
    await apiAbort(runId)
    runs.value = await listPipelineRuns()
  } catch (e: any) {
    window.alert('操作失败: ' + e.message)
  }
}

async function deleteRun(runId: string) {
  if (!window.confirm('确定删除这条流水线历史记录？')) return
  try {
    await apiDeleteRun(runId)
    runs.value = runs.value.filter(run => run.id !== runId)
    if (expandedRun.value === runId) expandedRun.value = null
    if (currentRun.value?.id === runId) {
      currentRun.value = null
      isRunning.value = false
      stopPolling()
    }
  } catch (e: any) {
    window.alert('删除失败: ' + e.message)
  }
}

async function resumeRun(runId: string) {
  try {
    const { promise } = apiResume(runId, (event: PipelineSSEEvent) => {
      pushLog('info', `[恢复] ${event.type}`)
    })
    await promise
    runs.value = await listPipelineRuns()
  } catch (e: any) {
    window.alert('恢复失败: ' + e.message)
  }
}

async function switchBaseEngine(engine: 'codex' | 'claudecode' | 'zcode') {
  baseEngine.value = engine
  relayRunId.value = ''
  localStorage.removeItem(relaySessionStorageKey)
  await refreshRelayPlan()
}

async function saveModelConfig() {
  try {
    await updateModelConfig({
      apiKey: deepseekForm.apiKey,
      baseUrl: deepseekForm.baseUrl,
      model: deepseekForm.model,
    })
    modelSaveMsg.value = '配置已保存'
    modelSaveOk.value = true
    const models = await getModels()
    availableModels.value = models.models
    isDeepSeekReady.value = models.models.find((model: ModelInfo) => model.id === 'deepseek-chat')?.available || false
    setTimeout(() => { modelSaveMsg.value = '' }, 3000)
  } catch (e: any) {
    modelSaveMsg.value = '保存失败: ' + e.message
    modelSaveOk.value = false
  }
}

// ========== 执行器（P2） ==========

async function refreshExecutorConfig() {
  try {
    const result = await getExecutorConfig()
    executorConfig.value = result.config
    deepseekExecutorAvailable.value = result.deepseekAvailable
  } catch {
    // 执行器配置读取失败不阻断页面
  }
}

async function toggleExecutor(key: 'deepseekEnabled', value: boolean) {
  // 开启 DeepSeek 前校验 apiKey
  if (value && key === 'deepseekEnabled' && !deepseekExecutorAvailable.value) {
    window.alert('DeepSeek 执行器需要先在上方配置 API Key')
    return
  }
  try {
    const result = await apiUpdateExecutorConfig({ [key]: value })
    executorConfig.value = result.config
    executorSaveMsg.value = value ? '已开启' : '已关闭'
    executorSaveOk.value = true
    setTimeout(() => { executorSaveMsg.value = '' }, 2000)
  } catch (e: any) {
    window.alert('更新执行器开关失败: ' + e.message)
  }
}

function canExecuteDeepSeek(stage: PipelineArtifactStage) {
  return executorConfig.value.deepseekEnabled
    && deepseekExecutorAvailable.value
    && (stage.promptKind === 'design' || stage.promptKind === 'review')
}

async function handleExecuteDeepSeek(stage: PipelineArtifactStage) {
  const runId = artifactScan.value?.runId
  if (!runId) return
  if (!window.confirm(`用 DeepSeek 执行「${stage.name}」？\n将读取前序产物作为输入，结果写入 ${stage.artifactFile}。`)) return
  executingStageId.value = stage.id
  showExecutorToast('info', `正在用 DeepSeek 执行 ${stage.name}...`)
  try {
    const run = currentArtifactRun()
    const result: ExecutorResult = await executeDeepSeek(
      runId,
      stage.id,
      run?.requirement || requirement.value || '',
      artifactScan.value?.baseEngine || baseEngine.value,
    )
    if (result.ok) {
      showExecutorToast('ok', `DeepSeek 执行成功，耗时 ${(result.durationMs / 1000).toFixed(1)}s，产物已写入`)
      await refreshArtifacts()
      await refreshArtifactRuns()
    } else {
      showExecutorToast('err', `执行失败：${result.error || '未知错误'}`)
    }
  } catch (e: any) {
    showExecutorToast('err', '执行失败: ' + e.message)
  } finally {
    executingStageId.value = null
  }
}

function showExecutorToast(kind: 'ok' | 'err' | 'info', message: string) {
  executorToast.kind = kind === 'info' ? 'ok' : kind
  executorToast.message = message
  executorToast.visible = true
  setTimeout(() => { executorToast.visible = false }, kind === 'info' ? 1500 : 4000)
}

// ========== Trace（P3） ==========

async function refreshTraceRuns() {
  try {
    traceRuns.value = await listTraceRuns()
  } catch {
    traceRuns.value = []
  }
}

async function openTraceRun(runId: string) {
  traceRunId.value = runId
  try {
    const result = await getTraceEvents(runId)
    traceEvents.value = result.events
  } catch {
    traceEvents.value = []
  }
}

function traceTypeText(type: string) {
  const map: Record<string, string> = {
    'prompt-generated': '提示词生成',
    'stage-mark-changed': '标记变更',
    'executor-called': '执行器调用',
    'artifact-dependency': '产物依赖',
    'final-decision': '最终决策',
  }
  return map[type] || type
}

function traceTypeClass(type: string) {
  const map: Record<string, string> = {
    'prompt-generated': 'prompt',
    'stage-mark-changed': 'mark',
    'executor-called': 'executor',
    'artifact-dependency': 'dependency',
    'final-decision': 'decision',
  }
  return map[type] || type
}

function traceActorText(actor: string) {
  const map: Record<string, string> = { platform: '平台', user: '人工', executor: '执行器' }
  return map[actor] || actor
}

async function submitFinalDecision() {
  if (!traceRunId.value || !finalDecisionText.value.trim()) return
  try {
    await recordFinalDecision(traceRunId.value, finalDecisionText.value.trim())
    finalDecisionText.value = ''
    await openTraceRun(traceRunId.value)
    await refreshTraceRuns()
  } catch (e: any) {
    window.alert('记录决策失败: ' + e.message)
  }
}

// ========== 接力上下文同步（写进 AGENTS.md） ==========

async function refreshRelayContextStatus() {
  const runId = relayRunId.value || artifactScan.value?.runId
  if (!runId) {
    relayContextSynced.value = false
    relayContextPath.value = ''
    return
  }
  try {
    const result: RelayContextReadResult = await readRelayContext(runId)
    relayContextSynced.value = result.synced
    relayContextPath.value = result.contextPath
  } catch {
    relayContextSynced.value = false
  }
}

async function handleSyncRelayContext() {
  const runId = relayRunId.value || artifactScan.value?.runId
  if (!runId) {
    window.alert('请先生成或选择接力运行 ID')
    return
  }
  syncingContext.value = true
  contextSyncMsg.value = ''
  try {
    await syncRelayContext(runId)
    relayContextSynced.value = true
    contextSyncMsg.value = '已生成 CONTEXT.md（兜底）。配了 MCP 后 ZCode 可自动获取任务'
    await refreshRelayContextStatus()
    setTimeout(() => { contextSyncMsg.value = '' }, 5000)
  } catch (e: any) {
    window.alert('生成 CONTEXT.md 失败: ' + e.message)
  } finally {
    syncingContext.value = false
  }
}

async function handleGenerateReport() {
  const runId = artifactScan.value?.runId || relayRunId.value
  if (!runId) return
  generatingReport.value = true
  try {
    const result = await generateDeliveryReport(runId)
    showExecutorToast('ok', `交付报告已生成：${result.reportPath}`)
    await refreshArtifacts()
  } catch (e: any) {
    window.alert('生成交付报告失败: ' + e.message)
  } finally {
    generatingReport.value = false
  }
}

async function refreshZcodeSkillStatus() {
  try {
    const result = await getZcodeSkillStatus()
    zcodeSkillInstalled.value = result.installed
    zcodeSkillPath.value = result.path
  } catch {
    zcodeSkillInstalled.value = false
  }
}

async function handleInstallZcodeSkill() {
  installingSkill.value = true
  skillMsg.value = ''
  try {
    const result = await installZcodeSkill()
    zcodeSkillInstalled.value = result.installed
    zcodeSkillPath.value = result.path
    skillMsg.value = '已安装。重启 ZCode 后，说「启动接力任务做XX」即可触发流程'
    setTimeout(() => { skillMsg.value = '' }, 5000)
  } catch (e: any) {
    window.alert('安装 Skill 失败: ' + e.message)
  } finally {
    installingSkill.value = false
  }
}

</script>

<style scoped>
.config-actions,
.run-actions,
.launch-panel {
  display: flex;
  align-items: center;
  gap: 10px;
}
.ops-strip {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
  margin-bottom: 18px;
}
.ops-item {
  background: #fff;
  border: 1px solid #e8edf3;
  border-radius: 8px;
  padding: 14px 16px;
}
.ops-label {
  display: block;
  color: #7a8494;
  font-size: 12px;
  margin-bottom: 6px;
}
.ops-item strong {
  font-size: 24px;
  color: #182033;
}
.ops-item .ops-code {
  display: block;
  overflow: hidden;
  font-size: 14px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tabs {
  display: flex;
  gap: 4px;
  border-bottom: 1px solid #e8edf3;
  margin-bottom: 18px;
}
.tab {
  border: none;
  background: transparent;
  padding: 11px 18px;
  color: #667085;
  border-bottom: 2px solid transparent;
  cursor: pointer;
  font-size: 14px;
}
.tab.active {
  color: #2563eb;
  border-bottom-color: #2563eb;
  font-weight: 600;
}
.pill {
  margin-left: 6px;
  padding: 1px 6px;
  border-radius: 9px;
  background: #eef4ff;
  color: #2563eb;
  font-size: 11px;
}
.overview-grid,
.models-layout {
  display: grid;
  grid-template-columns: 1.4fr 1fr;
  gap: 16px;
}
.flow-console {
  grid-column: 1 / -1;
  display: grid;
  grid-template-columns: minmax(0, 1.35fr) minmax(280px, 0.65fr);
  gap: 16px;
  border: 1px solid #d7e3f8;
  border-radius: 8px;
  background: #f8fbff;
  padding: 18px;
}
.console-main h2,
.dossier-summary h3 {
  margin: 4px 0 8px;
  color: #182033;
  font-size: 22px;
}
.console-main p,
.console-action p,
.dossier-summary p,
.next-stage-card p {
  margin: 0;
  color: #475467;
  font-size: 13px;
  line-height: 1.6;
}
.console-kicker,
.next-label {
  color: #2563eb;
  font-size: 12px;
  font-weight: 700;
}
.flow-progress {
  overflow: hidden;
  height: 10px;
  margin: 16px 0 8px;
  border-radius: 999px;
  background: #e8edf3;
}
.flow-progress-bar {
  height: 100%;
  border-radius: inherit;
  background: #2563eb;
  transition: width 0.2s ease;
}
.flow-metrics,
.console-buttons {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.flow-metrics span {
  color: #667085;
  font-size: 12px;
}
.console-action {
  display: flex;
  flex-direction: column;
  gap: 8px;
  border-left: 1px solid #d7e3f8;
  padding-left: 16px;
}
.console-action strong {
  color: #182033;
  font-size: 16px;
}
.flow-lane {
  grid-column: 1 / -1;
}
.driver-panel {
  grid-column: 1 / -1;
}
.driver-steps {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
}
.driver-step {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 8px;
  align-items: start;
  border: 1px solid #e8edf3;
  border-radius: 8px;
  background: #fbfcfe;
  padding: 12px;
}
.driver-step > span {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: #f2f4f7;
  color: #667085;
  font-size: 11px;
  font-weight: 700;
}
.driver-step strong {
  display: block;
  color: #182033;
  font-size: 13px;
  margin-bottom: 3px;
}
.driver-step p {
  margin: 0;
  color: #667085;
  font-size: 12px;
  line-height: 1.45;
}
.driver-step.done {
  border-color: #9edcc2;
  background: #f7fcf9;
}
.driver-step.done > span {
  background: #dcfae6;
  color: #087443;
}
.driver-step.active {
  border-color: #9ec5ff;
  background: #eef4ff;
}
.driver-step.active > span {
  background: #2563eb;
  color: #fff;
}
.lane-track {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 10px;
}
.lane-step {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 4px 8px;
  align-items: center;
  border: 1px solid #e8edf3;
  border-radius: 8px;
  background: #fbfcfe;
  padding: 10px;
}
.lane-index {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: #f2f4f7;
  color: #667085;
  font-size: 11px;
  font-weight: 700;
}
.lane-step strong {
  overflow: hidden;
  color: #182033;
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.lane-step small {
  grid-column: 2;
  color: #98a2b3;
  font-size: 11px;
}
.lane-step.passed {
  border-color: #9edcc2;
  background: #f7fcf9;
}
.lane-step.passed .lane-index {
  background: #dcfae6;
  color: #087443;
}
.lane-step.current {
  border-color: #9ec5ff;
  background: #eef4ff;
}
.lane-step.current .lane-index {
  background: #2563eb;
  color: #fff;
}
.lane-step.weak {
  border-color: #fedf89;
  background: #fffaeb;
}
.new-layout,
.history-list,
.knowledge-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.artifact-layout {
  display: grid;
  grid-template-columns: minmax(260px, 0.8fr) minmax(0, 2fr);
  gap: 16px;
  align-items: start;
}
.artifact-sidebar {
  position: sticky;
  top: 16px;
}
.artifact-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: flex-end;
}
.task-dossier {
  display: grid;
  grid-template-columns: minmax(0, 1.2fr) minmax(320px, 0.8fr);
  gap: 16px;
  border: 1px solid #e8edf3;
  border-radius: 8px;
  background: #fbfcfe;
  padding: 16px;
  margin-bottom: 14px;
}
.dossier-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}
.dossier-grid div {
  border: 1px solid #eef1f5;
  border-radius: 8px;
  background: #fff;
  padding: 10px;
}
.dossier-grid span {
  display: block;
  margin-bottom: 4px;
  color: #98a2b3;
  font-size: 12px;
}
.dossier-grid strong {
  color: #182033;
  font-size: 16px;
}
.next-stage-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  border: 1px solid #d7e3f8;
  border-radius: 8px;
  background: #f8fbff;
  padding: 14px;
  margin-bottom: 14px;
}
.next-stage-card strong {
  display: block;
  margin: 4px 0;
  color: #182033;
}
.operator-strip {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  border: 1px solid #e8edf3;
  border-radius: 8px;
  background: #fff;
  padding: 10px;
  margin-bottom: 14px;
}
.stage-check {
  width: 18px;
  height: 18px;
  margin: 0;
}
.empty.compact {
  padding: 18px;
}
.panel,
.run-card {
  background: #fff;
  border: 1px solid #e8edf3;
  border-radius: 8px;
  padding: 18px;
}
.handoff-panel {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  background: #f6fbf8;
  border: 1px solid #bfe8d1;
  border-radius: 8px;
  padding: 18px;
}
.handoff-panel h2 {
  margin: 0 0 6px;
  color: #063f2a;
  font-size: 16px;
}
.handoff-panel p {
  margin: 0;
  color: #32604b;
  font-size: 13px;
  line-height: 1.6;
}
.handoff-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
}
.panel.wide {
  grid-row: span 2;
}
.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
}
.panel-head h2 {
  margin: 0;
  font-size: 15px;
  color: #182033;
}
.muted {
  color: #98a2b3;
  font-size: 12px;
}
.stage-roadmap,
.prompt-grid,
.model-grid,
.relay-grid {
  display: grid;
  gap: 10px;
}
.stage-roadmap {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}
.roadmap-card,
.prompt-card,
.mini-run,
.model-card {
  border: 1px solid #eef1f5;
  border-radius: 8px;
  background: #fbfcfe;
}
.roadmap-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px;
}
.roadmap-index,
.prompt-step,
.stage-num {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  background: #e8f5f0;
  color: #087443;
  font-size: 12px;
  font-weight: 700;
  flex-shrink: 0;
}
.roadmap-card p,
.prompt-card p {
  margin: 3px 0 0;
  color: #98a2b3;
  font-size: 12px;
}
.gate-tag {
  margin-left: auto;
  color: #b45309;
  background: #fff7ed;
  border: 1px solid #fed7aa;
  padding: 2px 7px;
  border-radius: 5px;
  font-size: 11px;
}
.mini-run {
  display: grid;
  grid-template-columns: auto 1fr auto;
  gap: 8px;
  align-items: center;
  padding: 10px;
  cursor: pointer;
}
.mini-run span {
  min-width: 0;
  color: #344054;
  font-size: 13px;
}
.mini-run time,
.run-meta,
.detail-meta {
  color: #98a2b3;
  font-size: 12px;
}
.insight-list {
  margin: 0;
  padding-left: 18px;
  color: #475467;
  font-size: 13px;
  line-height: 1.7;
}
.form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}
.toggle-group {
  display: flex;
  gap: 0;
  border: 1px solid #d0d5dd;
  border-radius: 8px;
  overflow: hidden;
}
.toggle-btn {
  flex: 1;
  padding: 8px 16px;
  border: none;
  background: #fff;
  color: #344054;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s ease;
}
.toggle-btn + .toggle-btn {
  border-left: 1px solid #d0d5dd;
}
.toggle-btn.active {
  background: #182033;
  color: #fff;
}
.toggle-btn:not(.active):hover {
  background: #f9fafb;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  color: #344054;
  font-size: 13px;
  font-weight: 600;
}
.field b {
  color: #d92d20;
}
.span-2 {
  grid-column: span 2;
}
select,
input,
textarea {
  width: 100%;
  border: 1px solid #d0d5dd;
  border-radius: 8px;
  padding: 9px 11px;
  font: inherit;
  color: #182033;
  background: #fff;
}
textarea {
  resize: vertical;
  min-height: 110px;
}
select:focus,
input:focus,
textarea:focus {
  outline: none;
  border-color: #2563eb;
  box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.12);
}
.path-row {
  display: flex;
  gap: 8px;
}
.path-row button {
  width: 38px;
  border: 1px solid #d0d5dd;
  border-radius: 8px;
  background: #fff;
  cursor: pointer;
}
.check-row {
  display: flex;
  align-items: center;
  gap: 8px;
  color: #344054;
  font-size: 13px;
}
.check-row input {
  width: auto;
}
.check-row em {
  color: #d92d20;
  font-style: normal;
  font-size: 12px;
}
.prompt-grid,
.model-grid {
  grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
}
.relay-grid {
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
}
.relay-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  border: 1px solid #e8edf3;
  border-radius: 8px;
  background: #fbfcfe;
  padding: 14px;
}
.relay-card.done {
  border-color: #9edcc2;
  background: #f7fcf9;
}
.relay-top {
  display: grid;
  grid-template-columns: auto 1fr auto auto auto;
  align-items: center;
  gap: 10px;
}
.relay-top strong {
  color: #182033;
  font-size: 14px;
}
.relay-top p,
.relay-purpose {
  margin: 0;
  color: #667085;
  font-size: 12px;
  line-height: 1.5;
}
.relay-purpose {
  min-height: 36px;
}
.artifact-state {
  padding: 2px 7px;
  border-radius: 999px;
  background: #f2f4f7;
  color: #667085;
  font-size: 11px;
  white-space: nowrap;
}
.artifact-state.ok {
  background: #dcfae6;
  color: #087443;
}
.quality-badge {
  padding: 2px 7px;
  border-radius: 999px;
  border: 1px solid transparent;
  font-size: 11px;
  white-space: nowrap;
}
.quality-badge.ok {
  border-color: #9edcc2;
  background: #ecfdf3;
  color: #067647;
}
.quality-badge.weak {
  border-color: #fedf89;
  background: #fffaeb;
  color: #b54708;
}
.quality-badge.missing {
  border-color: #e4e7ec;
  background: #f9fafb;
  color: #667085;
}
.stage-mark {
  padding: 2px 7px;
  border-radius: 999px;
  border: 1px solid transparent;
  font-size: 11px;
  white-space: nowrap;
}
.stage-mark.working {
  border-color: #bfdbfe;
  background: #eff6ff;
  color: #1d4ed8;
}
.stage-mark.rework {
  border-color: #fecaca;
  background: #fff1f2;
  color: #be123c;
}
.stage-mark.accepted {
  border-color: #bbf7d0;
  background: #f0fdf4;
  color: #15803d;
}
.stage-mark.skipped {
  border-color: #e4e7ec;
  background: #f9fafb;
  color: #98a2b3;
}
.quality-issues {
  margin: -2px 0 0;
  padding-left: 18px;
  color: #b54708;
  font-size: 12px;
  line-height: 1.55;
}
.artifact-path,
.artifact-file {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.artifact-path {
  margin-bottom: 10px;
}
.artifact-path.run-dir {
  margin-bottom: 14px;
}
.artifact-path span,
.artifact-file span {
  color: #98a2b3;
  font-size: 12px;
}
.artifact-path code,
.artifact-file code {
  overflow: hidden;
  border: 1px solid #e8edf3;
  border-radius: 7px;
  background: #fff;
  color: #344054;
  padding: 7px 9px;
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.artifact-preview {
  max-height: 130px;
}
.relay-actions {
  display: flex;
  justify-content: flex-end;
}
.prompt-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px;
}
.prompt-card > div {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 0 9px;
}
.prompt-card p {
  grid-column: 2;
}
.btn-primary,
.btn-ghost,
.link-btn {
  border-radius: 8px;
  cursor: pointer;
  font: inherit;
}
.btn-primary {
  border: none;
  background: #2563eb;
  color: #fff;
  padding: 11px 24px;
  font-weight: 600;
}
.btn-primary.compact {
  padding: 8px 16px;
  font-size: 13px;
}
.btn-ghost {
  border: 1px solid #d0d5dd;
  background: #fff;
  color: #344054;
  padding: 8px 14px;
}
.btn-ghost.compact {
  padding: 6px 10px;
  font-size: 12px;
}
.btn-ghost.success {
  color: #087443;
  border-color: #9edcc2;
}
.btn-ghost.danger {
  color: #d92d20;
  border-color: #f3b8b0;
}
.link-btn {
  border: none;
  background: transparent;
  color: #2563eb;
  padding: 4px 0;
}
button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.launch-panel {
  justify-content: flex-start;
}
.launch-hint {
  color: #b45309;
  font-size: 13px;
}
.run-summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 6px;
  color: #344054;
}
.stage-detail-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 12px;
}
.stage-detail-item {
  border: 1px solid #eef1f5;
  border-radius: 8px;
  overflow: hidden;
}
.stage-detail-header {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  border: none;
  background: #fbfcfe;
  padding: 10px 12px;
  cursor: pointer;
  text-align: left;
}
.stage-name {
  flex: 1;
  color: #344054;
  font-weight: 600;
}
.stage-arrow {
  color: #98a2b3;
  font-size: 12px;
}
.stage-detail-body {
  padding: 12px;
  border-top: 1px solid #eef1f5;
}
.detail-block {
  display: flex;
  flex-direction: column;
  gap: 5px;
  margin-bottom: 10px;
}
.detail-label {
  color: #667085;
  font-size: 12px;
}
pre {
  margin: 0;
  max-height: 240px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
  background: #f7f9fc;
  border-radius: 8px;
  padding: 10px;
  color: #344054;
  font-size: 12px;
}
.detail-block.error pre {
  background: #fff1f0;
  color: #b42318;
}
.detail-meta {
  display: flex;
  gap: 14px;
}
.log-box {
  max-height: 320px;
  overflow: auto;
  background: #111827;
  border-radius: 8px;
  padding: 12px;
}
.log-line {
  display: flex;
  gap: 10px;
  padding: 3px 0;
  color: #cbd5e1;
  font-family: Consolas, monospace;
  font-size: 12px;
}
.log-line time {
  color: #64748b;
  flex-shrink: 0;
}
.log-line.success { color: #86efac; }
.log-line.error { color: #fca5a5; }
.log-line.warn { color: #fcd34d; }
.log-line.info { color: #93c5fd; }
.run-card {
  padding: 0;
  overflow: hidden;
}
.run-header {
  display: flex;
  align-items: stretch;
  gap: 10px;
  padding: 0;
}
.run-main {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-width: 0;
  padding: 14px 18px;
  border: 0;
  background: transparent;
  text-align: left;
  cursor: pointer;
}
.run-main:hover {
  background: #fbfcfe;
}
.run-title {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.run-title strong {
  min-width: 0;
  overflow: hidden;
  color: #344054;
  font-size: 14px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.run-meta {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-shrink: 0;
  color: #98a2b3;
  font-size: 12px;
}
.run-project {
  padding: 2px 7px;
  border-radius: 5px;
  background: #eef4ff;
  color: #2563eb;
}
.run-expand {
  color: #667085;
}
.icon-action {
  align-self: center;
  margin-right: 12px;
  padding: 6px 10px;
  border: 1px solid #e8edf3;
  border-radius: 7px;
  background: #fff;
  color: #667085;
  cursor: pointer;
  font-size: 12px;
}
.icon-action:hover {
  border-color: #cfd7e3;
  background: #f8fafc;
}
.icon-action.danger {
  border-color: #f3b8b0;
  color: #d92d20;
}
.icon-action.danger:hover {
  background: #fff1f0;
}
.btn-ghost.subtle {
  background: #fff;
}
.run-body {
  padding: 0 18px 16px;
  border-top: 1px solid #eef1f5;
}
.model-card {
  padding: 14px;
}
.model-card.off {
  opacity: 0.56;
}
.model-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}
.model-top span {
  color: #667085;
  font-size: 11px;
  text-transform: uppercase;
}
.model-card strong {
  display: block;
  color: #182033;
  margin-bottom: 5px;
}
.model-card code {
  color: #667085;
  font-size: 12px;
}
.save-msg {
  font-size: 13px;
}
.save-msg.ok {
  color: #087443;
}
.save-msg.err {
  color: #d92d20;
}
.empty {
  color: #98a2b3;
  text-align: center;
  padding: 36px;
  font-size: 14px;
}
/* 产物侧栏筛选 */
.artifact-filters {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 12px;
}
.filter-input,
.filter-select {
  width: 100%;
  border: 1px solid #d0d5dd;
  border-radius: 8px;
  padding: 8px 10px;
  font: inherit;
  font-size: 13px;
  color: #182033;
  background: #fff;
}
.filter-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}
.artifact-run {
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: center;
  gap: 4px 8px;
  border: 1px solid #eef1f5;
  border-radius: 8px;
  background: #fbfcfe;
  padding: 10px 12px;
}
.artifact-run + .artifact-run {
  margin-top: 8px;
}
.artifact-run.active {
  border-color: #9ec5ff;
  background: #eef4ff;
}
.artifact-run-main {
  display: grid;
  gap: 4px;
  border: none;
  background: transparent;
  padding: 0;
  text-align: left;
  cursor: pointer;
  min-width: 0;
}
.artifact-run-main strong {
  color: #182033;
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.artifact-run-main span,
.artifact-run-main time {
  color: #667085;
  font-size: 12px;
}
.run-status-tag {
  display: inline-block;
  padding: 1px 7px;
  border-radius: 999px;
  font-size: 11px;
  border: 1px solid transparent;
}
.run-status-tag.running {
  border-color: #bfdbfe;
  background: #eff6ff;
  color: #1d4ed8;
}
.run-status-tag.completed {
  border-color: #9edcc2;
  background: #ecfdf3;
  color: #067647;
}
.run-status-tag.blocked {
  border-color: #fecaca;
  background: #fff1f2;
  color: #be123c;
}
.run-status-tag.idle {
  border-color: #e4e7ec;
  background: #f9fafb;
  color: #667085;
}
.icon-action.compact {
  padding: 4px 8px;
  font-size: 11px;
  margin-right: 0;
}
/* 执行器开关 */
.executor-toggle-list {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.toggle-row {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 14px;
  align-items: center;
  border: 1px solid #eef1f5;
  border-radius: 8px;
  background: #fbfcfe;
  padding: 14px;
}
.toggle-info strong {
  display: block;
  color: #182033;
  font-size: 14px;
  margin-bottom: 4px;
}
.toggle-info p {
  margin: 0;
  color: #667085;
  font-size: 12px;
  line-height: 1.55;
}
.switch {
  width: 46px;
  height: 26px;
  border-radius: 999px;
  border: none;
  background: #d0d5dd;
  position: relative;
  cursor: pointer;
  transition: background 0.15s ease;
  flex-shrink: 0;
}
.switch:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.switch.on {
  background: #2563eb;
}
.switch-knob {
  position: absolute;
  top: 3px;
  left: 3px;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: #fff;
  transition: transform 0.15s ease;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.15);
}
.switch.on .switch-knob {
  transform: translateX(20px);
}
/* 执行器按钮 */
.executor-btn {
  color: #6d28d9;
  border-color: #ddd6fe;
}
.build-btn-group {
  display: inline-flex;
  gap: 6px;
  flex-wrap: wrap;
}
/* 执行器 toast */
.executor-toast {
  position: fixed;
  bottom: 24px;
  right: 24px;
  z-index: 1100;
  border-radius: 8px;
  padding: 12px 18px;
  color: #fff;
  font-size: 13px;
  box-shadow: 0 6px 20px rgba(16, 24, 40, 0.18);
  max-width: 420px;
}
.executor-toast.ok {
  background: #087443;
}
.executor-toast.err {
  background: #b42318;
}
/* 审计 trace */
.trace-layout {
  display: grid;
  grid-template-columns: minmax(260px, 0.8fr) minmax(0, 2fr);
  gap: 16px;
  align-items: start;
}
.trace-sidebar {
  position: sticky;
  top: 16px;
}
.trace-run-item {
  display: grid;
  gap: 4px;
  width: 100%;
  border: 1px solid #eef1f5;
  border-radius: 8px;
  background: #fbfcfe;
  padding: 10px 12px;
  text-align: left;
  cursor: pointer;
}
.trace-run-item + .trace-run-item {
  margin-top: 8px;
}
.trace-run-item.active {
  border-color: #9ec5ff;
  background: #eef4ff;
}
.trace-run-item strong {
  color: #182033;
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.trace-run-item span,
.trace-run-item time {
  color: #667085;
  font-size: 12px;
}
.trace-type-tag {
  display: inline-block;
  padding: 1px 7px;
  border-radius: 999px;
  font-size: 11px;
  border: 1px solid transparent;
  margin-right: 4px;
}
.trace-type-tag.prompt { border-color: #bfdbfe; background: #eff6ff; color: #1d4ed8; }
.trace-type-tag.mark { border-color: #fedf89; background: #fffaeb; color: #b54708; }
.trace-type-tag.executor { border-color: #ddd6fe; background: #f5f3ff; color: #6d28d9; }
.trace-type-tag.dependency { border-color: #a7f3d0; background: #ecfdf5; color: #047857; }
.trace-type-tag.decision { border-color: #9edcc2; background: #ecfdf3; color: #067647; }
.trace-decision-box {
  border: 1px solid #d7e3f8;
  border-radius: 8px;
  background: #f8fbff;
  padding: 12px;
  margin-bottom: 14px;
}
.trace-decision-row {
  display: flex;
  gap: 8px;
  margin-top: 8px;
}
.trace-decision-row input {
  flex: 1;
}
.trace-timeline {
  display: flex;
  flex-direction: column;
  gap: 0;
}
.trace-event {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 12px;
  padding: 10px 0;
  border-bottom: 1px solid #f2f4f7;
}
.trace-event:last-child {
  border-bottom: none;
}
.trace-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  margin-top: 5px;
  background: #d0d5dd;
}
.trace-dot.prompt { background: #2563eb; }
.trace-dot.mark { background: #f59e0b; }
.trace-dot.executor { background: #7c3aed; }
.trace-dot.dependency { background: #10b981; }
.trace-dot.decision { background: #087443; }
.trace-event-head {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.trace-event-head strong {
  color: #344054;
  font-size: 13px;
}
.trace-event-meta {
  display: flex;
  gap: 12px;
  margin-top: 3px;
  color: #98a2b3;
  font-size: 11px;
}
/* 接力上下文同步 */
.context-sync-card {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 16px;
  align-items: center;
  border: 1px solid #e8edf3;
  border-radius: 8px;
  background: #fff;
  padding: 14px;
  margin-bottom: 14px;
}
.context-sync-card.synced {
  border-color: #9edcc2;
  background: #f7fcf9;
}
.context-sync-info p {
  margin: 4px 0 6px;
  color: #475467;
  font-size: 13px;
  line-height: 1.55;
}
.context-sync-info code {
  display: block;
  overflow: hidden;
  border: 1px solid #e8edf3;
  border-radius: 6px;
  background: #f7f9fc;
  color: #475467;
  padding: 5px 8px;
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.context-sync-actions {
  display: flex;
  flex-direction: column;
  gap: 6px;
  align-items: flex-end;
}
.context-sync-msg {
  color: #087443;
  font-size: 12px;
  max-width: 200px;
  text-align: right;
}
/* MCP 配置指引 */
.mcp-guide-card {
  border: 1px solid #ddd6fe;
  border-radius: 8px;
  background: #f5f3ff;
  padding: 14px;
  margin-bottom: 14px;
}
.mcp-guide-card p {
  margin: 6px 0;
  color: #475467;
  font-size: 13px;
  line-height: 1.55;
}
.mcp-guide-card code {
  background: #ede9fe;
  border-radius: 4px;
  padding: 1px 5px;
  font-size: 12px;
  color: #5b21b6;
}
.mcp-config-block {
  background: #1e1b2e;
  color: #e9d5ff;
  border-radius: 8px;
  padding: 12px;
  font-size: 12px;
  margin: 8px 0;
  overflow-x: auto;
  max-height: none;
}
.mcp-note {
  color: #6d28d9 !important;
  font-size: 12px !important;
}
.skill-install-row {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 14px;
  align-items: center;
  border-top: 1px dashed #ddd6fe;
  margin-top: 12px;
  padding-top: 12px;
}
.skill-install-row strong {
  display: block;
  color: #5b21b6;
  font-size: 13px;
  margin-bottom: 4px;
}
.skill-install-row code {
  display: block;
  overflow: hidden;
  background: #ede9fe;
  border-radius: 4px;
  padding: 3px 6px;
  font-size: 11px;
  color: #5b21b6;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin-top: 4px;
}
/* 产物预览抽屉 */
.preview-overlay {
  position: fixed;
  inset: 0;
  background: rgba(16, 24, 40, 0.5);
  display: flex;
  justify-content: flex-end;
  z-index: 1000;
}
.preview-drawer {
  width: min(640px, 92vw);
  height: 100%;
  background: #fff;
  border-left: 1px solid #e8edf3;
  display: flex;
  flex-direction: column;
  padding: 18px 20px;
  overflow-y: auto;
}
.preview-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 8px;
}
.preview-title {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.preview-title strong {
  color: #182033;
  font-size: 18px;
}
.preview-head-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}
.preview-path {
  display: block;
  overflow: hidden;
  border: 1px solid #e8edf3;
  border-radius: 7px;
  background: #f7f9fc;
  color: #475467;
  padding: 7px 9px;
  font-size: 12px;
  margin-bottom: 14px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.preview-body {
  color: #344054;
  font-size: 13px;
  line-height: 1.7;
  overflow-x: auto;
}
.preview-body :deep(h1),
.preview-body :deep(h2),
.preview-body :deep(h3),
.preview-body :deep(h4) {
  color: #182033;
  margin: 18px 0 8px;
  line-height: 1.3;
}
.preview-body :deep(h1) { font-size: 20px; }
.preview-body :deep(h2) { font-size: 17px; }
.preview-body :deep(h3) { font-size: 15px; }
.preview-body :deep(h4) { font-size: 13px; }
.preview-body :deep(p) { margin: 8px 0; }
.preview-body :deep(ul),
.preview-body :deep(ol) { padding-left: 22px; margin: 8px 0; }
.preview-body :deep(li) { margin: 4px 0; }
.preview-body :deep(code) {
  background: #f2f4f7;
  border-radius: 4px;
  padding: 1px 5px;
  font-size: 12px;
  color: #b42318;
}
.preview-body :deep(pre) {
  background: #f7f9fc;
  border-radius: 8px;
  padding: 12px;
  overflow-x: auto;
  margin: 10px 0;
}
.preview-body :deep(pre code) {
  background: transparent;
  padding: 0;
  color: #344054;
}
.preview-body :deep(table) {
  width: 100%;
  border-collapse: collapse;
  margin: 10px 0;
  font-size: 12px;
}
.preview-body :deep(th),
.preview-body :deep(td) {
  border: 1px solid #e8edf3;
  padding: 6px 9px;
  text-align: left;
}
.preview-body :deep(th) {
  background: #f7f9fc;
  font-weight: 600;
}
.preview-body :deep(blockquote) {
  border-left: 3px solid #d7e3f8;
  margin: 10px 0;
  padding: 4px 12px;
  color: #475467;
}
@media (max-width: 900px) {
  .run-header,
  .run-summary,
  .handoff-panel,
  .next-stage-card {
    flex-direction: column;
    align-items: stretch;
  }
  .handoff-actions {
    flex-direction: column;
    align-items: stretch;
  }
  .run-main {
    flex-direction: column;
    align-items: stretch;
  }
  .run-meta {
    flex-wrap: wrap;
  }
  .ops-strip,
  .flow-console,
  .overview-grid,
  .models-layout,
  .artifact-layout,
  .trace-layout,
  .stage-roadmap,
  .relay-grid,
  .form-grid,
  .lane-track,
  .driver-steps,
  .task-dossier,
  .dossier-grid {
    grid-template-columns: 1fr;
  }
  .console-action {
    border-left: none;
    border-top: 1px solid #d7e3f8;
    padding: 14px 0 0;
  }
  .context-sync-card {
    grid-template-columns: 1fr;
  }
  .skill-install-row {
    grid-template-columns: 1fr;
  }
  .span-2 {
    grid-column: span 1;
  }
  .preview-drawer {
    width: 100vw;
  }
}
</style>
