import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { v4 as uuid } from 'uuid';
import { PROJECT_ROOT, AI_PLATFORM_ROOT } from './config.js';
import { executeStep } from './claude-client.js';
// ========== 持久化 ==========
const DATA_ROOT = path.resolve(AI_PLATFORM_ROOT, 'data');
const WORKFLOWS_DIR = path.join(DATA_ROOT, 'workflows');
const RUNS_DIR = path.join(DATA_ROOT, 'runs');
const activeRuns = new Map();
function ensureDir(dir) {
    if (!fs.existsSync(dir))
        fs.mkdirSync(dir, { recursive: true });
}
function saveRunState(run) {
    ensureDir(RUNS_DIR);
    const filePath = path.join(RUNS_DIR, `${run.id}.json`);
    fs.writeFileSync(filePath, JSON.stringify(run, null, 2), 'utf-8');
}
function loadRunState(runId) {
    const filePath = path.join(RUNS_DIR, `${runId}.json`);
    if (!fs.existsSync(filePath))
        return undefined;
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}
// ========== 定义加载 ==========
export function loadWorkflowDefinitions() {
    if (!fs.existsSync(WORKFLOWS_DIR))
        return [];
    const files = fs.readdirSync(WORKFLOWS_DIR).filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'));
    return files.map((f) => {
        const content = fs.readFileSync(path.join(WORKFLOWS_DIR, f), 'utf-8');
        return yaml.load(content);
    });
}
export function getWorkflowDefinition(name) {
    return loadWorkflowDefinitions().find((w) => w.name === name);
}
// ========== 运行管理 ==========
export function startWorkflow(workflowName, params, emitter) {
    const definition = loadWorkflowDefinitions().find((w) => w.name === workflowName);
    if (!definition)
        throw new Error(`Workflow not found: ${workflowName}`);
    const run = {
        id: uuid(),
        workflowName,
        triggerParams: params,
        status: 'running',
        steps: definition.steps.map((s) => ({
            stepId: s.id,
            status: 'pending',
            input: {},
            output: {},
            attempts: 0,
        })),
        context: { trigger: params },
        startedAt: new Date().toISOString(),
        currentStepIndex: 0,
        logs: [],
    };
    activeRuns.set(run.id, run);
    saveRunState(run);
    // 异步执行
    executeWorkflow(run, definition, emitter).catch((err) => {
        run.status = 'failed';
        run.finishedAt = new Date().toISOString();
        addLog(run, 'error', `Workflow crashed: ${err}`);
        saveRunState(run);
        emitter.emit('workflow:failed', { runId: run.id, error: String(err) });
    });
    return run;
}
/**
 * 从断点恢复
 */
export function resumeWorkflow(runId, emitter) {
    const run = loadRunState(runId);
    if (!run)
        throw new Error(`Run not found: ${runId}`);
    if (run.status !== 'paused' && run.status !== 'failed') {
        throw new Error(`Cannot resume run in status: ${run.status}`);
    }
    const definition = loadWorkflowDefinitions().find((w) => w.name === run.workflowName);
    if (!definition)
        throw new Error(`Workflow definition not found: ${run.workflowName}`);
    run.status = 'running';
    saveRunState(run);
    activeRuns.set(run.id, run);
    addLog(run, 'info', `Resuming from step ${run.currentStepIndex}`);
    executeWorkflow(run, definition, emitter).catch((err) => {
        run.status = 'failed';
        run.finishedAt = new Date().toISOString();
        addLog(run, 'error', `Resume failed: ${err}`);
        saveRunState(run);
        emitter.emit('workflow:failed', { runId: run.id, error: String(err) });
    });
    return run;
}
export function getWorkflowRun(runId) {
    return activeRuns.get(runId) || loadRunState(runId);
}
export function listWorkflowRuns() {
    // 合并内存中和磁盘上的运行记录
    const diskRuns = [];
    if (fs.existsSync(RUNS_DIR)) {
        for (const f of fs.readdirSync(RUNS_DIR).filter((f) => f.endsWith('.json'))) {
            try {
                diskRuns.push(JSON.parse(fs.readFileSync(path.join(RUNS_DIR, f), 'utf-8')));
            }
            catch { /* skip corrupt files */ }
        }
    }
    // 内存中的优先（更新）
    const memoryIds = new Set(activeRuns.keys());
    const merged = [...activeRuns.values(), ...diskRuns.filter((r) => !memoryIds.has(r.id))];
    return merged.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
}
export function confirmStep(runId) {
    const run = activeRuns.get(runId) || loadRunState(runId);
    if (!run || run.status !== 'paused')
        return;
    // 标记当前等待步骤为已确认，状态改回 running 让引擎继续
    const stepRun = run.steps[run.currentStepIndex];
    if (stepRun)
        stepRun.status = 'success';
    run.status = 'running';
    saveRunState(run);
}
export function abortWorkflow(runId) {
    const run = activeRuns.get(runId);
    if (run) {
        run.status = 'aborted';
        run.finishedAt = new Date().toISOString();
        saveRunState(run);
    }
}
// ========== 核心执行逻辑 ==========
async function executeWorkflow(run, definition, emitter) {
    addLog(run, 'info', `Starting workflow: ${run.workflowName}`);
    emitter.emit('workflow:start', { runId: run.id, workflowName: run.workflowName });
    // 找到断点：跳过已成功的步骤
    let startIndex = 0;
    for (let i = 0; i < run.steps.length; i++) {
        if (run.steps[i].status === 'success') {
            startIndex = i + 1;
        }
        else {
            break;
        }
    }
    // 分组处理：识别并行组和顺序步骤
    const stepGroups = groupSteps(definition.steps);
    for (let gi = 0; gi < stepGroups.length; gi++) {
        const group = stepGroups[gi];
        if (group.type === 'parallel') {
            // 并行执行组内所有步骤
            addLog(run, 'info', `Parallel group: ${group.steps.map((s) => s.id).join(', ')}`);
            await executeParallelSteps(group.steps, run, definition, emitter);
        }
        else {
            // 顺序执行
            for (const step of group.steps) {
                const stepIndex = definition.steps.findIndex((s) => s.id === step.id);
                const stepRun = run.steps[stepIndex];
                // 跳过已完成的步骤（断点恢复）
                if (stepRun.status === 'success' || stepRun.status === 'skipped') {
                    continue;
                }
                // 条件检查
                if (step.condition && !evaluateCondition(step.condition, run.context)) {
                    stepRun.status = 'skipped';
                    addLog(run, 'info', `Skipped (condition false): ${step.id}`);
                    saveRunState(run);
                    continue;
                }
                run.currentStepIndex = stepIndex;
                await executeSingleStep(step, stepRun, stepIndex, run, emitter);
                saveRunState(run);
                // 如果步骤失败且策略是 abort，停止整个工作流
                if (stepRun.status === 'failed' && run.status === 'failed') {
                    return;
                }
            }
        }
    }
    // 检查是否所有步骤都完成
    const allDone = run.steps.every((s) => s.status === 'success' || s.status === 'skipped');
    if (allDone) {
        run.status = 'completed';
        addLog(run, 'info', 'Workflow completed');
    }
    run.finishedAt = new Date().toISOString();
    saveRunState(run);
    emitter.emit('workflow:done', { runId: run.id });
}
/**
 * 执行单个步骤
 */
async function executeSingleStep(step, stepRun, stepIndex, run, emitter) {
    const maxRetries = step.retry?.maxAttempts || 0;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        stepRun.status = 'running';
        stepRun.startedAt = new Date().toISOString();
        stepRun.attempts = attempt + 1;
        saveRunState(run);
        addLog(run, 'info', `Step ${step.id} started (attempt ${attempt + 1})`);
        emitter.emit('step:start', { runId: run.id, stepId: step.id, index: stepIndex });
        try {
            // 解析输入
            const resolvedInput = resolveInput(step.input, run.context);
            stepRun.input = resolvedInput;
            // 构建 prompt
            const prompt = buildStepPrompt(step, resolvedInput);
            // 执行
            const result = await executeStep(prompt, {
                cwd: PROJECT_ROOT,
                allowedTools: step.skill === 'zentao-client' ? ['Bash'] : undefined,
                timeout: step.timeout,
            }, emitter);
            stepRun.output = parseStepOutput(result.output);
            stepRun.status = 'success';
            stepRun.finishedAt = new Date().toISOString();
            // 写入上下文
            run.context[step.id] = stepRun.output;
            addLog(run, 'info', `Step ${step.id} completed`);
            emitter.emit('step:done', { runId: run.id, stepId: step.id, output: stepRun.output });
            // 成功了，不需要重试
            return;
        }
        catch (err) {
            const errorMsg = String(err);
            stepRun.error = errorMsg;
            addLog(run, 'warn', `Step ${step.id} failed (attempt ${attempt + 1}): ${errorMsg}`);
            if (attempt < maxRetries) {
                // 等待后重试
                const delay = step.retry?.delay || 2000;
                addLog(run, 'info', `Retrying in ${delay}ms...`);
                emitter.emit('step:retry', { runId: run.id, stepId: step.id, attempt: attempt + 1 });
                await sleep(delay);
                continue;
            }
            // 重试耗尽
            stepRun.status = 'failed';
            stepRun.finishedAt = new Date().toISOString();
            const onFailure = step.retry?.onFailure || 'abort';
            if (onFailure === 'skip') {
                stepRun.status = 'skipped';
                addLog(run, 'warn', `Step ${step.id} skipped after ${maxRetries + 1} attempts`);
                emitter.emit('step:skip', { runId: run.id, stepId: step.id });
                return;
            }
            // abort
            run.status = 'failed';
            addLog(run, 'error', `Workflow failed at step ${step.id}: ${errorMsg}`);
            emitter.emit('workflow:failed', { runId: run.id, failedStep: step.id, error: errorMsg });
            return;
        }
    }
}
/**
 * 并行执行步骤组
 */
async function executeParallelSteps(steps, run, definition, emitter) {
    const promises = steps.map(async (step) => {
        const stepIndex = definition.steps.findIndex((s) => s.id === step.id);
        const stepRun = run.steps[stepIndex];
        if (stepRun.status === 'success')
            return;
        // 条件检查
        if (step.condition && !evaluateCondition(step.condition, run.context)) {
            stepRun.status = 'skipped';
            return;
        }
        await executeSingleStep(step, stepRun, stepIndex, run, emitter);
    });
    await Promise.all(promises);
    // 检查是否有步骤失败
    const failed = steps.some((step) => {
        const idx = definition.steps.findIndex((s) => s.id === step.id);
        return run.steps[idx].status === 'failed';
    });
    if (failed) {
        run.status = 'failed';
    }
}
function groupSteps(steps) {
    const groups = [];
    const parallelBuffer = [];
    let currentParallelGroup = null;
    for (const step of steps) {
        if (step.parallelGroup) {
            if (step.parallelGroup !== currentParallelGroup) {
                // 新的并行组
                if (parallelBuffer.length > 0) {
                    groups.push({ type: 'parallel', steps: [...parallelBuffer] });
                    parallelBuffer.length = 0;
                }
                currentParallelGroup = step.parallelGroup;
            }
            parallelBuffer.push(step);
        }
        else {
            // 顺序步骤
            if (parallelBuffer.length > 0) {
                groups.push({ type: 'parallel', steps: [...parallelBuffer] });
                parallelBuffer.length = 0;
                currentParallelGroup = null;
            }
            groups.push({ type: 'sequential', steps: [step] });
        }
    }
    // 末尾并行组
    if (parallelBuffer.length > 0) {
        groups.push({ type: 'parallel', steps: [...parallelBuffer] });
    }
    return groups;
}
// ========== 工具函数 ==========
function resolveInput(input, context) {
    const resolved = {};
    for (const [key, value] of Object.entries(input)) {
        if (typeof value === 'string') {
            resolved[key] = value.replace(/\$\{([^}]+)\}/g, (_, expr) => {
                return String(getNestedValue(context, expr));
            });
        }
        else if (typeof value === 'object' && value !== null) {
            resolved[key] = resolveInput(value, context);
        }
        else {
            resolved[key] = value;
        }
    }
    return resolved;
}
function getNestedValue(obj, path) {
    return path.split('.').reduce((acc, key) => {
        if (acc == null)
            return undefined;
        return acc[key];
    }, obj);
}
function evaluateCondition(condition, context) {
    // 简单条件求值：支持 ${xxx} == "value" 和 ${xxx} != "value"
    const resolved = condition.replace(/\$\{([^}]+)\}/g, (_, expr) => {
        const val = getNestedValue(context, expr);
        return typeof val === 'string' ? `"${val}"` : String(val);
    });
    try {
        // 使用 Function 安全求值（仅支持简单比较）
        if (resolved.includes('=='))
            return new Function(`return ${resolved}`)();
        if (resolved.includes('!='))
            return new Function(`return ${resolved}`)();
        // 简单布尔
        return new Function(`return !!(${resolved})`)();
    }
    catch {
        return false;
    }
}
function buildStepPrompt(step, input) {
    return [
        `你是一个自动化工作流执行引擎。请严格按照以下指令执行任务。`,
        ``,
        `## 当前任务`,
        `- 任务ID: ${step.id}`,
        `- 使用 Skill: ${step.skill}`,
        step.action ? `- 动作: ${step.action}` : '',
        ``,
        `## 输入参数`,
        '```json',
        JSON.stringify(input, null, 2),
        '```',
        ``,
        `## 执行要求`,
        `1. 严格按照 ${step.skill} Skill 的规范执行`,
        `2. 不要询问用户，根据已有信息直接执行`,
        `3. 执行完成后，在回复末尾用以下格式输出结果：`,
        ``,
        `<!-- RESULT -->`,
        '```json',
        '{',
        '  "status": "success",',
        '  "data": { ... }',
        '}',
        '```',
        `<!-- /RESULT -->`,
        ``,
        `4. 如果执行失败，输出：`,
        `<!-- RESULT -->`,
        '```json',
        '{',
        '  "status": "failed",',
        '  "error": "错误描述"',
        '}',
        '```',
        `<!-- /RESULT -->`,
    ].join('\n');
}
function parseStepOutput(output) {
    // 优先提取 <!-- RESULT --> 块
    const resultMatch = output.match(/<!-- RESULT -->\s*```json\n([\s\S]*?)\n```\s*<!-- \/RESULT -->/);
    if (resultMatch) {
        try {
            const parsed = JSON.parse(resultMatch[1]);
            if (parsed.status === 'success' && parsed.data)
                return parsed.data;
            if (parsed.status === 'failed')
                throw new Error(parsed.error || 'Step failed');
        }
        catch (e) {
            if (e instanceof Error && !e.message.includes('JSON'))
                throw e;
        }
    }
    // 回退：尝试提取任意 JSON 块
    const jsonMatch = output.match(/```json\n([\s\S]*?)\n```/);
    if (jsonMatch) {
        try {
            return JSON.parse(jsonMatch[1]);
        }
        catch { /* skip */ }
    }
    return { raw: output };
}
function addLog(run, level, message) {
    run.logs.push({ time: new Date().toISOString(), level, message });
}
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
//# sourceMappingURL=workflow-engine.js.map