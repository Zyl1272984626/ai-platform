<template>
  <div class="memory-page page-container">
    <header class="hero">
      <div>
        <p class="eyebrow">Memory Hub</p>
        <h1>会话冷库工作台</h1>
        <p class="desc">
          收集 Claude Code、Codex、ZCode 的本地会话，自动沉淀术语、偏好、项目规则和平台经验，并为根 AI 生成可注入上下文。
        </p>
      </div>
      <div class="hero-actions">
        <button class="secondary" :disabled="scanning" @click="doScan">{{ scanning ? '扫描中...' : '扫描会话' }}</button>
        <button class="primary" :disabled="automationRunning" @click="doRunAutomation">
          {{ automationRunning ? '自动化中...' : '扫描 + 生成候选' }}
        </button>
      </div>
    </header>

    <section class="metrics">
      <article>
        <span>会话原料</span>
        <strong>{{ conversations.length }}</strong>
        <small>Claude / Codex / ZCode</small>
      </article>
      <article>
        <span>冷库条目</span>
        <strong>{{ memoryItems.length }}</strong>
        <small>{{ activeCount }} 条可召回</small>
      </article>
      <article>
        <span>候选待审</span>
        <strong>{{ candidateCount }}</strong>
        <small>需要确认后长期生效</small>
      </article>
      <article>
        <span>洞察 / 制品</span>
        <strong>{{ insights.length }} / {{ artifacts.length }}</strong>
        <small>可继续转化为记忆</small>
      </article>
    </section>

    <nav class="tabs">
      <button :class="{ active: tab === 'overview' }" @click="tab = 'overview'">概览</button>
      <button :class="{ active: tab === 'cold' }" @click="tab = 'cold'">冷库</button>
      <button :class="{ active: tab === 'conversations' }" @click="tab = 'conversations'">会话</button>
      <button :class="{ active: tab === 'recall-injection' }" @click="tab = 'recall-injection'">召回与注入</button>
      <button :class="{ active: tab === 'automation' }" @click="tab = 'automation'">自动化</button>
    </nav>

    <!-- ========== 概览（默认首页） ========== -->
    <section v-if="tab === 'overview'" class="section">
      <div v-if="overview" class="overview-wrap">
        <!-- 活力指标 -->
        <div class="metrics">
          <article>
            <span>记忆总数</span>
            <strong>{{ overview.totals.total }}</strong>
            <small>冷库里沉淀的知识</small>
          </article>
          <article>
            <span>可召回</span>
            <strong>{{ overview.totals.recallable }}</strong>
            <small>活跃+已通过，正在生效</small>
          </article>
          <article>
            <span>本周注入</span>
            <strong>{{ overview.totals.weeklyInjections }}</strong>
            <small>AI 实际用到了记忆</small>
          </article>
          <article>
            <span>平均命中</span>
            <strong>{{ overview.totals.avgHitPerInjection }}</strong>
            <small>每次注入带几条记忆</small>
          </article>
        </div>

        <!-- AI 知识库全景 -->
        <article class="panel overview-block">
          <h2>AI 知识库全景</h2>
          <p>根 AI 现在知道你什么。这里展示所有活跃记忆，按类型分组。</p>
          <div v-if="overviewTypeEntries().length" class="knowledge-groups">
            <div v-for="group in overviewTypeEntries()" :key="group.type" class="knowledge-group">
              <div class="knowledge-head" @click="openDetail(group.items[0])">
                <span class="ktype-badge" :class="`ktype-${group.type}`">{{ typeLabel(group.type) }}</span>
                <strong>{{ group.items.length }} 条</strong>
              </div>
              <ul class="knowledge-list">
                <li v-for="item in group.items.slice(0, 5)" :key="item.id" @click="openDetail(item)">
                  <span class="knowledge-title">{{ item.title }}</span>
                  <span v-if="item.usageCount" class="knowledge-usage">用过 {{ item.usageCount }} 次</span>
                </li>
              </ul>
              <p v-if="group.items.length > 5" class="knowledge-more">还有 {{ group.items.length - 5 }} 条…</p>
            </div>
          </div>
          <div v-else class="empty compact">还没有活跃记忆。去「冷库」把候选设为活跃。</div>
        </article>

        <!-- 活力榜 -->
        <div class="overview-grid-3">
          <article class="panel">
            <h2>高频使用 Top 5</h2>
            <p>被召回最多的记忆，证明在发挥作用。</p>
            <ol class="rank-list">
              <li v-for="item in overview.topUsed" :key="item.id" @click="openDetail(item)">
                <span class="rank-title">{{ item.title }}</span>
                <b>{{ item.usageCount }} 次</b>
              </li>
            </ol>
            <div v-if="!overview.topUsed.length" class="empty compact">暂无使用记录</div>
          </article>

          <article class="panel">
            <h2>沉睡记忆</h2>
            <p>可召回但从未被用，可能该降级或删除。</p>
            <ul class="rank-list">
              <li v-for="item in overview.dormant" :key="item.id" @click="openDetail(item)">
                <span class="rank-title">{{ item.title }}</span>
                <small>{{ typeLabel(item.type) }}</small>
              </li>
            </ul>
            <div v-if="!overview.dormant.length" class="empty compact">没有沉睡记忆</div>
          </article>

          <article class="panel">
            <h2>正反馈榜</h2>
            <p>注入记录里被标记「有用」的记忆。</p>
            <ul class="rank-list">
              <li v-for="entry in overview.topPositiveFeedback" :key="entry.item.id" @click="openDetail(entry.item)">
                <span class="rank-title">{{ entry.item.title }}</span>
                <b><Icon :icon="IconBiz.thumbsUp" :size="13" /> {{ entry.usefulCount }}</b>
              </li>
            </ul>
            <div v-if="!overview.topPositiveFeedback.length" class="empty compact">还没有正反馈</div>
          </article>
        </div>

        <!-- 产物预览 + 分布图 -->
        <div class="overview-grid-2">
          <article class="panel">
            <div class="panel-head">
              <h2>最终产物预览</h2>
              <button class="secondary small" @click="doExportProjectMemory">重新导出</button>
            </div>
            <p>AGENTS.memory.md 内容，会被其他 AI 工具读取。</p>
            <pre class="overview-preview">{{ overview.exportPreview }}</pre>
          </article>

          <article class="panel">
            <h2>记忆分布</h2>
            <p>冷库的知识结构。</p>
            <div class="dist-section">
              <h4>按类型</h4>
              <div class="dist-bar-list">
                <div v-for="d in distributionEntries(overview.distribution.byType)" :key="d.label" class="dist-bar-row">
                  <span class="dist-label">{{ typeLabel(d.label as MemoryItemType) || d.label }}</span>
                  <div class="dist-bar"><div class="dist-fill" :style="{ width: d.pct + '%' }"></div></div>
                  <span class="dist-value">{{ d.value }}</span>
                </div>
              </div>
            </div>
            <div class="dist-section">
              <h4>按来源</h4>
              <div class="dist-bar-list">
                <div v-for="d in distributionEntries(overview.distribution.bySource)" :key="d.label" class="dist-bar-row">
                  <span class="dist-label">{{ d.label }}</span>
                  <div class="dist-bar"><div class="dist-fill dist-fill-2" :style="{ width: d.pct + '%' }"></div></div>
                  <span class="dist-value">{{ d.value }}</span>
                </div>
              </div>
            </div>
          </article>
        </div>
      </div>
      <div v-else class="empty">正在加载概览…</div>
    </section>

    <!-- ========== 冷库 ========== -->
    <section v-if="tab === 'cold'" class="section">
      <div class="toolbar">
        <div>
          <h2>可治理记忆</h2>
          <p>候选来自规则种子、洞察和会话线索；通过后会进入正式召回。点击卡片查看证据链。</p>
        </div>
        <div class="toolbar-actions">
          <select v-model="statusFilter">
            <option value="all">全部状态</option>
            <option value="candidate">候选</option>
            <option value="approved">已通过</option>
            <option value="active">活跃</option>
            <option value="rejected">已拒绝</option>
            <option value="archived">已归档</option>
          </select>
          <button class="secondary" :disabled="generating" @click="doGenerateCandidates">
            {{ generating ? '生成中...' : '生成候选' }}
          </button>
          <button class="secondary" :disabled="filtering" @click="doSmartFilter('rule')" title="AI 按置信度批量评估候选，分组成建议通过/拒绝/需确认">
            {{ filtering ? '筛选中...' : 'AI 智能筛选' }}
          </button>
          <button class="secondary" :disabled="curating" @click="doCurateBatch" :title="'用 DeepSeek 深度理解会话，提取规则策展捕捉不到的偏好/决策'">
            {{ curating ? 'LLM 策展中...' : 'LLM 深度策展' }}
          </button>
          <button class="secondary" @click="copyColdPack">复制冷库包</button>
          <template v-if="selectedIds.size > 0">
            <button class="primary small" @click="doBatchTransition('approve')">批量通过 ({{ selectedIds.size }})</button>
            <button class="secondary small" @click="doBatchTransition('reject')">批量拒绝</button>
            <button class="secondary small" @click="clearSelection">取消选择</button>
          </template>
        </div>
      </div>

      <!-- 智能筛选结果：分组一键操作 -->
      <div v-if="smartFilter && smartFilter.summary.total > 0" class="filter-summary">
        <div class="filter-summary-head">
          <h3>AI 筛选建议（{{ smartFilter.mode === 'llm' ? 'LLM 语义' : '规则置信度' }}）</h3>
          <button class="secondary small" @click="smartFilter = null">清除建议</button>
        </div>
        <div class="filter-summary-stats">
          <span class="fs-approve">建议通过 {{ smartFilter.summary.approve }}</span>
          <span class="fs-reject">建议拒绝 {{ smartFilter.summary.reject }}</span>
          <span class="fs-review">需你确认 {{ smartFilter.summary.review }}</span>
        </div>
        <div class="filter-summary-actions" v-if="smartFilter.summary.approve || smartFilter.summary.reject">
          <button class="primary small" :disabled="!smartFilter.summary.approve" @click="applySuggestionGroup('approve')">一键通过建议通过的 ({{ smartFilter.summary.approve }})</button>
          <button class="secondary small" :disabled="!smartFilter.summary.reject" @click="applySuggestionGroup('reject')">一键拒绝建议拒绝的 ({{ smartFilter.summary.reject }})</button>
        </div>
      </div>

      <div class="memory-grid">
        <article
          v-for="item in filteredMemoryItems"
          :key="item.id"
          class="memory-card"
          :class="[`memory-${item.type}`, { selected: selectedIds.has(item.id) }]"
        >
          <div class="card-top">
            <label class="card-check" @click.stop>
              <input type="checkbox" :checked="selectedIds.has(item.id)" @change="toggleSelect(item.id)" />
              <span>{{ typeLabel(item.type) }}</span>
            </label>
            <div class="card-tags">
              <b v-if="filterSuggestionFor(item.id)" class="suggestion-tag" :class="`sug-${filterSuggestionFor(item.id)!.suggestion}`" :title="filterSuggestionFor(item.id)!.reason">
                {{ suggestionLabel(filterSuggestionFor(item.id)!.suggestion) }}
              </b>
              <b :class="['status', item.status]">{{ statusLabel(item.status) }}</b>
            </div>
          </div>
          <h3 @click="openDetail(item)">{{ item.title }}</h3>
          <p @click="openDetail(item)">{{ item.content }}</p>
          <div class="meta">
            <span>{{ scopeLabel(item) }}</span>
            <span>{{ Math.round(item.confidence * 100) }}%</span>
            <span>证据 {{ item.evidenceCount }}</span>
            <span>使用 {{ item.usageCount || 0 }}</span>
          </div>
          <div class="card-actions">
            <button class="secondary small" @click="openDetail(item)">详情</button>
            <template v-if="item.status === 'candidate'">
              <button class="primary small" @click="transitionItem(item.id, 'approve')">通过</button>
              <button class="secondary small" @click="transitionItem(item.id, 'reject')">拒绝</button>
            </template>
            <template v-else-if="item.status === 'approved'">
              <button class="primary small" @click="transitionItem(item.id, 'activate')">设为活跃</button>
              <button class="secondary small" @click="transitionItem(item.id, 'archive')">归档</button>
            </template>
          </div>
        </article>
      </div>

      <div v-if="filteredMemoryItems.length === 0" class="empty">
        还没有匹配的记忆条目。先点击“生成候选”或“扫描 + 生成候选”。
      </div>
    </section>

    <section v-if="tab === 'conversations'" class="section">
      <div class="toolbar">
        <div>
          <h2>会话原料</h2>
          <p>原始会话仍然保留，用作证据和回溯入口。</p>
        </div>
        <div class="toolbar-actions">
          <input v-model="search" placeholder="搜索标题、项目、摘要" />
          <select v-model="sourceFilter">
            <option value="all">全部来源</option>
            <option value="claude-code">Claude Code</option>
            <option value="codex">Codex</option>
            <option value="zcode">ZCode</option>
          </select>
        </div>
      </div>
      <div class="conversation-list">
        <article v-for="conv in filteredConversations" :key="conv.id" class="conversation-card">
          <div class="card-top">
            <span :class="['source', conv.source]">{{ sourceLabel(conv.source) }}</span>
            <small>{{ formatTime(conv.lastActivityAt || conv.startedAt) }}</small>
          </div>
          <h3>{{ conv.title || '未命名会话' }}</h3>
          <p>{{ conv.summary || '尚未摘要，可作为后续分析原料。' }}</p>
          <div class="meta">
            <span>{{ shortProject(conv.projectPath || conv.projectSlug) }}</span>
            <span>{{ conv.messageCount }} 消息</span>
            <span>{{ conv.model || 'unknown model' }}</span>
          </div>
        </article>
      </div>
    </section>

    <!-- ========== 召回与注入（合并） ========== -->
    <section v-if="tab === 'recall-injection'" class="section">
      <div class="toolbar">
        <div>
          <h2>注入记录</h2>
          <p>每次根 AI / 流水线 / 测试自动注入的记忆会在这里留痕。这是"AI 实际用了什么"的真相来源。可标记有用/无关/错误。</p>
        </div>
        <div class="toolbar-actions">
          <button class="secondary" @click="loadInjectionsData">刷新</button>
        </div>
      </div>

      <div v-if="injections.length" class="injection-list">
        <article v-for="inj in injections" :key="inj.id" class="injection-card">
          <div class="card-top">
            <span class="source">{{ targetLabel(inj.target) }} · {{ inj.memoryIds.length }} 条记忆</span>
            <small>{{ formatTime(inj.generatedAt) }}</small>
          </div>
          <p class="injection-request">{{ inj.request || '(空请求)' }}</p>
          <div v-if="inj.projectPath" class="meta">
            <span>{{ shortProject(inj.projectPath) }}</span>
            <span v-if="inj.platform">{{ sourceLabel(inj.platform) }}</span>
          </div>
          <details class="injection-bundle">
            <summary>注入内容</summary>
            <pre>{{ inj.bundle }}</pre>
          </details>
          <div class="card-actions">
            <span class="feedback-label">反馈：</span>
            <button
              v-for="fb in ['useful', 'wrong', 'irrelevant'] as const"
              :key="fb"
              class="secondary small"
              :class="{ 'feedback-active': inj.feedback === fb }"
              @click="doFeedback(inj.id, fb)"
            >{{ feedbackLabel(fb) }}</button>
          </div>
        </article>
      </div>
      <div v-else class="empty">
        还没有注入记录。在 Chat 发送一条消息触发根 AI，注入会自动留痕。
      </div>

      <!-- 手动模拟召回（折叠区） -->
      <details class="recall-sim">
        <summary>想预测下次会注入什么？展开手动模拟召回</summary>
        <div class="recall-layout">
          <div class="panel">
            <h2>模拟召回</h2>
            <p>输入一个请求，看会召回哪些记忆（使用 TF-IDF 语义 + 关键词综合排序）。</p>
            <label>
              <span>未来请求</span>
              <textarea v-model="recallQuery" placeholder="例如：继续优化 zcode 页面，并让根 AI 理解我的冷库、根 AI、深度方案偏好。"></textarea>
            </label>
            <label>
              <span>项目路径</span>
              <input v-model="recallProject" />
            </label>
            <label>
              <span>注入目标</span>
              <select v-model="recallTarget">
                <option value="chat">对话 Chat（术语/偏好/项目规则）</option>
                <option value="pipeline">流水线 Pipeline（项目规则/工作流/决策）</option>
                <option value="test">测试 Test（项目规则/避坑/工作流）</option>
                <option value="review">审查 Review（项目约束/避坑/纠偏）</option>
              </select>
            </label>
            <div class="inline">
              <label class="check"><input v-model="includeCandidates" type="checkbox" /> 包含候选</label>
              <button class="primary" :disabled="recalling" @click="doRecall">{{ recalling ? '召回中...' : '召回上下文' }}</button>
              <button class="secondary" @click="copyRecallBundle">复制结果</button>
            </div>
          </div>
          <div class="panel output">
            <h2>注入包预览</h2>
            <div v-if="recallResult && recallResult.reasons.length" class="recall-reasons">
              <h3>召回理由（{{ recallResult.reasons.length }} 条）</h3>
              <div v-for="reason in recallResult.reasons" :key="reason.itemId" class="reason-item">
                <div class="reason-head">
                  <strong>{{ reason.score }}</strong>
                  <span class="reason-factors" v-for="(f, i) in reason.factors" :key="i">{{ f }}</span>
                </div>
              </div>
            </div>
            <pre>{{ recallBundle }}</pre>
          </div>
        </div>
      </details>
    </section>

    <section v-if="tab === 'automation'" class="section">
      <div class="automation-grid">
        <article class="panel">
          <h2>自动化控制台</h2>
          <p>一键流水线：扫描会话 → 生成记忆候选 → 召回可用。运行会写入日志，让召回 API 立即可用。</p>
          <div class="card-actions">
            <button class="primary" :disabled="automationRunning" @click="doRunAutomation">
              {{ automationRunning ? '运行中...' : '立即运行流水线' }}
            </button>
            <button class="secondary" @click="doExportProjectMemory">导出 AGENTS.memory.md</button>
          </div>
          <p v-if="exportResult" class="export-result">
            已导出 {{ exportResult.itemCount }} 条记忆到 {{ exportResult.path }}
          </p>
        </article>

        <article class="panel">
          <h2>根 AI 自动注入</h2>
          <p>平台对话发送前会自动调用 recall，把 active/approved 记忆拼入 Claude Code 的 system prompt。</p>
          <pre>user message
  -> /api/memory/recall
  -> Personal Memory Context
  -> appendSystemPrompt</pre>
        </article>

        <article class="panel">
          <h2>调用方式</h2>
          <pre>POST /api/memory/recall
{
  "query": "帮我继续优化 zcode 页面",
  "projectPath": "C:/FengSuKeJi/ai-platform",
  "platform": "codex",
  "limit": 12
}</pre>
        </article>
      </div>

      <article class="panel vector-panel">
        <h2>向量索引（Phase 4 语义召回）</h2>
        <p>本地 TF-IDF 索引，让召回从“关键词命中”升级为“语义相关度”。零外部依赖，候选生成后自动重建。</p>
        <div class="meta">
          <span>已索引 {{ vectorStatus.documentCount }} 篇文档</span>
          <span v-if="vectorStatus.builtAt">最近构建 {{ formatTime(vectorStatus.builtAt) }}</span>
          <span v-if="!vectorStatus.hasIndex" class="warn">尚未构建</span>
        </div>
        <div class="card-actions">
          <button class="secondary" :disabled="rebuilding" @click="doRebuildVectors">
            {{ rebuilding ? '重建中...' : '立即重建索引' }}
          </button>
        </div>
      </article>

      <article class="panel config-panel">
        <h2>冷库配置</h2>
        <p>控制自动注入、启动扫描和召回行为。改动立即持久化到 server/data/memory/config.json。</p>
        <div class="config-grid">
          <label class="config-item">
            <input type="checkbox" :checked="config.autoInject" @change="updateConfigField('autoInject', ($event.target as HTMLInputElement).checked)" />
            <span>Chat 自动注入</span>
          </label>
          <label class="config-item">
            <input type="checkbox" :checked="config.startupAutomation" @change="updateConfigField('startupAutomation', ($event.target as HTMLInputElement).checked)" />
            <span>启动时自动扫描</span>
          </label>
          <label class="config-item">
            <input type="checkbox" :checked="config.includeCandidatesInRecall" @change="updateConfigField('includeCandidatesInRecall', ($event.target as HTMLInputElement).checked)" />
            <span>召回包含候选</span>
          </label>
          <label class="config-item">
            <span>召回条数上限</span>
            <input type="number" min="1" max="50" :value="config.recallLimit" @change="updateConfigField('recallLimit', Number(($event.target as HTMLInputElement).value))" />
          </label>
          <label class="config-item">
            <span>最大注入 token</span>
            <input type="number" min="0" step="500" :value="config.maxInjectionTokens" @change="updateConfigField('maxInjectionTokens', Number(($event.target as HTMLInputElement).value))" />
          </label>
        </div>
      </article>

      <article class="panel logs-panel">
        <h2>最近运行</h2>
        <div v-if="automationLogs.length" class="run-list">
          <div v-for="log in automationLogs.slice(0, 8)" :key="log.id" class="run-item">
            <div>
              <strong>{{ log.status === 'success' ? '成功' : '失败' }}</strong>
              <span>{{ log.trigger }} / {{ formatTime(log.finishedAt) }}</span>
            </div>
            <small v-if="log.scan">
              扫描 {{ log.scan.scanned }}，新增 {{ log.scan.newCount }}，候选 +{{ log.candidates?.created || 0 }}
            </small>
            <small v-else>{{ log.error || '无详情' }}</small>
          </div>
        </div>
        <div v-else class="empty compact">还没有自动化运行记录。</div>
      </article>
    </section>

    <!-- ========== 记忆详情弹窗 ========== -->
    <div v-if="showDetailModal && activeItem" class="modal-overlay" @click.self="closeDetail">
      <div class="modal-content modal-wide">
        <h3>{{ activeItem.title }}</h3>
        <div class="detail-head">
          <b :class="['status', activeItem.status]">{{ statusLabel(activeItem.status) }}</b>
          <span class="detail-type">{{ typeLabel(activeItem.type) }}</span>
          <span>置信度 {{ Math.round(activeItem.confidence * 100) }}%</span>
          <span>使用 {{ activeItem.usageCount || 0 }} 次</span>
          <span>证据 {{ activeItem.evidenceCount }}</span>
        </div>

        <div class="detail-body">
          <h4>内容</h4>
          <p class="detail-content">{{ activeItem.content }}</p>

          <h4>作用域</h4>
          <p class="detail-meta">{{ scopeLabel(activeItem) }}</p>

          <h4>标签</h4>
          <div class="tag-list">
            <span v-for="tag in activeItem.tags" :key="tag" class="tag">{{ tag }}</span>
            <span v-if="!activeItem.tags.length" class="detail-meta">无</span>
          </div>
          <div v-if="activeItem.aliases && activeItem.aliases.length" class="tag-list">
            <span v-for="alias in activeItem.aliases" :key="alias" class="tag tag-alias">{{ alias }}</span>
          </div>

          <h4>来源证据 (sourceRefs)</h4>
          <div v-if="activeItem.sourceRefs.length" class="source-list">
            <div v-for="(ref, idx) in activeItem.sourceRefs" :key="idx" class="source-ref">
              <span class="source">{{ sourceRefLabel(ref.source) }}</span>
              <span v-if="ref.conversationId" class="detail-meta">{{ ref.conversationId }}</span>
              <span v-if="ref.insightId" class="detail-meta">insight: {{ ref.insightId }}</span>
            </div>
          </div>
          <p v-else class="detail-meta">无来源记录</p>

          <h4>时间</h4>
          <p class="detail-meta">
            创建 {{ formatTime(activeItem.createdAt) }} ·
            更新 {{ formatTime(activeItem.updatedAt) }}
            <span v-if="activeItem.lastUsedAt"> · 最近使用 {{ formatTime(activeItem.lastUsedAt) }}</span>
          </p>
        </div>

        <div class="modal-actions">
          <button class="secondary" @click="startEdit">编辑</button>
          <template v-if="activeItem.status === 'candidate'">
            <button class="primary" @click="transitionFromDetail('approve')">通过</button>
            <button class="secondary" @click="transitionFromDetail('reject')">拒绝</button>
          </template>
          <template v-else-if="activeItem.status === 'approved'">
            <button class="primary" @click="transitionFromDetail('activate')">设为活跃</button>
            <button class="secondary" @click="transitionFromDetail('archive')">归档</button>
          </template>
          <button class="secondary" @click="closeDetail">关闭</button>
        </div>
      </div>
    </div>

    <!-- ========== 编辑弹窗 ========== -->
    <div v-if="showEditModal && editForm" class="modal-overlay" @click.self="closeEdit">
      <div class="modal-content">
        <h3>编辑记忆</h3>
        <label>
          <span>标题</span>
          <input v-model="editForm.title" />
        </label>
        <label>
          <span>内容</span>
          <textarea v-model="editForm.content"></textarea>
        </label>
        <div class="edit-row">
          <label>
            <span>类型</span>
            <select v-model="editForm.type">
              <option v-for="t in itemTypes" :key="t" :value="t">{{ typeLabel(t) }}</option>
            </select>
          </label>
          <label>
            <span>置信度 (0~1)</span>
            <input type="number" min="0" max="1" step="0.05" v-model.number="editForm.confidence" />
          </label>
        </div>
        <label>
          <span>标签（逗号分隔）</span>
          <input v-model="editForm.tagsText" placeholder="偏好, 交付标准" />
        </label>
        <div class="modal-actions">
          <button class="secondary" :disabled="saving" @click="closeEdit">取消</button>
          <button class="primary" :disabled="saving" @click="saveEdit">{{ saving ? '保存中...' : '保存' }}</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import Icon from '../components/ui/Icon.vue'
import { IconBiz } from '../composables/icons'
import {
  listConversations,
  scanConversations,
  listInsights,
  listArtifacts,
  listMemoryItems,
  generateMemoryCandidates,
  transitionMemoryItem,
  recallMemory,
  runMemoryAutomation,
  listMemoryAutomationLogs,
  exportProjectMemory,
  updateMemoryItem,
  batchTransitionMemoryItems,
  getMemoryConfig,
  updateMemoryConfig,
  listInjections,
  feedbackInjection,
  curateBatch,
  getVectorStatus,
  rebuildVectors,
  getMemoryOverview,
  smartFilterCandidates,
  applyFilterSuggestions,
} from '../api/memory'
import { toast } from '../composables/useToast'
import type {
  ConversationSummary,
  GeneratedArtifact,
  MemoryInsight,
  MemoryItem,
  MemoryItemStatus,
  MemoryItemType,
  MemoryRecallResultWithReasons,
  MemoryRecallReason,
  MemoryRecallTarget,
  MemoryAutomationLog,
  MemoryConfig,
  MemoryInjectionLog,
  MemoryVectorStatus,
  MemoryOverview,
  SmartFilterResult,
  FilterSuggestion,
} from '../api/types'

type Tab = 'overview' | 'cold' | 'conversations' | 'recall-injection' | 'automation'
type SourceFilter = 'all' | ConversationSummary['source']
type FeedbackKind = 'useful' | 'wrong' | 'irrelevant'
type SourceRef = {
  source: ConversationSummary['source'] | 'system' | 'insight'
  conversationId?: string
  insightId?: string
  messageIds?: string[]
}

const tab = ref<Tab>('overview')
const conversations = ref<ConversationSummary[]>([])
const insights = ref<MemoryInsight[]>([])
const artifacts = ref<GeneratedArtifact[]>([])
const memoryItems = ref<MemoryItem[]>([])
const recallResult = ref<MemoryRecallResultWithReasons | null>(null)
const automationLogs = ref<MemoryAutomationLog[]>([])
const exportResult = ref<{ path: string; itemCount: number; content: string } | null>(null)
const injections = ref<MemoryInjectionLog[]>([])
const config = ref<MemoryConfig>({ autoInject: true, startupAutomation: true, recallLimit: 10, includeCandidatesInRecall: false, maxInjectionTokens: 4000 })
const vectorStatus = ref<MemoryVectorStatus>({ documentCount: 0, builtAt: '', hasIndex: false })
const overview = ref<MemoryOverview | null>(null)

// 智能筛选
const smartFilter = ref<SmartFilterResult | null>(null)
const filtering = ref(false)
/** 召回实验折叠区（已并入召回与注入 tab） */
const showRecallSim = ref(false)

// 详情弹窗 / 编辑弹窗
const showDetailModal = ref(false)
const showEditModal = ref(false)
const activeItem = ref<MemoryItem | null>(null)
const saving = ref(false)
const editForm = ref<{ title: string; content: string; type: MemoryItemType; confidence: number; tagsText: string } | null>(null)

// 批量选择
const selectedIds = ref<Set<string>>(new Set())

// 召回 target / 策展 / 向量
const recallTarget = ref<MemoryRecallTarget>('chat')
const curating = ref(false)
const rebuilding = ref(false)

const itemTypes: MemoryItemType[] = ['term', 'preference', 'project_rule', 'workflow', 'decision', 'entity', 'skill', 'warning', 'source']

const scanning = ref(false)
const generating = ref(false)
const automationRunning = ref(false)
const recalling = ref(false)
const statusFilter = ref<'all' | MemoryItemStatus>('all')
const sourceFilter = ref<SourceFilter>('all')
const search = ref('')
const recallQuery = ref('继续优化 zcode 页面，并让根 AI 理解我的冷库、根 AI、深度方案偏好。')
const recallProject = ref('C:/FengSuKeJi/ai-platform')
const includeCandidates = ref(true)

const activeCount = computed(() => memoryItems.value.filter(item => item.status === 'active' || item.status === 'approved').length)
const candidateCount = computed(() => memoryItems.value.filter(item => item.status === 'candidate').length)

const filteredMemoryItems = computed(() => {
  const list = statusFilter.value === 'all'
    ? memoryItems.value
    : memoryItems.value.filter(item => item.status === statusFilter.value)
  return [...list].sort((a, b) => statusRank(a.status) - statusRank(b.status) || b.updatedAt.localeCompare(a.updatedAt))
})

const filteredConversations = computed(() => {
  const q = search.value.trim().toLowerCase()
  return conversations.value
    .filter(conv => sourceFilter.value === 'all' || conv.source === sourceFilter.value)
    .filter(conv => !q || `${conv.title} ${conv.projectPath} ${conv.summary || ''}`.toLowerCase().includes(q))
    .slice(0, 80)
})

const recallBundle = computed(() => {
  if (recallResult.value) return recallResult.value.bundle
  return '# Personal Memory Context\n\n点击“召回上下文”后，这里会显示后端正式生成的注入包。'
})

onMounted(loadAll)

async function loadAll() {
  await Promise.all([
    loadConversations(),
    loadInsightsData(),
    loadArtifactsData(),
    loadMemoryData(),
    loadAutomationLogsData(),
    loadConfigData(),
    loadInjectionsData(),
    loadVectorStatus(),
    loadOverviewData(),
  ])
}

async function loadConversations() {
  conversations.value = await listConversations()
}

async function loadInsightsData() {
  insights.value = await listInsights()
}

async function loadArtifactsData() {
  artifacts.value = await listArtifacts()
}

async function loadMemoryData() {
  memoryItems.value = await listMemoryItems()
}

async function loadAutomationLogsData() {
  automationLogs.value = await listMemoryAutomationLogs()
}

async function loadConfigData() {
  try {
    config.value = await getMemoryConfig()
  } catch (e: any) {
    toast.error('加载冷库配置失败: ' + (e?.message || e))
  }
}

async function loadInjectionsData() {
  try {
    injections.value = await listInjections({ limit: 50 })
  } catch (e: any) {
    toast.error('加载注入记录失败: ' + (e?.message || e))
  }
}

async function loadVectorStatus() {
  try {
    vectorStatus.value = await getVectorStatus()
  } catch {
    /* 向量状态加载失败不阻断页面 */
  }
}

async function loadOverviewData() {
  try {
    overview.value = await getMemoryOverview(recallProject.value)
  } catch {
    /* 概览加载失败不阻断页面 */
  }
}

async function doScan() {
  scanning.value = true
  try {
    const res = await scanConversations()
    await loadConversations()
    toast.success(`扫描完成：新增 ${res.newCount}，更新 ${res.updated}`)
  } catch (e: any) {
    toast.error('扫描失败: ' + (e?.message || e))
  } finally {
    scanning.value = false
  }
}

async function doGenerateCandidates() {
  generating.value = true
  try {
    const res = await generateMemoryCandidates({ limit: 120 })
    await loadMemoryData()
    toast.success(`候选生成：新增 ${res.created}，更新 ${res.updated}`)
  } catch (e: any) {
    toast.error('生成候选失败: ' + (e?.message || e))
  } finally {
    generating.value = false
  }
}

async function doRunAutomation() {
  automationRunning.value = true
  try {
    const res = await runMemoryAutomation({ limit: 160 })
    await Promise.all([loadConversations(), loadMemoryData(), loadAutomationLogsData()])
    toast.success(`流水线完成：扫描 ${res.scan.scanned}，候选 +${res.candidates.created}`)
  } catch (e: any) {
    toast.error('流水线失败: ' + (e?.message || e))
  } finally {
    automationRunning.value = false
  }
}

async function doExportProjectMemory() {
  try {
    exportResult.value = await exportProjectMemory(recallProject.value)
    toast.success(`已导出 ${exportResult.value.itemCount} 条记忆`)
  } catch (e: any) {
    toast.error('导出失败: ' + (e?.message || e))
  }
}

async function transitionItem(id: string, action: 'approve' | 'activate' | 'reject' | 'archive') {
  try {
    await transitionMemoryItem(id, action)
    await loadMemoryData()
    toast.success('已更新记忆状态')
  } catch (e: any) {
    toast.error('操作失败: ' + (e?.message || e))
  }
}

async function doRecall() {
  recalling.value = true
  try {
    recallResult.value = await recallMemory({
      query: recallQuery.value,
      projectPath: recallProject.value,
      platform: 'codex',
      limit: 12,
      includeCandidates: includeCandidates.value,
      recordUsage: true,
      target: recallTarget.value,
    })
    await loadMemoryData()
    const reasons = recallResult.value.reasons || []
    toast.success(`召回 ${recallResult.value.items.length} 条记忆${reasons.length ? '（含召回理由）' : ''}`)
  } catch (e: any) {
    toast.error('召回失败: ' + (e?.message || e))
  } finally {
    recalling.value = false
  }
}

// ========== LLM 策展 ==========

async function doCurateBatch() {
  curating.value = true
  try {
    const res = await curateBatch({ limit: 8 })
    await Promise.all([loadMemoryData(), loadVectorStatus()])
    toast.success(`LLM 策展完成：策展 ${res.curated}/${res.total} 条会话，生成 ${res.draftsCreated} 条候选`)
  } catch (e: any) {
    toast.error('策展失败: ' + (e?.message || e))
  } finally {
    curating.value = false
  }
}

// ========== 向量索引 ==========

async function doRebuildVectors() {
  rebuilding.value = true
  try {
    vectorStatus.value = await rebuildVectors()
    toast.success(`向量索引已重建：${vectorStatus.value.documentCount} 篇文档`)
  } catch (e: any) {
    toast.error('重建索引失败: ' + (e?.message || e))
  } finally {
    rebuilding.value = false
  }
}

// ========== 智能筛选 ==========

async function doSmartFilter(mode: 'rule' | 'llm' = 'rule') {
  filtering.value = true
  try {
    smartFilter.value = await smartFilterCandidates(mode)
    toast.success(`智能筛选完成：建议通过 ${smartFilter.value.summary.approve} / 拒绝 ${smartFilter.value.summary.reject} / 需确认 ${smartFilter.value.summary.review}`)
  } catch (e: any) {
    toast.error('智能筛选失败: ' + (e?.message || e))
  } finally {
    filtering.value = false
  }
}

/** 取某条候选的 AI 建议（用于卡片标签展示） */
function filterSuggestionFor(id: string): { suggestion: FilterSuggestion; reason: string } | undefined {
  return smartFilter.value?.items.find(it => it.id === id)
}

/** 一键应用某种建议（approve/reject），需确认项不动 */
async function applySuggestionGroup(action: 'approve' | 'reject') {
  if (!smartFilter.value) return
  const ids = smartFilter.value.items.filter(it => it.suggestion === action).map(it => it.id)
  if (!ids.length) {
    toast.info(`没有"建议${action === 'approve' ? '通过' : '拒绝'}"的候选`)
    return
  }
  try {
    const res = await applyFilterSuggestions(ids.map(id => ({ id, action })))
    smartFilter.value = null
    await Promise.all([loadMemoryData(), loadOverviewData()])
    toast.success(`已${action === 'approve' ? '通过' : '拒绝'} ${res.applied} 条`)
  } catch (e: any) {
    toast.error('应用失败: ' + (e?.message || e))
  }
}

function copyRecallBundle() {
  navigator.clipboard.writeText(recallBundle.value)
}

function copyColdPack() {
  const text = filteredMemoryItems.value
    .filter(item => item.status === 'active' || item.status === 'approved')
    .map(item => `- [${typeLabel(item.type)}] ${item.title}: ${item.content}`)
    .join('\n')
  navigator.clipboard.writeText(`# 会话冷库\n\n${text}\n`)
}

// ========== 详情弹窗 ==========

function openDetail(item: MemoryItem) {
  activeItem.value = item
  showDetailModal.value = true
}

function closeDetail() {
  showDetailModal.value = false
}

async function transitionFromDetail(action: 'approve' | 'activate' | 'reject' | 'archive') {
  if (!activeItem.value) return
  const id = activeItem.value.id
  await transitionItem(id, action)
  // 刷新后用最新数据更新弹窗内容
  activeItem.value = memoryItems.value.find(m => m.id === id) || null
  if (!activeItem.value) closeDetail()
}

// ========== 编辑弹窗 ==========

function startEdit() {
  if (!activeItem.value) return
  const item = activeItem.value
  editForm.value = {
    title: item.title,
    content: item.content,
    type: item.type,
    confidence: item.confidence,
    tagsText: (item.tags || []).join(', '),
  }
  showDetailModal.value = false
  showEditModal.value = true
}

function closeEdit() {
  showEditModal.value = false
  editForm.value = null
}

async function saveEdit() {
  if (!editForm.value || !activeItem.value) return
  saving.value = true
  const id = activeItem.value.id
  const form = editForm.value
  try {
    const updated = await updateMemoryItem(id, {
      title: form.title,
      content: form.content,
      type: form.type,
      confidence: form.confidence,
      tags: form.tagsText.split(',').map(t => t.trim()).filter(Boolean),
    })
    await loadMemoryData()
    activeItem.value = updated
    showEditModal.value = false
    editForm.value = null
    toast.success('记忆已保存')
  } catch (e: any) {
    toast.error('保存失败: ' + (e?.message || e))
  } finally {
    saving.value = false
  }
}

// ========== 批量审核 ==========

function toggleSelect(id: string) {
  const next = new Set(selectedIds.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  selectedIds.value = next
}

function clearSelection() {
  selectedIds.value = new Set()
}

async function doBatchTransition(action: 'approve' | 'reject') {
  const ids = Array.from(selectedIds.value)
  if (!ids.length) return
  try {
    const res = await batchTransitionMemoryItems(ids, action)
    clearSelection()
    await loadMemoryData()
    toast.success(`已${action === 'approve' ? '通过' : '拒绝'} ${res.applied}/${res.requested} 条`)
  } catch (e: any) {
    toast.error('批量操作失败: ' + (e?.message || e))
  }
}

// ========== 配置 ==========

async function updateConfigField<K extends keyof MemoryConfig>(key: K, value: MemoryConfig[K]) {
  try {
    config.value = await updateMemoryConfig({ [key]: value } as Partial<MemoryConfig>)
    toast.success('配置已保存')
  } catch (e: any) {
    toast.error('配置保存失败: ' + (e?.message || e))
  }
}

// ========== 注入反馈 ==========

async function doFeedback(id: string, feedback: FeedbackKind) {
  try {
    const updated = await feedbackInjection(id, feedback)
    injections.value = injections.value.map(inj => (inj.id === id ? updated : inj))
  } catch (e: any) {
    toast.error('反馈失败: ' + (e?.message || e))
  }
}

/** 根据 itemId 取召回理由（用于召回结果展示） */
function recallReasonFor(itemId: string): MemoryRecallReason | undefined {
  return recallResult.value?.reasons?.find(r => r.itemId === itemId)
}

function statusRank(status: MemoryItemStatus) {
  const ranks: Record<MemoryItemStatus, number> = {
    candidate: 0,
    approved: 1,
    active: 2,
    conflict: 3,
    stale: 4,
    archived: 5,
    rejected: 6,
  }
  return ranks[status] ?? 9
}

function typeLabel(type: MemoryItemType) {
  const labels: Record<MemoryItemType, string> = {
    term: '术语',
    preference: '偏好',
    project_rule: '项目规则',
    workflow: '流程',
    decision: '决策',
    entity: '实体',
    skill: '技能',
    warning: '提醒',
    source: '来源',
  }
  return labels[type]
}

function statusLabel(status: MemoryItemStatus) {
  const labels: Record<MemoryItemStatus, string> = {
    candidate: '候选',
    approved: '已通过',
    active: '活跃',
    stale: '待更新',
    conflict: '冲突',
    archived: '归档',
    rejected: '拒绝',
  }
  return labels[status]
}

function scopeLabel(item: MemoryItem) {
  if (item.projectPath) return shortProject(item.projectPath)
  if (item.platform) return sourceLabel(item.platform)
  return item.scope
}

function sourceLabel(source: ConversationSummary['source']) {
  const labels: Record<ConversationSummary['source'], string> = {
    'claude-code': 'Claude Code',
    codex: 'Codex',
    zcode: 'ZCode',
  }
  return labels[source]
}

function targetLabel(target: MemoryInjectionLog['target']) {
  const labels: Record<MemoryInjectionLog['target'], string> = {
    chat: '对话',
    pipeline: '流水线',
    test: '测试',
    review: '审查',
  }
  return labels[target]
}

function feedbackLabel(fb: FeedbackKind) {
  const labels: Record<FeedbackKind, string> = {
    useful: '有用',
    wrong: '错误',
    irrelevant: '无关',
  }
  return labels[fb]
}

function sourceRefLabel(source: SourceRef['source']) {
  if (source === 'system') return '系统种子'
  if (source === 'insight') return '洞察'
  return sourceLabel(source)
}

function suggestionLabel(s: FilterSuggestion) {
  return s === 'approve' ? '建议通过' : s === 'reject' ? '建议拒绝' : '需确认'
}

// ========== 概览辅助 ==========

/** distribution 对象转排序后的 [label, value] 数组（给分布条形图用） */
function distributionEntries(obj: Record<string, number> | undefined): Array<{ label: string; value: number; pct: number }> {
  if (!obj) return []
  const entries = Object.entries(obj)
  const total = entries.reduce((s, [, v]) => s + v, 0) || 1
  return entries
    .map(([label, value]) => ({ label, value, pct: Math.round((value / total) * 100) }))
    .sort((a, b) => b.value - a.value)
}

/** 知识库全景：按类型分组，每类标题 */
const overviewTypeOrder: MemoryItemType[] = ['term', 'preference', 'project_rule', 'workflow', 'decision', 'warning', 'skill', 'source', 'entity']

function overviewTypeEntries(): Array<{ type: MemoryItemType; items: MemoryItem[] }> {
  if (!overview.value?.knowledgeByType) return []
  return overviewTypeOrder
    .filter(t => overview.value!.knowledgeByType[t]?.length)
    .map(t => ({ type: t, items: overview.value!.knowledgeByType[t] }))
}

function shortProject(path?: string) {
  if (!path) return 'unknown'
  const parts = path.replace(/\\/g, '/').split('/')
  return parts[parts.length - 1] || path
}

function formatTime(ts?: string) {
  if (!ts) return '-'
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return ts.slice(0, 10)
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
</script>

<style scoped>
/* ========== 设计 token ========== */
.memory-page {
  --bg: #fafbfc;
  --surface: #ffffff;
  --surface-2: #f7f8fa;
  --border: #eceef2;
  --border-strong: #e2e6ed;
  --text: #1a1f2e;
  --text-2: #5b6577;
  --text-3: #8a93a6;
  --brand: #1f6f5b;
  --brand-soft: #eaf5f0;
  --shadow-sm: 0 1px 2px rgba(16, 24, 40, 0.04), 0 1px 3px rgba(16, 24, 40, 0.06);
  --shadow-md: 0 4px 12px rgba(16, 24, 40, 0.06), 0 2px 4px rgba(16, 24, 40, 0.04);
  --shadow-lg: 0 12px 32px rgba(16, 24, 40, 0.12), 0 4px 8px rgba(16, 24, 40, 0.06);
  --radius: 12px;
  --radius-sm: 8px;

  min-height: 100%;
  padding: 36px 40px 56px;
  background: var(--bg);
  color: var(--text);
  font-feature-settings: 'cv11', 'ss01';
}

/* ========== hero ========== */
.hero {
  display: flex;
  justify-content: space-between;
  gap: 28px;
  margin-bottom: 28px;
  align-items: flex-end;
}

.eyebrow {
  margin: 0 0 8px;
  color: var(--brand);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 1.2px;
  text-transform: uppercase;
}

h1,
h2,
h3,
p {
  margin: 0;
}

h1 {
  font-size: 28px;
  line-height: 1.25;
  font-weight: 700;
  letter-spacing: -0.3px;
}

h2 {
  font-size: 16px;
  font-weight: 700;
  letter-spacing: -0.1px;
}

h3 {
  font-size: 15px;
  font-weight: 600;
  line-height: 1.4;
}

.desc {
  max-width: 720px;
  margin-top: 12px;
  color: var(--text-2);
  line-height: 1.7;
  font-size: 14px;
}

.hero-actions,
.toolbar-actions,
.inline,
.card-actions {
  display: flex;
  gap: 10px;
  align-items: center;
  flex-wrap: wrap;
}

/* ========== 按钮 / 表单 ========== */
button,
select,
input,
textarea {
  font: inherit;
}

button {
  border: 0;
  border-radius: var(--radius-sm);
  padding: 10px 16px;
  cursor: pointer;
  font-weight: 600;
  font-size: 14px;
  transition: all 0.15s ease;
}

button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.primary {
  background: var(--brand);
  color: white;
  box-shadow: 0 1px 2px rgba(31, 111, 91, 0.2);
}
.primary:not(:disabled):hover {
  background: #1a604f;
  transform: translateY(-1px);
  box-shadow: 0 4px 10px rgba(31, 111, 91, 0.22);
}

.secondary {
  background: var(--surface);
  color: var(--text);
  border: 1px solid var(--border-strong);
}
.secondary:not(:disabled):hover {
  background: var(--surface-2);
  border-color: #d4d9e3;
}

.small {
  padding: 7px 12px;
  font-size: 12.5px;
}

input,
select,
textarea {
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  background: var(--surface);
  color: var(--text);
  transition: border-color 0.15s, box-shadow 0.15s;
}
input:focus,
select:focus,
textarea:focus {
  outline: none;
  border-color: var(--brand);
  box-shadow: 0 0 0 3px rgba(31, 111, 91, 0.12);
}

input,
select {
  height: 40px;
  padding: 0 12px;
}

textarea {
  min-height: 140px;
  padding: 12px;
  resize: vertical;
  line-height: 1.6;
}

/* ========== metrics ========== */
.metrics {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 16px;
  margin-bottom: 24px;
}

.metrics article,
.panel,
.memory-card,
.conversation-card,
.injection-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow-sm);
}

.metrics article {
  padding: 18px 20px;
  transition: box-shadow 0.15s, transform 0.15s;
}
.metrics article:hover {
  box-shadow: var(--shadow-md);
  transform: translateY(-1px);
}

.metrics span {
  color: var(--text-3);
  font-size: 13px;
  font-weight: 500;
}

.metrics strong {
  display: block;
  margin: 10px 0 4px;
  font-size: 30px;
  font-weight: 700;
  letter-spacing: -0.5px;
  color: var(--text);
}

.metrics small {
  color: var(--text-3);
  font-size: 12px;
}

/* ========== tabs（下划线式） ========== */
.tabs {
  display: flex;
  gap: 4px;
  margin-bottom: 24px;
  border-bottom: 1px solid var(--border);
}

.tabs button {
  background: transparent;
  border: 0;
  border-bottom: 2px solid transparent;
  border-radius: 0;
  padding: 10px 16px;
  color: var(--text-2);
  font-weight: 600;
  margin-bottom: -1px;
}
.tabs button:hover {
  color: var(--text);
}
.tabs button.active {
  color: var(--brand);
  border-bottom-color: var(--brand);
  background: transparent;
}

/* ========== 布局区 ========== */
.section,
.recall-layout,
.automation-grid {
  display: grid;
  gap: 18px;
}

.toolbar {
  display: flex;
  justify-content: space-between;
  gap: 20px;
  align-items: flex-start;
}

.toolbar p {
  color: var(--text-2);
  font-size: 13.5px;
  margin-top: 4px;
}

label {
  display: grid;
  gap: 8px;
  margin-top: 16px;
  color: var(--text-2);
  font-weight: 600;
  font-size: 13px;
}

.check {
  display: flex;
  grid-template-columns: none;
  align-items: center;
  gap: 8px;
  margin: 0;
  font-weight: 600;
}

/* ========== 卡片网格 ========== */
.memory-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 16px;
}

.memory-card,
.conversation-card,
.panel {
  padding: 18px;
}

.memory-card,
.conversation-card {
  transition: box-shadow 0.18s, transform 0.18s, border-color 0.18s;
}
.memory-card:hover,
.conversation-card:hover {
  box-shadow: var(--shadow-md);
  transform: translateY(-2px);
  border-color: var(--border-strong);
}

.memory-card {
  border-left: 3px solid #c4cad6;
}
.memory-card.memory-term { border-left-color: #4a7fc4; }
.memory-card.memory-preference { border-left-color: #c8744f; }
.memory-card.memory-project_rule { border-left-color: var(--brand); }
.memory-card.memory-workflow { border-left-color: #8a72c9; }
.memory-card.memory-warning { border-left-color: #d1543f; }
.memory-card.memory-source { border-left-color: #3d8aa3; }

.card-top,
.meta {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  align-items: center;
}

.memory-card p,
.conversation-card p {
  margin-top: 10px;
  color: var(--text-2);
  line-height: 1.65;
  font-size: 13.5px;
}

.meta {
  justify-content: flex-start;
  flex-wrap: wrap;
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px solid var(--border);
  font-size: 12px;
  color: var(--text-3);
  gap: 12px;
}

/* 状态 / 来源标签（低饱和柔色） */
.status,
.source {
  border-radius: 999px;
  padding: 3px 10px;
  font-size: 12px;
  font-weight: 600;
  background: var(--surface-2);
  color: var(--text-2);
}

.status.candidate { background: #fef6e7; color: #9a6a12; }
.status.approved,
.status.active { background: var(--brand-soft); color: var(--brand); }
.status.rejected { background: #fceceb; color: #c0463a; }

.source.zcode { background: #e9f4f9; color: #2c7a90; }
.source.codex { background: var(--brand-soft); color: var(--brand); }
.source.claude-code { background: #f1ecfa; color: #6b51a3; }

.card-actions {
  margin-top: 16px;
}

/* ========== 召回实验 ========== */
.recall-layout {
  grid-template-columns: minmax(340px, 0.85fr) minmax(380px, 1.15fr);
}

.output pre {
  max-height: 540px;
  overflow: auto;
  white-space: pre-wrap;
  background: #fbfbfc;
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 16px;
  line-height: 1.7;
  font-size: 12.5px;
  font-family: 'SF Mono', 'Menlo', 'Consolas', monospace;
}

/* ========== 会话列表 ========== */
.conversation-list {
  display: grid;
  gap: 14px;
}

.conversation-card {
  display: grid;
  gap: 8px;
}

/* ========== 自动化 ========== */
.automation-grid {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.panel {
  padding: 20px;
}
.panel h2 {
  margin-bottom: 6px;
}
.panel p {
  color: var(--text-2);
  font-size: 13.5px;
  line-height: 1.65;
}
.panel pre {
  max-height: 220px;
  overflow: auto;
  white-space: pre-wrap;
  background: #fbfbfc;
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 14px;
  margin-top: 12px;
  line-height: 1.6;
  font-size: 12px;
  font-family: 'SF Mono', 'Menlo', 'Consolas', monospace;
}

.export-result {
  margin-top: 12px;
  padding: 10px 14px;
  background: var(--brand-soft);
  color: var(--brand);
  border-radius: var(--radius-sm);
  font-weight: 600;
  font-size: 13px;
  word-break: break-all;
}

/* ========== 弹窗 ========== */
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(20, 26, 40, 0.32);
  backdrop-filter: blur(2px);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 1000;
}

.modal-content {
  background: var(--surface);
  border-radius: 16px;
  padding: 28px 32px;
  width: 480px;
  max-height: 82vh;
  overflow-y: auto;
  box-shadow: var(--shadow-lg);
}

.modal-wide {
  width: 760px;
}

.modal-content h3 {
  margin-bottom: 16px;
  font-size: 19px;
  font-weight: 700;
  color: var(--text);
}

.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 24px;
  padding-top: 20px;
  border-top: 1px solid var(--border);
  flex-wrap: wrap;
}

/* 详情弹窗 */
.detail-head {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
  margin-bottom: 20px;
  padding-bottom: 16px;
  border-bottom: 1px solid var(--border);
  font-size: 13px;
  color: var(--text-2);
}

.detail-type {
  background: var(--surface-2);
  border-radius: 999px;
  padding: 3px 10px;
  color: var(--text-2);
  font-weight: 600;
}

.detail-body h4 {
  margin: 18px 0 8px;
  font-size: 12px;
  color: var(--text-3);
  text-transform: uppercase;
  letter-spacing: 0.8px;
  font-weight: 700;
}

.detail-content {
  line-height: 1.75;
  color: var(--text);
  font-size: 14px;
}

.detail-meta {
  color: var(--text-3);
  font-size: 13px;
}

.tag-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.tag {
  background: var(--surface-2);
  color: var(--text-2);
  border-radius: 6px;
  padding: 3px 9px;
  font-size: 12px;
  font-weight: 500;
}

.tag-alias {
  background: #f1ecfa;
  color: #6b51a3;
}

.source-list {
  display: grid;
  gap: 8px;
}

.source-ref {
  display: flex;
  gap: 10px;
  align-items: center;
  flex-wrap: wrap;
  font-size: 13px;
}

/* 编辑弹窗 */
.edit-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
}

.edit-row label {
  margin-top: 0;
}

/* ========== 批量选中 ========== */
.card-check {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  color: var(--text-2);
  font-weight: 600;
  font-size: 13px;
  cursor: pointer;
}

.card-check input {
  width: 16px;
  height: 16px;
  accent-color: var(--brand);
}

.memory-card.selected {
  border-color: var(--brand);
  box-shadow: 0 0 0 3px rgba(31, 111, 91, 0.15);
}

.memory-card h3,
.memory-card p {
  cursor: pointer;
}

/* ========== 注入记录 ========== */
.injection-list {
  display: grid;
  gap: 14px;
}

.injection-card {
  padding: 18px;
  transition: box-shadow 0.18s;
}
.injection-card:hover {
  box-shadow: var(--shadow-md);
}

.injection-request {
  margin: 10px 0;
  color: var(--text);
  line-height: 1.6;
  white-space: pre-wrap;
  font-size: 13.5px;
}

.injection-bundle {
  margin-top: 12px;
}

.injection-bundle summary {
  cursor: pointer;
  color: var(--text-2);
  font-size: 13px;
  font-weight: 600;
  user-select: none;
}

.injection-bundle pre {
  max-height: 300px;
  overflow: auto;
  white-space: pre-wrap;
  background: #fbfbfc;
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 14px;
  margin-top: 10px;
  line-height: 1.6;
  font-size: 12px;
  font-family: 'SF Mono', 'Menlo', 'Consolas', monospace;
}

.feedback-label {
  color: var(--text-3);
  font-size: 13px;
}

.feedback-active {
  background: var(--brand) !important;
  color: #fff !important;
  border-color: var(--brand) !important;
}

/* ========== 配置区 / 向量 ========== */
.config-panel,
.vector-panel {
  margin-top: 4px;
}

/* ========== 召回理由 ========== */
.recall-reasons {
  margin-bottom: 18px;
  padding-bottom: 16px;
  border-bottom: 1px solid var(--border);
}

.recall-reasons h3 {
  font-size: 12px;
  color: var(--text-3);
  margin-bottom: 12px;
  text-transform: uppercase;
  letter-spacing: 0.8px;
  font-weight: 700;
}

.reason-item {
  display: grid;
  gap: 4px;
  padding: 5px 0;
}

.reason-head {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
}

.reason-head strong {
  background: var(--brand);
  color: #fff;
  border-radius: 6px;
  padding: 2px 9px;
  font-size: 12px;
  font-weight: 700;
  min-width: 36px;
  text-align: center;
}

.reason-factors {
  background: var(--surface-2);
  color: var(--text-2);
  border-radius: 999px;
  padding: 2px 10px;
  font-size: 12px;
  font-weight: 500;
}

.warn {
  color: #c8744f;
  font-weight: 600;
}

.config-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 16px;
  margin-top: 16px;
}

.config-item {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 0;
  padding: 12px 14px;
  background: var(--surface-2);
  border-radius: var(--radius-sm);
  color: var(--text);
  font-weight: 600;
  font-size: 13px;
  flex-wrap: wrap;
}
.config-item input[type='checkbox'] {
  accent-color: var(--brand);
  width: 16px;
  height: 16px;
}
.config-item input[type='number'] {
  width: 90px;
  height: 32px;
}

/* ========== 运行日志 ========== */
.run-list {
  display: grid;
  gap: 0;
  margin-top: 14px;
}

.run-item {
  display: grid;
  gap: 4px;
  padding: 12px 0;
  border-bottom: 1px solid var(--border);
}
.run-item:last-child {
  border-bottom: 0;
}

.run-item div {
  display: flex;
  justify-content: space-between;
  gap: 12px;
}

.run-item span,
.run-item small {
  color: var(--text-3);
}

.compact {
  padding: 18px;
}

/* ========== 空状态 ========== */
.empty {
  padding: 40px;
  text-align: center;
  color: var(--text-3);
  background: var(--surface);
  border: 1px dashed var(--border-strong);
  border-radius: var(--radius);
  font-size: 14px;
}

@media (max-width: 980px) {
  .memory-page {
    padding: 24px 20px 40px;
  }
  .hero,
  .toolbar {
    flex-direction: column;
    align-items: flex-start;
  }
  .metrics,
  .recall-layout,
  .automation-grid {
    grid-template-columns: 1fr;
  }
  .edit-row {
    grid-template-columns: 1fr;
  }
}

/* ========== 概览 tab ========== */
.overview-wrap {
  display: grid;
  gap: 18px;
}

.overview-grid-3 {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 16px;
}

.overview-grid-2 {
  display: grid;
  grid-template-columns: minmax(0, 1.1fr) minmax(0, 0.9fr);
  gap: 16px;
}

.overview-block {
  padding: 22px;
}

/* AI 知识库全景 */
.knowledge-groups {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 16px;
  margin-top: 16px;
}

.knowledge-group {
  background: var(--surface-2);
  border-radius: var(--radius-sm);
  padding: 14px 16px;
}

.knowledge-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
  cursor: pointer;
}

.knowledge-head strong {
  color: var(--text-3);
  font-size: 12px;
  font-weight: 600;
}

.ktype-badge {
  font-size: 12px;
  font-weight: 700;
  padding: 3px 10px;
  border-radius: 999px;
  background: var(--surface);
  color: var(--text-2);
}
.ktype-badge.ktype-term { color: #4a7fc4; }
.ktype-badge.ktype-preference { color: #c8744f; }
.ktype-badge.ktype-project_rule { color: var(--brand); }
.ktype-badge.ktype-workflow { color: #8a72c9; }
.ktype-badge.ktype-warning { color: #d1543f; }
.ktype-badge.ktype-source { color: #3d8aa3; }

.knowledge-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 6px;
}

.knowledge-list li {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  background: var(--surface);
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.15s;
}
.knowledge-list li:hover {
  background: var(--brand-soft);
}

.knowledge-title {
  color: var(--text);
  font-size: 13px;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.knowledge-usage {
  color: var(--text-3);
  font-size: 11px;
  flex-shrink: 0;
}

.knowledge-more {
  margin: 8px 0 0;
  color: var(--text-3);
  font-size: 12px;
}

/* 活力榜 */
.rank-list {
  list-style: none;
  margin: 12px 0 0;
  padding: 0;
  display: grid;
  gap: 4px;
  counter-reset: rank;
}

.rank-list li {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
  padding: 9px 12px;
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.15s;
}
.rank-list li:hover {
  background: var(--surface-2);
}

ol.rank-list li {
  counter-increment: rank;
}
ol.rank-list li::before {
  content: counter(rank);
  flex-shrink: 0;
  width: 20px;
  height: 20px;
  background: var(--brand-soft);
  color: var(--brand);
  border-radius: 50%;
  font-size: 11px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
}

.rank-title {
  color: var(--text);
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
}

.rank-list b {
  color: var(--brand);
  font-size: 12px;
  flex-shrink: 0;
}

.rank-list small {
  color: var(--text-3);
  font-size: 11px;
  flex-shrink: 0;
}

/* 产物预览 */
.panel-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}

.overview-preview {
  max-height: 320px;
  overflow: auto;
  white-space: pre-wrap;
  background: #fbfbfc;
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 14px;
  margin-top: 12px;
  line-height: 1.6;
  font-size: 12px;
  font-family: 'SF Mono', 'Menlo', 'Consolas', monospace;
}

/* 分布条形图 */
.dist-section {
  margin-top: 16px;
}
.dist-section h4 {
  margin: 0 0 10px;
  font-size: 12px;
  color: var(--text-3);
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.6px;
}

.dist-bar-list {
  display: grid;
  gap: 8px;
}

.dist-bar-row {
  display: grid;
  grid-template-columns: 90px 1fr 32px;
  gap: 10px;
  align-items: center;
}

.dist-label {
  color: var(--text-2);
  font-size: 12.5px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dist-bar {
  height: 8px;
  background: var(--surface-2);
  border-radius: 999px;
  overflow: hidden;
}

.dist-fill {
  height: 100%;
  background: var(--brand);
  border-radius: 999px;
  transition: width 0.4s ease;
}
.dist-fill-2 {
  background: #4a7fc4;
}

.dist-value {
  color: var(--text-3);
  font-size: 12px;
  text-align: right;
  font-weight: 600;
}

/* ========== 智能筛选 ========== */
.filter-summary {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 16px 20px;
  box-shadow: var(--shadow-sm);
}

.filter-summary-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}
.filter-summary-head h3 {
  font-size: 15px;
}

.filter-summary-stats {
  display: flex;
  gap: 16px;
  flex-wrap: wrap;
  margin-bottom: 12px;
  font-size: 13px;
  font-weight: 600;
}
.fs-approve { color: var(--brand); }
.fs-reject { color: #c0463a; }
.fs-review { color: #9a6a12; }

.filter-summary-actions {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

/* 卡片 AI 建议标签 */
.card-tags {
  display: flex;
  gap: 6px;
  align-items: center;
}

.suggestion-tag {
  border-radius: 999px;
  padding: 3px 9px;
  font-size: 11px;
  font-weight: 700;
  cursor: help;
}
.suggestion-tag.sug-approve { background: var(--brand-soft); color: var(--brand); }
.suggestion-tag.sug-reject { background: #fceceb; color: #c0463a; }
.suggestion-tag.sug-review { background: #fef6e7; color: #9a6a12; }

/* ========== 召回模拟折叠区 ========== */
.recall-sim {
  margin-top: 8px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  box-shadow: var(--shadow-sm);
  overflow: hidden;
}

.recall-sim summary {
  padding: 16px 20px;
  cursor: pointer;
  color: var(--text-2);
  font-weight: 600;
  font-size: 14px;
  user-select: none;
  list-style: none;
}
.recall-sim summary::-webkit-details-marker {
  display: none;
}
.recall-sim summary::before {
  content: '';
  display: inline-block;
  width: 0;
  height: 0;
  border-left: 5px solid var(--text-3);
  border-top: 4px solid transparent;
  border-bottom: 4px solid transparent;
  margin-right: 8px;
  vertical-align: middle;
  transition: transform var(--duration-fast) var(--ease);
}
.recall-sim[open] summary::before {
  transform: rotate(90deg);
}

.recall-sim .recall-layout {
  padding: 0 20px 20px;
}

@media (max-width: 980px) {
  .overview-grid-3,
  .overview-grid-2 {
    grid-template-columns: 1fr;
  }
  .dist-bar-row {
    grid-template-columns: 70px 1fr 28px;
  }
}
</style>
