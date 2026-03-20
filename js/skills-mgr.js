// js/skills-mgr.js - Skills Manager page

let skillsList = [];
let skillsInterval = null;
let skillsPageBound = false;
const SKILLS_CACHE_KEY = 'skillsStatusCache.v1';

const skillsUi = {
    search: '',
    onlyIssues: false,
    status: '',      // 'enabled', 'disabled', or ''
    source: '',      // 'bundled', 'installed', 'clawhub', or ''
    agent: ''       // agent id or ''
};

function getHiddenSkills() {
    try { return JSON.parse(localStorage.getItem('hiddenSkills') || '[]'); } catch { return []; }
}

function setHiddenSkills(arr) {
    localStorage.setItem('hiddenSkills', JSON.stringify(arr));
}

function initSkillsPage() {
    bindSkillsPageControls();
    loadSkills({ useCache: true });

    if (skillsInterval) clearInterval(skillsInterval);
    skillsInterval = setInterval(() => loadSkills({ useCache: false }), 60000);
}

function readSkillsCache() {
    try {
        const cached = JSON.parse(localStorage.getItem(SKILLS_CACHE_KEY) || 'null');
        if (!cached || !Array.isArray(cached.skills)) return null;
        return cached;
    } catch {
        return null;
    }
}

function writeSkillsCache(skills) {
    try {
        localStorage.setItem(SKILLS_CACHE_KEY, JSON.stringify({ ts: Date.now(), skills }));
    } catch {}
}

function bindSkillsPageControls() {
    if (skillsPageBound) return;
    skillsPageBound = true;

    // Search input
    const search = document.getElementById('skills-search');
    if (search) {
        search.addEventListener('input', () => {
            skillsUi.search = (search.value || '').trim().toLowerCase();
            renderSkills();
            updateActiveFilters();
        });
    }

    // Issues toggle
    const onlyIssues = document.getElementById('skills-only-issues');
    if (onlyIssues) {
        onlyIssues.addEventListener('change', () => {
            skillsUi.onlyIssues = Boolean(onlyIssues.checked);
            renderSkills();
            updateActiveFilters();
        });
    }

    // Refresh button
    const refresh = document.getElementById('skills-refresh');
    if (refresh) {
        refresh.addEventListener('click', () => loadSkills({ useCache: false }));
    }

    // Clear filters button
    const clearBtn = document.getElementById('skills-clear-filters');
    if (clearBtn) {
        clearBtn.addEventListener('click', () => {
            skillsUi.search = '';
            skillsUi.onlyIssues = false;
            skillsUi.status = '';
            skillsUi.source = '';
            skillsUi.agent = '';
            
            if (search) search.value = '';
            if (onlyIssues) onlyIssues.checked = false;
            
            // Reset dropdowns
            document.querySelectorAll('.skills-filter-popover-trigger').forEach(trigger => {
                const filter = trigger.dataset.filter;
                trigger.classList.remove('open');
                trigger.querySelectorAll('.skills-filter-option').forEach(opt => {
                    opt.classList.toggle('active', opt.dataset.value === '');
                });
                const valueEl = document.getElementById(`skills-${filter}-value`);
                if (valueEl) valueEl.textContent = filter === 'agent' ? 'All' : 'All';
            });
            
            renderSkills();
            updateActiveFilters();
        });
    }

    // Filter popover triggers
    document.querySelectorAll('.skills-filter-popover-trigger').forEach(trigger => {
        const filter = trigger.dataset.filter;
        const dropdown = trigger.querySelector('.skills-filter-dropdown');
        
        // Click on trigger to toggle
        trigger.querySelector('.skills-filter-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            
            // Close other open dropdowns
            document.querySelectorAll('.skills-filter-popover-trigger.open').forEach(t => {
                if (t !== trigger) t.classList.remove('open');
            });
            
            trigger.classList.toggle('open');
        });
        
        // Click on options
        dropdown.querySelectorAll('.skills-filter-option').forEach(option => {
            option.addEventListener('click', (e) => {
                e.stopPropagation();
                const value = option.dataset.value;
                const label = option.textContent;
                
                // Update active state
                dropdown.querySelectorAll('.skills-filter-option').forEach(opt => {
                    opt.classList.toggle('active', opt === option);
                });
                
                // Update UI
                const valueEl = document.getElementById(`skills-${filter}-value`);
                if (valueEl) valueEl.textContent = label;
                
                // Update state
                if (filter === 'status') skillsUi.status = value;
                else if (filter === 'source') skillsUi.source = value;
                else if (filter === 'agent') skillsUi.agent = value;
                
                // Close dropdown
                trigger.classList.remove('open');
                
                renderSkills();
                updateActiveFilters();
            });
        });
    });

    // Close dropdowns when clicking outside
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.skills-filter-popover-trigger')) {
            document.querySelectorAll('.skills-filter-popover-trigger.open').forEach(t => {
                t.classList.remove('open');
            });
        }
    });
}

async function loadSkills({ useCache = true } = {}) {
    const container = document.getElementById('skills-list');
    if (!container) return;

    const startedAt = performance.now();

    if (useCache) {
        const cached = readSkillsCache();
        if (cached?.skills?.length) {
            skillsList = cached.skills;
            renderSkills();
            console.log(`[Perf][Skills] Rendered cached skills in ${Math.round(performance.now() - startedAt)}ms (${skillsList.length} skills)`);
        }
    }

    if (!gateway || !gateway.isConnected()) {
        if (!skillsList.length) {
            container.innerHTML = '<div class="empty-state">Connect to gateway to view skills</div>';
        }
        return;
    }

    try {
        // Prefer skills.status (rich, includes install options + requirements).
        // Fallback to skills.list for older gateways.
        let result;
        let source = 'skills.status';
        try {
            result = await gateway._request('skills.status', {});
            skillsList = result?.skills || [];
        } catch (e) {
            source = 'skills.list';
            result = await gateway._request('skills.list', {});
            skillsList = result?.skills || result || [];
        }

        writeSkillsCache(skillsList);
        renderSkills();
        console.log(`[Perf][Skills] ${source} + render: ${Math.round(performance.now() - startedAt)}ms (${Array.isArray(skillsList) ? skillsList.length : 0} skills)`);
    } catch (e) {
        console.warn('[Skills] Failed:', e.message);
        if (!skillsList.length) {
            container.innerHTML = '<div class="empty-state">Could not load skills. The skills RPC may not be available.</div>';
        }
    }
}

function skillHasIssues(skill) {
    // When skills.status is available, entries include missing + eligibility flags.
    const missing = skill?.missing || {};
    const missingCount = (missing.bins?.length || 0) + (missing.anyBins?.length || 0) + (missing.env?.length || 0) + (missing.config?.length || 0) + (missing.os?.length || 0);
    return Boolean(skill?.disabled || skill?.blockedByAllowlist || skill?.eligible === false || missingCount > 0);
}

function renderMissingBadges(skill) {
    const missing = skill?.missing || {};
    const blocks = [];

    const add = (label, items) => {
        if (!items || items.length === 0) return;
        const text = items.map(escapeHtml).join(', ');
        blocks.push(`<div style="margin-top: 6px; font-size: 11px; color: var(--text-muted);">
            <span style="font-weight: 600; color: var(--warning);">Missing ${escapeHtml(label)}:</span> ${text}
        </div>`);
    };

    add('bins', missing.bins);
    add('any bins', missing.anyBins);
    add('env', missing.env);
    add('config', missing.config);
    add('os', missing.os);

    if (skill?.blockedByAllowlist) {
        blocks.push(`<div style="margin-top: 6px; font-size: 11px; color: var(--error);">
            Blocked by bundled allowlist
        </div>`);
    }

    return blocks.join('');
}

function skillIsReady(skill) {
    // "Ready" means prerequisites/binaries are present.
    // This is NOT the same thing as "installed" (many skills are bundled).
    const missing = skill?.missing || {};
    const missingBins = (missing.bins?.length || 0) + (missing.anyBins?.length || 0);
    return missingBins === 0;
}

function renderInstallButtons(skill) {
    const options = skill?.install || [];
    if (!Array.isArray(options) || options.length === 0) return '';

    const name = skill?.name;
    if (!name) return '';

    // Show "Reinstall" if the skill is already installed:
    // - gateway explicitly reports installed=true, OR
    // - the skill has install options AND all required bins are present (ready)
    const ready = skillIsReady(skill);
    const installed = skill?.installed === true || ready;

    const readyBadge = ready
        ? `<span class="badge" style="background: rgba(34,197,94,.12); border: 1px solid rgba(34,197,94,.25); color: var(--success); padding: 3px 8px; border-radius: 999px; font-size: 10px; font-weight: 600;">Ready</span>`
        : '';

    const buttons = options.map(opt => {
        const baseLabel = opt?.label || 'Install';
        const installId = opt?.id;
        if (!installId) return '';

        const label = installed ? 'Reinstall' : baseLabel;
        const klass = installed ? 'btn btn-ghost' : 'btn btn-primary';

        return `<button class="${klass}" style="padding: 4px 10px; font-size: 11px;" onclick="installSkill('${escapeHtml(name)}','${escapeHtml(installId)}')">${escapeHtml(label)}</button>`;
    }).join('');

    return [readyBadge, buttons].filter(Boolean).join('');
}

function renderSkills() {
    const container = document.getElementById('skills-list');
    if (!container) return;

    if (!Array.isArray(skillsList) || skillsList.length === 0) {
        // If it's an object, convert
        if (typeof skillsList === 'object' && !Array.isArray(skillsList)) {
            skillsList = Object.entries(skillsList).map(([name, data]) => ({
                name, ...(typeof data === 'object' ? data : { status: data })
            }));
        }

        if (!skillsList || skillsList.length === 0) {
            container.innerHTML = '<div class="empty-state">No skills installed</div>';
            return;
        }
    }

    const query = skillsUi.search;
    const filtered = skillsList
        .filter(skill => {
            const name = (skill?.name || skill?.id || '').toString();
            const desc = (skill?.description || '').toString();
            const key = (skill?.skillKey || '').toString();
            if (!query) return true;
            return name.toLowerCase().includes(query) || desc.toLowerCase().includes(query) || key.toLowerCase().includes(query);
        })
        .filter(skill => {
            if (!skillsUi.status) return true;
            const enabled = !skill?.disabled && skill?.enabled !== false;
            if (skillsUi.status === 'enabled') return enabled;
            if (skillsUi.status === 'disabled') return !enabled;
            return true;
        })
        .filter(skill => {
            if (!skillsUi.source) return true;
            if (skillsUi.source === 'bundled') return skill?.bundled === true;
            if (skillsUi.source === 'installed') return skill?.installed === true;
            if (skillsUi.source === 'clawhub') return skill?.source === 'clawhub';
            return true;
        })
        .filter(skill => {
            if (!skillsUi.agent) return true;
            return skill?.assignedAgent === skillsUi.agent;
        })
        .filter(skill => skillsUi.onlyIssues ? skillHasIssues(skill) : true)
        .sort((a, b) => (a?.name || '').localeCompare(b?.name || ''));

    container.innerHTML = filtered.map(skill => {
        const name = skill?.name || skill?.id || 'Unknown';
        const skillKey = skill?.skillKey || name;
        const enabled = skill?.disabled ? false : (skill?.enabled !== false);

        const eligible = skill?.eligible;
        const showEligible = typeof eligible === 'boolean';

        const dotClass = (!enabled || skill?.disabled)
            ? 'idle'
            : (eligible === true ? 'success' : eligible === false ? 'error' : 'idle');

        const desc = skill?.description || '';
        const emoji = skill?.emoji || '🧩';
        const source = skill?.source ? `• ${escapeHtml(skill.source)}` : '';

        const topBadges = [
            showEligible ? (eligible ? '<span style="font-size: 10px; color: var(--success);">Ready</span>' : '<span style="font-size: 10px; color: var(--warning);">Needs attention</span>') : '',
            skill?.bundled ? '<span style="font-size: 10px; color: var(--text-muted);">Bundled</span>' : '',
            skill?.always ? '<span style="font-size: 10px; color: var(--text-muted);">Always</span>' : '',
        ].filter(Boolean).join('<span style="opacity:.35">•</span>');

        const installButtons = renderInstallButtons(skill);
        const missingBadges = renderMissingBadges(skill);

        const homepage = skill?.homepage ? `<a href="${escapeHtml(skill.homepage)}" target="_blank" style="font-size: 11px; color: var(--accent); text-decoration: none;">Homepage</a>` : '';

        return `
        <div style="background: var(--surface-1); border: 1px solid var(--border-default); border-radius: var(--radius-md); padding: 12px; margin-bottom: 10px;">
            <div style="display: flex; align-items: flex-start; justify-content: space-between; gap: 10px;">
                <div style="flex: 1; min-width: 0;">
                    <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                        <span class="status-dot ${dotClass}"></span>
                        <span style="font-weight: 650; font-size: 14px;">${escapeHtml(emoji)} ${escapeHtml(name)}</span>
                        ${topBadges ? `<span style="font-size: 10px; color: var(--text-muted);">${topBadges}</span>` : ''}
                        ${source ? `<span style="font-size: 10px; color: var(--text-muted);">${source}</span>` : ''}
                    </div>
                    ${desc ? `<div style="font-size: 11px; color: var(--text-muted); margin-top: 4px;">${escapeHtml(desc)}</div>` : ''}
                    <div style="margin-top: 6px; display:flex; align-items:center; gap: 10px; flex-wrap: wrap;">
                        <span style="font-size: 10px; color: var(--text-faint);">skillKey: <span style="font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;">${escapeHtml(skillKey)}</span></span>
                        ${homepage}
                    </div>
                    ${missingBadges}
                </div>

                <div style="display: flex; gap: 6px; align-items: center; flex-shrink: 0; flex-wrap: wrap; justify-content: flex-end;">
                    ${installButtons}
                    <button onclick="viewSkillFiles('${escapeHtml(skillKey)}', '${escapeHtml(skill?.path || '')}')"
                            class="btn btn-ghost"
                            style="padding: 4px 10px; font-size: 11px;"
                            title="View and edit skill files">
                        📂 Files
                    </button>
                    <button onclick="openEditSkillModal('${escapeHtml(skillKey)}')"
                            class="btn btn-ghost"
                            style="padding: 4px 10px; font-size: 11px;"
                            title="Edit skill settings">
                        ✏️ Edit
                    </button>
                    <button onclick="toggleSkill('${escapeHtml(skillKey)}', ${enabled ? 'false' : 'true'})"
                            class="btn ${enabled ? 'btn-ghost' : 'btn-primary'}"
                            style="padding: 4px 10px; font-size: 11px;">
                        ${enabled ? 'Disable' : 'Enable'}
                    </button>
                    <button onclick="promptSetApiKey('${escapeHtml(skillKey)}', '${escapeHtml(skill?.primaryEnv || '')}')" class="btn btn-ghost" style="padding: 4px 10px; font-size: 11px;">
                        Set key
                    </button>
                    <button onclick="promptSetEnv('${escapeHtml(skillKey)}', ${escapeHtml(JSON.stringify(skill?.missing?.env || []))})" class="btn btn-ghost" style="padding: 4px 10px; font-size: 11px;">
                        Set env
                    </button>
                    ${skill?.bundled
                        ? `<button onclick="toggleHideSkill('${escapeHtml(skillKey)}')" class="btn btn-ghost" style="padding: 4px 10px; font-size: 11px; color: var(--text-muted);">
                            ${getHiddenSkills().includes(skillKey) ? '👁 Unhide' : '🙈 Hide'}
                          </button>`
                        : `<button onclick="uninstallSkill('${escapeHtml(skillKey)}')" class="btn btn-ghost" style="padding: 4px 10px; font-size: 11px; color: var(--error);">
                            🗑 Uninstall
                          </button>`
                    }
                </div>
            </div>
        </div>`;
    }).join('');

    if (!container.innerHTML.trim()) {
        container.innerHTML = '<div class="empty-state">No matching skills</div>';
    }
}

function showInstallModal(title, subtitle, body) {
    const titleEl = document.getElementById('skills-install-modal-title');
    const subtitleEl = document.getElementById('skills-install-modal-subtitle');
    const bodyEl = document.getElementById('skills-install-modal-body');

    if (titleEl) titleEl.textContent = title || 'Skill installer';
    if (subtitleEl) subtitleEl.textContent = subtitle || '';
    if (bodyEl) bodyEl.textContent = body || '';

    showModal('skills-install-modal');
}

window.installSkill = async function(name, installId) {
    if (!gateway || !gateway.isConnected()) {
        showToast('Connect to gateway first', 'warning');
        return;
    }

    showInstallModal(`Installing ${name}`, `Installer: ${installId}`, 'Running…');

    try {
        const result = await gateway._request('skills.install', { name, installId }, 600000);

        const warnings = Array.isArray(result?.warnings) && result.warnings.length > 0
            ? `\n\nWARNINGS:\n- ${result.warnings.join('\n- ')}`
            : '';

        const out = [
            `ok: ${String(result?.ok)}`,
            result?.message ? `message: ${result.message}` : '',
            typeof result?.code !== 'undefined' ? `code: ${String(result.code)}` : '',
            '',
            result?.stdout ? `STDOUT:\n${result.stdout}` : 'STDOUT: (empty)',
            '',
            result?.stderr ? `STDERR:\n${result.stderr}` : 'STDERR: (empty)',
        ].filter(Boolean).join('\n');

        showInstallModal(`Install: ${name}`, `Installer: ${installId}`, out + warnings);

        showToast(result?.ok ? 'Install complete' : 'Install failed', result?.ok ? 'success' : 'error');
        loadSkills();
    } catch (e) {
        showInstallModal(`Install: ${name}`, `Installer: ${installId}`, `ERROR: ${e.message}`);
        showToast('Install failed: ' + e.message, 'error');
    }
};

window.toggleSkill = async function(skillKey, enable) {
    try {
        await gateway._request('skills.update', { skillKey, enabled: enable });
        showToast(`Skill ${enable ? 'enabled' : 'disabled'}`, 'success');
        loadSkills();
    } catch (e) {
        showToast('Failed: ' + e.message, 'error');
    }
};

window.promptSetApiKey = async function(skillKey, primaryEnv) {
    if (!gateway || !gateway.isConnected()) {
        showToast('Connect to gateway first', 'warning');
        return;
    }

    const envName = primaryEnv || `${skillKey.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_API_KEY`;
    const apiKey = window.prompt(`Enter API key for ${skillKey} (${envName}).\n\nLeave blank to clear.`);
    if (apiKey === null) return; // cancelled

    try {
        // Store both as apiKey (legacy) and as the proper env var
        await gateway._request('skills.update', { skillKey, apiKey, env: { [envName]: apiKey } });
        showToast(`Saved ${envName}`, 'success');
        loadSkills();
    } catch (e) {
        showToast('Failed: ' + e.message, 'error');
    }
};

window.promptSetEnv = async function(skillKey, missingEnv) {
    if (!gateway || !gateway.isConnected()) {
        showToast('Connect to gateway first', 'warning');
        return;
    }

    // Pre-fill with first missing env var if available
    const defaultKey = Array.isArray(missingEnv) && missingEnv.length > 0 ? missingEnv[0] : '';
    const key = window.prompt(`Env var name for ${skillKey} (e.g., FOO_TOKEN).${defaultKey ? `\n\nMissing: ${missingEnv.join(', ')}` : ''}\n\nLeave blank to cancel.`, defaultKey);
    if (key === null) return;
    const trimmedKey = (key || '').trim();
    if (!trimmedKey) return;

    const value = window.prompt(`Enter value for ${trimmedKey}.\n\nLeave blank to clear this key.`);
    if (value === null) return;

    try {
        await gateway._request('skills.update', { skillKey, env: { [trimmedKey]: value } });
        showToast(`Saved ${trimmedKey}`, 'success');
        loadSkills();
    } catch (e) {
        showToast('Failed: ' + e.message, 'error');
    }
};

// ========== Skill File Viewer/Editor ==========

let currentSkillFiles = [];
let currentSkillPath = '';
let currentSkillName = '';
let currentEditingFile = null;

window.viewSkillFiles = async function(skillKey, skillPath) {
    currentSkillPath = skillPath || '';
    currentSkillName = skillKey;

    const titleEl = document.getElementById('skill-files-modal-title');
    const treeEl = document.getElementById('skill-files-tree');
    const previewEl = document.getElementById('skill-file-preview');

    if (titleEl) titleEl.textContent = `📂 ${skillKey}`;
    if (treeEl) treeEl.innerHTML = '<div style="color: var(--text-muted); padding: 8px;">Loading...</div>';
    if (previewEl) previewEl.innerHTML = '<div style="color: var(--text-muted); padding: 20px; text-align: center;">Select a file to view</div>';

    showModal('skill-files-modal');

    try {
        // Use dashboard API for file listing
        const resp = await fetch(`/api/skills/${encodeURIComponent(skillKey)}/files`);
        if (!resp.ok) {
            throw new Error(await resp.text() || 'Failed to load files');
        }
        const result = await resp.json();
        currentSkillFiles = result?.files || [];
        currentSkillPath = result?.path || skillPath || '';

        if (currentSkillFiles.length === 0) {
            if (treeEl) treeEl.innerHTML = '<div style="color: var(--text-muted); padding: 8px;">No files found</div>';
            return;
        }

        renderSkillFilesTree(currentSkillFiles);

        // Auto-open SKILL.md if present
        const skillMd = currentSkillFiles.find(f => f.name === 'SKILL.md' || f.relativePath === 'SKILL.md');
        if (skillMd) {
            previewSkillFile(skillMd.relativePath || 'SKILL.md');
        }
    } catch (e) {
        console.warn('[Skills] Failed to load files:', e.message);
        if (treeEl) treeEl.innerHTML = `<div style="color: var(--error); padding: 8px;">Error: ${escapeHtml(e.message)}</div>`;
    }
};

function renderSkillFilesTree(files) {
    const container = document.getElementById('skill-files-tree');
    if (!container) return;

    // Build tree structure from relativePath
    const tree = {};
    for (const f of files) {
        const relPath = f.relativePath || f.name || '';
        const parts = relPath.split('/').filter(Boolean);

        let node = tree;
        for (let i = 0; i < parts.length; i++) {
            const part = parts[i];
            if (i === parts.length - 1) {
                if (!node._files) node._files = [];
                node._files.push({ ...f, fileName: part, relPath: relPath });
            } else {
                if (!node[part]) node[part] = {};
                node = node[part];
            }
        }
    }

    container.innerHTML = renderSkillTreeNode(tree, '');
}

function renderSkillTreeNode(node, prefix) {
    let html = '';

    // Render subdirectories first
    const dirs = Object.keys(node).filter(k => k !== '_files').sort();
    for (const dir of dirs) {
        html += `
        <div class="skill-tree-dir" onclick="toggleSkillTreeDir(this)" style="display: flex; align-items: center; gap: 4px; padding: 4px 8px; cursor: pointer; border-radius: 4px;">
            <span class="tree-chevron" style="font-size: 10px; color: var(--text-muted);">▶</span>
            <span style="font-size: 12px;">📁 ${escapeHtml(dir)}</span>
        </div>
        <div class="skill-tree-children hidden" style="padding-left: 16px;">
            ${renderSkillTreeNode(node[dir], prefix ? `${prefix}/${dir}` : dir)}
        </div>`;
    }

    // Render files
    const files = node._files || [];
    for (const f of files.sort((a, b) => (a.fileName || '').localeCompare(b.fileName || ''))) {
        const icon = getFileIcon(f.fileName);
        html += `
        <div class="skill-tree-file" onclick="previewSkillFile('${escapeHtml(f.relPath)}')"
             style="display: flex; align-items: center; gap: 4px; padding: 4px 8px; cursor: pointer; border-radius: 4px; font-size: 12px;"
             onmouseover="this.style.background='var(--surface-2)'" onmouseout="this.style.background='transparent'">
            <span>${icon}</span>
            <span>${escapeHtml(f.fileName)}</span>
        </div>`;
    }

    return html;
}

function getFileIcon(fileName) {
    if (!fileName) return '📄';
    const ext = fileName.split('.').pop()?.toLowerCase();
    const icons = {
        'md': '📝',
        'py': '🐍',
        'sh': '🔧',
        'js': '📜',
        'json': '📋',
        'yaml': '📋',
        'yml': '📋',
        'txt': '📄',
    };
    return icons[ext] || '📄';
}

window.toggleSkillTreeDir = function(el) {
    const children = el.nextElementSibling;
    if (!children) return;
    const chevron = el.querySelector('.tree-chevron');
    if (children.classList.contains('hidden')) {
        children.classList.remove('hidden');
        if (chevron) chevron.textContent = '▼';
    } else {
        children.classList.add('hidden');
        if (chevron) chevron.textContent = '▶';
    }
};

window.previewSkillFile = async function(relPath) {
    const preview = document.getElementById('skill-file-preview');
    if (!preview) return;

    preview.innerHTML = '<div style="color: var(--text-muted); padding: 20px; text-align: center;">Loading...</div>';
    currentEditingFile = relPath;

    try {
        const resp = await fetch(`/api/skills/${encodeURIComponent(currentSkillName)}/files/${encodeURIComponent(relPath)}`);
        if (!resp.ok) {
            throw new Error(await resp.text() || 'Failed to load file');
        }
        const result = await resp.json();
        const content = result?.content || '';
        const fileName = relPath.split('/').pop();
        const isEditable = /\.(md|txt|py|sh|js|json|yaml|yml)$/i.test(fileName);
        const isBundled = !currentSkillPath.includes('/workspace/skills');

        preview.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; padding: 8px 12px; border-bottom: 1px solid var(--border-default); background: var(--surface-1);">
                <span style="font-weight: 600; font-size: 12px; font-family: ui-monospace, monospace;">${escapeHtml(fileName)}</span>
                <div style="display: flex; gap: 6px; align-items: center;">
                    ${isBundled ? '<span style="font-size: 10px; color: var(--warning);">Read-only (bundled)</span>' : ''}
                    ${isEditable && !isBundled ? `<button onclick="editSkillFile('${escapeHtml(relPath)}')" class="btn btn-primary" style="font-size: 11px; padding: 4px 10px;">Edit</button>` : ''}
                </div>
            </div>
            <pre id="skill-file-content" style="padding: 12px; margin: 0; font-size: 11px; line-height: 1.5; white-space: pre-wrap; word-break: break-word; overflow-y: auto; flex: 1; background: var(--surface-0); color: var(--text-primary);">${escapeHtml(content)}</pre>
        `;
    } catch (e) {
        preview.innerHTML = `<div style="color: var(--error); padding: 20px;">Error: ${escapeHtml(e.message)}</div>`;
    }
};

window.editSkillFile = async function(relPath) {
    const preview = document.getElementById('skill-file-preview');
    if (!preview) return;

    try {
        const resp = await fetch(`/api/skills/${encodeURIComponent(currentSkillName)}/files/${encodeURIComponent(relPath)}`);
        if (!resp.ok) {
            throw new Error(await resp.text() || 'Failed to load file');
        }
        const result = await resp.json();
        const content = result?.content || '';
        const fileName = relPath.split('/').pop();

        preview.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; padding: 8px 12px; border-bottom: 1px solid var(--border-default); background: var(--surface-1);">
                <span style="font-weight: 600; font-size: 12px; font-family: ui-monospace, monospace;">✏️ Editing: ${escapeHtml(fileName)}</span>
                <div style="display: flex; gap: 6px;">
                    <button onclick="previewSkillFile('${escapeHtml(relPath)}')" class="btn btn-ghost" style="font-size: 11px; padding: 4px 10px;">Cancel</button>
                    <button onclick="saveSkillFile('${escapeHtml(relPath)}')" class="btn btn-primary" style="font-size: 11px; padding: 4px 10px;">💾 Save</button>
                </div>
            </div>
            <textarea id="skill-file-editor" style="width: 100%; flex: 1; padding: 12px; margin: 0; font-size: 11px; line-height: 1.5; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; border: none; resize: none; background: var(--surface-0); color: var(--text-primary);">${escapeHtml(content)}</textarea>
        `;

        // Focus the textarea
        const textarea = document.getElementById('skill-file-editor');
        if (textarea) textarea.focus();
    } catch (e) {
        showToast('Failed to load file: ' + e.message, 'error');
    }
};

window.uninstallSkill = async function(skillKey) {
    if (!confirm(`Uninstall "${skillKey}"? This will permanently delete the skill directory.`)) return;

    try {
        const resp = await fetch(`/api/skills/${encodeURIComponent(skillKey)}`, { method: 'DELETE' });
        const result = await resp.json();
        if (!resp.ok) {
            showToast(result.error || 'Uninstall failed', 'error');
            return;
        }
        showToast(`${skillKey} uninstalled`, 'success');
        loadSkills();
    } catch (e) {
        showToast('Uninstall failed: ' + e.message, 'error');
    }
};

window.toggleHideSkill = function(skillKey) {
    const hidden = getHiddenSkills();
    const idx = hidden.indexOf(skillKey);
    if (idx >= 0) {
        hidden.splice(idx, 1);
        showToast(`${skillKey} unhidden`, 'success');
    } else {
        hidden.push(skillKey);
        showToast(`${skillKey} hidden`, 'success');
    }
    setHiddenSkills(hidden);
    renderSkills();
};

window.saveSkillFile = async function(relPath) {
    const textarea = document.getElementById('skill-file-editor');
    if (!textarea) return;

    const content = textarea.value;

    try {
        const resp = await fetch(`/api/skills/${encodeURIComponent(currentSkillName)}/files/${encodeURIComponent(relPath)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content })
        });

        if (!resp.ok) {
            const err = await resp.json().catch(() => ({}));
            throw new Error(err.error || 'Failed to save file');
        }

        showToast('File saved', 'success');
        previewSkillFile(relPath);
    } catch (e) {
        showToast('Failed to save: ' + e.message, 'error');
    }
};

window.openEditSkillModal = function(skillKey) {
    const skill = skillsList.find(s => (s?.skillKey || s?.name || '') === skillKey);
    if (!skill) {
        showToast('Skill not found', 'error');
        return;
    }

    document.getElementById('edit-skill-key').value = skillKey;
    document.getElementById('edit-skill-name').value = skill?.name || skillKey;
    document.getElementById('edit-skill-description').value = skill?.description || '';

    const enabled = !skill?.disabled && skill?.enabled !== false;
    document.getElementById('edit-skill-enabled').checked = enabled;

    // Get env vars from skill config if available
    const envText = skill?.envEntries
        ? Object.entries(skill.envEntries).map(([k, v]) => `${k}=${v}`).join('\n')
        : '';
    document.getElementById('edit-skill-env').value = envText;

    // Get agent assignment if configured
    const agentSelect = document.getElementById('edit-skill-agent');
    if (agentSelect) {
        agentSelect.value = skill?.assignedAgent || '';
    }

    document.getElementById('edit-skill-modal-subtitle').textContent = skill?.skillKey || skillKey;

    showModal('edit-skill-modal');
};

window.submitEditSkill = async function() {
    const skillKey = document.getElementById('edit-skill-key')?.value?.trim();
    if (!skillKey) {
        showToast('Skill key is required', 'error');
        return;
    }

    const description = document.getElementById('edit-skill-description')?.value?.trim();
    const enabled = document.getElementById('edit-skill-enabled')?.checked;
    const envText = document.getElementById('edit-skill-env')?.value?.trim() || '';
    const assignedAgent = document.getElementById('edit-skill-agent')?.value?.trim();

    // Parse env vars
    const envEntries = {};
    if (envText) {
        envText.split('\n').forEach(line => {
            const trimmed = line.trim();
            if (!trimmed) return;
            const eqIdx = trimmed.indexOf('=');
            if (eqIdx > 0) {
                const key = trimmed.substring(0, eqIdx).trim();
                const value = trimmed.substring(eqIdx + 1).trim();
                if (key) envEntries[key] = value;
            }
        });
    }

    // Build the skill config patch
    const patch = {
        enabled: enabled
    };

    if (description) {
        patch.description = description;
    }

    if (Object.keys(envEntries).length > 0) {
        patch.envEntries = envEntries;
    }

    if (assignedAgent) {
        patch.assignedAgent = assignedAgent;
    }

    try {
        const resp = await fetch('/api/skills/config', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ skillKey, patch })
        });

        if (!resp.ok) {
            const err = await resp.json().catch(() => ({}));
            throw new Error(err.error || 'Failed to save skill settings');
        }

        showToast(`${skillKey} settings updated`, 'success');
        hideModal('edit-skill-modal');
        loadSkills({ useCache: false });
    } catch (e) {
        showToast('Failed to save: ' + e.message, 'error');
    }
};

function updateActiveFilters() {
    const container = document.getElementById('skills-active-filters');
    const clearBtn = document.getElementById('skills-clear-filters');
    const countEl = document.getElementById('skills-filter-count');
    if (!container) return;

    const filters = [];
    
    if (skillsUi.search) {
        filters.push({ type: 'search', label: `"${skillsUi.search}"` });
    }
    if (skillsUi.status) {
        filters.push({ type: 'status', label: skillsUi.status });
    }
    if (skillsUi.source) {
        filters.push({ type: 'source', label: skillsUi.source });
    }
    if (skillsUi.agent) {
        filters.push({ type: 'agent', label: skillsUi.agent });
    }
    if (skillsUi.onlyIssues) {
        filters.push({ type: 'issues', label: '⚠ Issues' });
    }

    // Update count
    const count = filters.length;
    if (countEl) countEl.textContent = count;
    
    if (filters.length === 0) {
        container.style.display = 'none';
        if (clearBtn) clearBtn.style.display = 'none';
        return;
    }

    container.style.display = 'flex';
    if (clearBtn) clearBtn.style.display = 'flex';

    const filterLabels = {
        'search': 'Search',
        'status': 'Status',
        'source': 'Source',
        'agent': 'Agent',
        'issues': 'Issues'
    };

    container.innerHTML = filters.map(f => `
        <span class="filter-chip">
            <span style="opacity: 0.6; font-size: 10px;">${filterLabels[f.type]}:</span>
            ${escapeHtml(f.label)}
            <button onclick="clearFilter('${f.type}')">✕</button>
        </span>
    `).join('');
}

window.clearFilter = function(type) {
    if (type === 'search') {
        skillsUi.search = '';
        const el = document.getElementById('skills-search');
        if (el) el.value = '';
    } else if (type === 'status') {
        skillsUi.status = '';
        const trigger = document.getElementById('skills-status-filter');
        if (trigger) {
            trigger.classList.remove('open');
            trigger.querySelectorAll('.skills-filter-option').forEach(opt => {
                opt.classList.toggle('active', opt.dataset.value === '');
            });
            const valueEl = document.getElementById('skills-status-value');
            if (valueEl) valueEl.textContent = 'All';
        }
    } else if (type === 'source') {
        skillsUi.source = '';
        const trigger = document.getElementById('skills-source-filter');
        if (trigger) {
            trigger.classList.remove('open');
            trigger.querySelectorAll('.skills-filter-option').forEach(opt => {
                opt.classList.toggle('active', opt.dataset.value === '');
            });
            const valueEl = document.getElementById('skills-source-value');
            if (valueEl) valueEl.textContent = 'All';
        }
    } else if (type === 'agent') {
        skillsUi.agent = '';
        const trigger = document.getElementById('skills-agent-filter');
        if (trigger) {
            trigger.classList.remove('open');
            trigger.querySelectorAll('.skills-filter-option').forEach(opt => {
                opt.classList.toggle('active', opt.dataset.value === '');
            });
            const valueEl = document.getElementById('skills-agent-value');
            if (valueEl) valueEl.textContent = 'All';
        }
    } else if (type === 'issues') {
        skillsUi.onlyIssues = false;
        const el = document.getElementById('skills-only-issues');
        if (el) el.checked = false;
    }
    renderSkills();
    updateActiveFilters();
};
